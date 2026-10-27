import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  speechClipSchema,
  speechRequestSchema,
  type SpeechClip,
  type SpeechProgress,
  type SpeechRequest,
  type SpeechStatus,
} from './contract';

const statusSchema = z.object({ available: z.boolean(), ready: z.boolean(), message: z.string() });
const progressSchema = z.object({
  type: z.literal('progress'),
  phase: z.enum(['setup', 'loading', 'generating']),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  message: z.string().max(1000),
});

interface Options {
  projectRoot: string;
  dataDirectory: string;
  python?: string;
}

export class SpeechService {
  private active: AbortController | null = null;
  private readonly python: string;
  private readonly sidecar: string;

  constructor(private readonly options: Options) {
    this.python =
      options.python ??
      path.join(
        options.projectRoot,
        'services/tts/.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      );
    this.sidecar = path.join(options.projectRoot, 'services/tts/sidecar.py');
  }

  async status(): Promise<SpeechStatus> {
    try {
      const result = await this.run({ operation: 'status' }, undefined, undefined, 15000);
      return statusSchema.parse(result.status);
    } catch (cause) {
      return {
        available: false,
        ready: false,
        message: cause instanceof Error ? cause.message : 'Local speech engine is unavailable.',
      };
    }
  }

  prepare(onProgress: (event: SpeechProgress) => void) {
    return this.job(async (signal) => {
      const result = await this.run({ operation: 'prepare' }, signal, onProgress);
      return statusSchema.parse(result.status);
    });
  }

  generate(
    request: SpeechRequest,
    onProgress: (event: SpeechProgress) => void,
  ): Promise<SpeechClip[]> {
    const parsed = speechRequestSchema.parse(request);
    return this.job(async (signal) => {
      const result = await this.run({ ...parsed, operation: 'generate' }, signal, onProgress);
      const clips = z.array(speechClipSchema).length(parsed.steps.length).parse(result.clips);
      if (clips.some((clip, index) => clip.stepId !== parsed.steps[index].id))
        throw new Error('Speech engine returned mismatched steps.');
      return clips;
    });
  }

  cancel() {
    this.active?.abort();
  }

  async readAudio(cacheKey: string) {
    if (!/^[a-f0-9]{64}$/.test(cacheKey)) throw new Error('Invalid speech cache key.');
    const directory = await realpath(path.join(this.options.dataDirectory, 'audio'));
    const filename = await realpath(path.join(directory, `${cacheKey}.wav`));
    if (filename !== path.join(directory, `${cacheKey}.wav`))
      throw new Error('Speech cache path is not allowed.');
    const info = await stat(filename);
    if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('Invalid cached audio.');
    const data = await readFile(filename);
    if (data.length > 25 * 1024 * 1024) throw new Error('Cached audio exceeds the size limit.');
    return `data:audio/wav;base64,${data.toString('base64')}`;
  }

  private async job<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active)
      throw new Error('Another speech job is running. Cancel it before starting a new one.');
    const controller = new AbortController();
    this.active = controller;
    try {
      return await work(controller.signal);
    } finally {
      if (this.active === controller) this.active = null;
    }
  }

  private run(
    request: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: (event: SpeechProgress) => void,
    timeoutMs = 20 * 60 * 1000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Narration canceled.'));
        return;
      }
      const child = spawn(this.python, [this.sidecar, '--data-dir', this.options.dataDirectory], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      });
      let settled = false;
      let response: Record<string, unknown> | null = null;
      let failure: string | null = null;
      let outputBytes = 0;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', cancel);
        lines.close();
        if (error) reject(error);
        else resolve(response!);
      };
      const terminate = (reason: string) => {
        failure = reason;
        child.kill('SIGTERM');
        if (!killTimer) killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      };
      const cancel = () => terminate('Narration canceled. Completed clips remain cached.');
      const timeout = setTimeout(
        () => terminate('Speech engine timed out. Retry to resume from cached clips.'),
        timeoutMs,
      );
      signal?.addEventListener('abort', cancel, { once: true });
      const lines = createInterface({ input: child.stdout });
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 2 * 1024 * 1024) terminate('Speech engine returned too much output.');
      });
      // Drain library diagnostics; never forward raw logs or lesson text to the UI.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      lines.on('line', (line) => {
        if (settled || failure) return;
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress') {
            const progress = progressSchema.parse(event);
            onProgress?.({
              phase: progress.phase,
              completed: progress.completed,
              total: progress.total,
              message: progress.message,
            });
          } else if (event.type === 'done') response = event;
          else if (event.type === 'error')
            failure =
              typeof event.message === 'string'
                ? event.message.slice(0, 2000)
                : 'Speech generation failed.';
          else terminate('Speech engine returned an invalid response.');
        } catch {
          terminate('Speech engine returned an invalid response.');
        }
      });
      child.on('error', (cause: NodeJS.ErrnoException) =>
        finish(
          new Error(
            cause.code === 'ENOENT'
              ? 'Install the local speech engine with npm run setup:tts, then retry.'
              : `Could not start the local speech engine: ${cause.message}`,
          ),
        ),
      );
      child.on('close', (code) => {
        if (failure) finish(new Error(failure));
        else if (code !== 0 || !response)
          finish(
            new Error('Speech engine stopped before finishing. Run npm run setup:tts and retry.'),
          );
        else finish();
      });
      child.stdin.end(JSON.stringify(request) + '\n');
    });
  }
}
