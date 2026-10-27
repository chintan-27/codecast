import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { lessonSchema } from './lesson';
import { draftLessonSchema } from '../agents/contract';

async function main() {
  const schema = z.toJSONSchema(lessonSchema, { target: 'draft-2020-12' });
  await mkdir('schemas', { recursive: true });
  await writeFile(
    'schemas/agent-lesson.schema.json',
    JSON.stringify(z.toJSONSchema(draftLessonSchema), null, 2) + '\n',
  );
  await writeFile(
    'schemas/codelesson-v1.schema.json',
    JSON.stringify(
      {
        ...schema,
        $id: 'urn:codecast:codelesson:1.0',
        title: 'CodeLesson 1.0',
        description:
          'Runtime validation additionally checks unique IDs, ordered line ranges, and SHA-256 source hashes.',
      },
      null,
      2,
    ) + '\n',
  );
}

void main();
