import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface Executable {
  file: string;
  prefixArgs?: string[];
}
export function runAgentProcess(
  binary: Executable,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onLine?(line: string): void;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Lesson generation canceled.'));
      return;
    }
    const child = spawn(binary.file, [...(binary.prefixArgs ?? []), ...args], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: options.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    let failure: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (reason: string) => {
      failure ??= new Error(reason);
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          /* Already exited. */
        }
      };
      kill('SIGTERM');
      killTimer ??= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const onAbort = () =>
      terminate('Lesson generation canceled. Your current lesson is unchanged.');
    const timer = setTimeout(
      () => terminate('The agent timed out. Try a narrower workflow or fewer files.'),
      options.timeoutMs ?? 10 * 60 * 1000,
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        options.onLine?.(line);
      } catch (cause) {
        terminate(cause instanceof Error ? cause.message : 'The agent returned an invalid event.');
      }
    });
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (Buffer.byteLength(stdout) > 8 * 1024 * 1024)
        terminate('The agent output exceeded the 8 MB limit.');
    });
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 32768) stderr += data.toString().slice(0, 32768 - stderr.length);
    });
    child.stdin.on('error', () => {});
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      lines.close();
      options.signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `${binary.file} is not installed or is not on PATH.`
            : `Could not start the agent: ${error.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) {
        const diagnostics = stdout + '\n' + stderr;
        const reason =
          /(?:not logged|not authenticated|authentication|unauthorized|invalid.api.key|login required|please.*log.?in|401)/i.test(
            diagnostics,
          )
            ? 'Sign in to the selected CLI in a terminal, then retry.'
            : /(?:rate.limit|quota|usage.limit|429)/i.test(diagnostics)
              ? 'The selected provider reached a usage or rate limit. Retry later or select another agent.'
              : /(?:unknown|unrecognized|unexpected).*(?:option|argument)/i.test(diagnostics)
                ? 'Update the selected CLI; a required headless option is unavailable.'
                : 'Check the selected CLI login and model configuration in a terminal, then retry.';
        reject(new Error(`Agent exited with code ${code}. ${reason}`));
      } else resolve({ stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
  });
}
