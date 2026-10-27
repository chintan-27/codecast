import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  lessonSchema,
  flattenSteps,
  validateAnchor,
  validateLessonSources,
  hashSource,
} from '../../packages/core/lesson';
import example from '../fixtures/sample/codecast.lesson.json';

describe('CodeLesson contract', () => {
  it('validates the complete fixture against its actual source files', async () => {
    const lesson = lessonSchema.parse(example);
    await expect(
      validateLessonSources(lesson, (file) => readFile(`tests/fixtures/sample/${file}`, 'utf8')),
    ).resolves.toBeUndefined();
    expect(flattenSteps(lesson)).toHaveLength(6);
  });

  it.each([
    '../outside.ts',
    '/etc/passwd',
    'C:/file.ts',
    'src/../../file.ts',
    'src\\file.ts',
    'src//file.ts',
    'https://example.com',
  ])('rejects unsafe anchor path %s', (file) => {
    const lesson = structuredClone(example);
    lesson.scenes[0].steps[0].anchor.file = file;
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
  });

  it('rejects unsupported versions, unknown fields, reversed ranges, and duplicate IDs', () => {
    expect(lessonSchema.safeParse({ ...example, schemaVersion: '2.0' }).success).toBe(false);
    expect(lessonSchema.safeParse({ ...example, executable: 'run me' }).success).toBe(false);
    const lesson = structuredClone(example);
    lesson.scenes[0].steps[0].anchor.endLine = 1;
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
    lesson.scenes[0].steps[0].anchor.endLine = 14;
    lesson.scenes[0].steps[1].id = lesson.scenes[0].steps[0].id;
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
  });

  it('refuses stale source rather than silently highlighting different code', async () => {
    const step = flattenSteps(lessonSchema.parse(example))[0];
    await expect(validateAnchor(step, 'changed source')).rejects.toThrow('Source changed');
  });

  it('rejects ranges outside a matching source snapshot', async () => {
    const step = flattenSteps(lessonSchema.parse(example))[0];
    const source = 'only one line';
    step.anchor.sourceHash = await hashSource(source);
    await expect(validateAnchor(step, source)).rejects.toThrow('Invalid source range');
  });
});
