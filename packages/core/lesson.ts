import { z } from 'zod';

export function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length < 1024 &&
    !/[\\\x00-\x1f:]/.test(value) &&
    !value.startsWith('/') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

export const relativePathSchema = z
  .string()
  .min(1)
  .max(1023)
  .regex(
    /^(?!\/)(?!.*[\\\x00-\x1f:])(?!(?:.*\/)?\.{1,2}(?:\/|$))[^/]+(?:\/[^/]+)*$/,
    'Expected a relative path',
  );
const anchorSchema = z
  .object({
    file: relativePathSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((anchor) => anchor.endLine >= anchor.startLine, 'Invalid line range');

const stepSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    narration: z.string().min(1).max(10000),
    speechText: z.string().min(1).max(10000).optional(),
    durationSeconds: z.number().positive().max(600),
    audio: relativePathSchema.optional(),
    anchor: anchorSchema,
  })
  .strict();

export const lessonSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    lessonId: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    repositoryRevision: z.string().min(1).max(200),
    learningObjectives: z.array(z.string().min(1).max(500)).min(1).max(20),
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            title: z.string().min(1).max(200),
            steps: z.array(stepSchema).min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    recap: z.string().max(3000),
  })
  .strict()
  .superRefine((lesson, context) => {
    const ids = new Set<string>();
    for (const item of lesson.scenes.flatMap((scene) => [scene, ...scene.steps])) {
      if (ids.has(item.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate ID: ${item.id}` });
      }
      ids.add(item.id);
    }
  });

export type CodeLesson = z.infer<typeof lessonSchema>;
export type LessonStep = z.infer<typeof stepSchema>;
export const flattenSteps = (lesson: CodeLesson) =>
  lesson.scenes.flatMap((scene) => scene.steps.map((step) => ({ ...step, scene: scene.title })));

export async function hashSource(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateAnchor(step: LessonStep, source: string): Promise<void> {
  if ((await hashSource(source)) !== step.anchor.sourceHash) {
    throw new Error(
      `Source changed: ${step.anchor.file}. Regenerate the lesson before continuing.`,
    );
  }
  const lineCount = source.split('\n').length;
  if (step.anchor.endLine > lineCount) {
    throw new Error(`Invalid source range in ${step.anchor.file}.`);
  }
}

export async function validateLessonSources(
  lesson: CodeLesson,
  readSource: (path: string) => Promise<string>,
) {
  const files = new Map<string, string>();
  for (const step of flattenSteps(lesson)) {
    const source = files.get(step.anchor.file) ?? (await readSource(step.anchor.file));
    files.set(step.anchor.file, source);
    await validateAnchor(step, source);
  }
}
