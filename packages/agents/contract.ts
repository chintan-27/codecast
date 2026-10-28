import { z } from 'zod';
import { relativePathSchema } from '../core/lesson';
import type { CodeLesson } from '../core/lesson';

export const agentDefinitions = [
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    setup: 'Install Codex CLI and run codex login in a terminal.',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    setup: 'Install Claude Code and sign in by running claude in a terminal.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    setup: 'Install OpenCode and connect a provider by running opencode in a terminal.',
  },
] as const;
export const agentIdSchema = z.enum(['codex', 'claude', 'opencode']);
export type AgentId = z.infer<typeof agentIdSchema>;
export interface AgentStatus {
  id: AgentId;
  available: boolean;
  version?: string;
  message: string;
}
export interface GenerationProgress {
  phase: 'reading' | 'generating' | 'validating' | 'saving';
  message: string;
}
export interface GenerationResult {
  lesson: CodeLesson;
  agent: AgentId;
  context: { files: number; bytes: number; revision: string };
  savedEpisodeId?: string;
}
export const generationRequestSchema = z
  .object({
    agent: agentIdSchema,
    objective: z.string().trim().min(10).max(2000),
    depth: z.enum(['overview', 'deep']),
    files: z.array(relativePathSchema).min(1).max(24),
    model: z
      .string()
      .max(200)
      .regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9._:/+\-]*)?$/)
      .default(''),
  })
  .strict()
  .refine(
    (request) => new Set(request.files).size === request.files.length,
    'Select each source file only once.',
  );
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export const draftLessonSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    learningObjectives: z.array(z.string().min(1).max(500)).min(1).max(10),
    scenes: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            steps: z
              .array(
                z
                  .object({
                    title: z.string().min(1).max(200),
                    narration: z.string().min(1).max(3000),
                    file: z.string().min(1).max(1023),
                    startLine: z.number().int().positive(),
                    endLine: z.number().int().positive(),
                  })
                  .strict(),
              )
              .min(1)
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    recap: z.string().min(1).max(3000),
  })
  .strict();
export type DraftLesson = z.infer<typeof draftLessonSchema>;

const sourceExtensions =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|c|h|cpp|hpp|vue|svelte|html|css|scss|sql|json|toml|ya?ml|md|sh)$/i;
export function isLessonSource(file: string) {
  return (
    sourceExtensions.test(file) &&
    !/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(file) &&
    !/(?:^|\/)(?:package-lock\.json|.*\.lock|.*\.min\.[jc]s|.*\.lesson\.json)$/i.test(file)
  );
}
export function suggestSources(files: string[]) {
  return files
    .filter(isLessonSource)
    .sort((a, b) => {
      const score = (file: string) =>
        (/\/(src|app|routes|api)\//.test('/' + file) ? 10 : 0) +
        (/\b(main|index|server|app|checkout|router)\./i.test(file) ? 5 : 0) -
        (/\b(test|spec|fixture)/i.test(file) ? 8 : 0) -
        file.split('/').length;
      return score(b) - score(a) || a.localeCompare(b);
    })
    .slice(0, 12);
}
