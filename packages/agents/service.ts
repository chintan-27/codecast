import { mkdir, mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { RepositoryAccess } from '../repository/access';
import { runAgentProcess, type Executable } from './process';
import { runAdapter } from './adapters';
import { collectContext, finalizeLesson, lessonPrompt } from './context';
import {
  agentDefinitions,
  draftLessonSchema,
  generationRequestSchema,
  type AgentId,
  type AgentStatus,
  type GenerationProgress,
  type GenerationRequest,
  type GenerationResult,
} from './contract';

export class LessonGenerationService {
  private active: AbortController | null = null;
  private binaries: Record<AgentId, Executable>;

  constructor(
    private readonly options: {
      dataDirectory: string;
      binaries?: Partial<Record<AgentId, Executable>>;
    },
  ) {
    this.binaries = {
      codex: { file: process.env.CODECAST_CODEX_BIN ?? 'codex' },
      claude: { file: process.env.CODECAST_CLAUDE_BIN ?? 'claude' },
      opencode: { file: process.env.CODECAST_OPENCODE_BIN ?? 'opencode' },
      ...options.binaries,
    };
  }

  async detect(): Promise<AgentStatus[]> {
    const directory = await mkdtemp(path.join(tmpdir(), 'codecast-detect-'));
    try {
      return await Promise.all(
        agentDefinitions.map(async (agent) => {
          try {
            const { stdout } = await runAgentProcess(this.binaries[agent.id], ['--version'], {
              cwd: directory,
              timeoutMs: 15000,
            });
            const version = stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
            if (!version) throw new Error('No recognizable version.');
            return {
              id: agent.id,
              available: true,
              version,
              message:
                'CLI detected. Uses your existing sign-in; model access is checked when generation starts.',
            };
          } catch {
            return { id: agent.id, available: false, message: agent.setup };
          }
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  cancel() {
    this.active?.abort();
  }

  async generate(
    repo: RepositoryAccess,
    request: GenerationRequest,
    onProgress: (event: GenerationProgress) => void,
  ): Promise<GenerationResult> {
    const parsed = generationRequestSchema.parse(request);
    if (this.active)
      throw new Error('Another lesson is being generated. Cancel it before starting a new one.');
    const controller = new AbortController();
    this.active = controller;
    let directory: string | undefined;
    try {
      onProgress({
        phase: 'reading',
        message: 'Reading and fingerprinting the selected source files…',
      });
      const context = await collectContext(repo, parsed.files, controller.signal);
      controller.signal.throwIfAborted();
      directory = await mkdtemp(path.join(tmpdir(), 'codecast-agent-'));
      const schema = z.toJSONSchema(draftLessonSchema);
      delete schema.$schema;
      await writeFile(path.join(directory, 'schema.json'), JSON.stringify(schema), { mode: 0o600 });
      onProgress({
        phase: 'generating',
        message: 'Starting the selected agent. This may take a few minutes…',
      });
      const raw = await runAdapter(parsed.agent, {
        binary: this.binaries[parsed.agent],
        directory,
        schema,
        prompt: lessonPrompt(parsed, context, schema),
        request: parsed,
        signal: controller.signal,
        onProgress: (message) => onProgress({ phase: 'generating', message }),
      });
      controller.signal.throwIfAborted();
      onProgress({
        phase: 'validating',
        message: 'Checking lesson structure, source ranges, and source freshness…',
      });
      const lesson = await finalizeLesson(raw, context, repo);
      controller.signal.throwIfAborted();
      onProgress({ phase: 'saving', message: 'Saving the validated lesson in CodeCast…' });
      const destination = path.join(this.options.dataDirectory, 'lessons');
      await mkdir(destination, { recursive: true });
      const temporary = path.join(destination, `.${lesson.lessonId}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(lesson, null, 2) + '\n', { mode: 0o600 });
        controller.signal.throwIfAborted();
        await rename(temporary, path.join(destination, `${lesson.lessonId}.json`));
      } finally {
        await rm(temporary, { force: true });
      }
      return {
        lesson,
        agent: parsed.agent,
        context: { files: context.files.length, bytes: context.bytes, revision: context.revision },
      };
    } catch (cause) {
      if (controller.signal.aborted)
        throw new Error('Lesson generation canceled. Your current lesson is unchanged.');
      throw cause;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (this.active === controller) this.active = null;
    }
  }
}
