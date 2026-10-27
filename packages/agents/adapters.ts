import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runAgentProcess, type Executable } from './process';
import type { AgentId, GenerationRequest } from './contract';

export interface AdapterInput {
  binary: Executable;
  directory: string;
  schema: Record<string, unknown>;
  prompt: string;
  request: GenerationRequest;
  signal: AbortSignal;
  onProgress(message: string): void;
}

export function parseDocument(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(
      'The agent did not return a valid lesson JSON document. Try again with a narrower workflow.',
    );
  }
}

export async function runAdapter(agent: AgentId, input: AdapterInput): Promise<unknown> {
  const { binary, directory, prompt, signal, request, onProgress } = input;
  const modelArgs = request.model ? ['--model', request.model] : [];
  const env = { ...process.env, NO_COLOR: '1' };
  if (agent === 'codex') {
    const answer = path.join(directory, 'answer.json');
    await runAgentProcess(
      binary,
      [
        '--no-daemon',
        '-a',
        'never',
        'exec',
        '--ignore-user-config',
        '--ignore-rules',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--skip-git-repo-check',
        '--json',
        '--color',
        'never',
        '-c',
        'project_doc_max_bytes=0',
        '-c',
        'features.shell_tool=false',
        '-c',
        'features.apps=false',
        '-c',
        'features.hooks=false',
        '-c',
        'features.multi_agent=false',
        '-c',
        'web_search="disabled"',
        '--output-schema',
        path.join(directory, 'schema.json'),
        '--output-last-message',
        answer,
        ...modelArgs,
        '-',
      ],
      {
        cwd: directory,
        input: prompt,
        signal,
        env,
        onLine: (line) => {
          try {
            const event = JSON.parse(line);
            if (event.type === 'turn.started') onProgress('Codex is planning the walkthrough…');
          } catch {
            /* Non-event diagnostics are not rendered. */
          }
        },
      },
    );
    signal.throwIfAborted();
    let size: number;
    try {
      size = (await stat(answer)).size;
    } catch {
      throw new Error(
        'Codex did not produce a lesson. Check your CLI login and model, then retry.',
      );
    }
    if (size > 2 * 1024 * 1024) throw new Error('Generated lesson exceeds the 2 MB limit.');
    return parseDocument(await readFile(answer, 'utf8'));
  }
  if (agent === 'claude') {
    let document: unknown;
    let failure = false;
    let assistantText = '';
    const result = await runAgentProcess(
      binary,
      [
        '--print',
        '--safe-mode',
        '--output-format',
        'stream-json',
        '--verbose',
        '--tools',
        '',
        '--disallowedTools',
        'mcp__*',
        '--permission-mode',
        'dontAsk',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--json-schema',
        JSON.stringify(input.schema),
        '--max-turns',
        '4',
        ...modelArgs,
      ],
      {
        cwd: directory,
        input: prompt,
        signal,
        env,
        onLine: (line) => {
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.type === 'system' && event.subtype === 'init')
            onProgress('Claude Code is writing the walkthrough…');
          if (event.type === 'assistant') {
            const content = (event.message as { content?: { type: string; text?: string }[] })
              ?.content;
            assistantText =
              content
                ?.filter((part) => part.type === 'text')
                .map((part) => part.text ?? '')
                .join('') ?? assistantText;
          }
          if (event.type === 'result') {
            failure =
              event.is_error === true ||
              (typeof event.subtype === 'string' && event.subtype !== 'success');
            document =
              event.structured_output ??
              (typeof event.result === 'string' && event.result.trim() ? event.result : undefined);
          }
        },
      },
    );
    if (failure)
      throw new Error(
        'Claude Code could not finish the lesson. Check its login, model access, and usage limits in a terminal.',
      );
    if (document && typeof document === 'object') return document;
    return parseDocument(typeof document === 'string' ? document : assistantText || result.stdout);
  }
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}');
  } catch {
    throw new Error('OPENCODE_CONFIG_CONTENT must contain valid JSON.');
  }
  let text = '';
  const textParts = new Map<string, string>();
  await runAgentProcess(
    binary,
    [
      'run',
      '--format',
      'json',
      '--agent',
      'codecast_lesson',
      '--title',
      'CodeCast walkthrough',
      ...modelArgs,
    ],
    {
      cwd: directory,
      input: prompt,
      signal,
      env: {
        ...env,
        OPENCODE_PURE: '1',
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
        OPENCODE_DISABLE_CLAUDE_CODE: '1',
        OPENCODE_PERMISSION: '{"*":"deny"}',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...config,
          permission: { '*': 'deny' },
          snapshot: false,
          agent: {
            codecast_lesson: {
              mode: 'primary',
              description: 'Explain the provided source without tools.',
              prompt:
                'Return only the requested lesson JSON, using the source in the prompt. Do not use tools.',
              permission: { '*': 'deny' },
              tools: { '*': false },
            },
          },
          tools: { '*': false },
        }),
      },
      onLine: (line) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === 'step_start') onProgress('OpenCode is writing the walkthrough…');
        if (event.type === 'text' && typeof (event.part as { text?: unknown })?.text === 'string') {
          const part = event.part as { id?: string; text: string };
          if (part.id) textParts.set(part.id, part.text);
          else text += part.text;
        }
        if (event.type === 'error')
          throw new Error(
            'OpenCode reported a provider error. Check your provider login and selected model in a terminal.',
          );
      },
    },
  );
  return parseDocument(textParts.size ? [...textParts.values()].join('\n') : text);
}
