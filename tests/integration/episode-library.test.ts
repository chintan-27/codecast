import { afterEach, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EpisodeLibrary } from '../../packages/storage/episode-library';
import { RepositoryAccess } from '../../packages/repository/access';
import { flattenSteps, lessonSchema, validateLessonSources } from '../../packages/core/lesson';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecast-library-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await cp('tests/fixtures/sample', project, { recursive: true });
  const lesson = lessonSchema.parse(
    JSON.parse(await readFile(path.join(project, 'codecast.lesson.json'), 'utf8')),
  );
  return {
    root,
    project,
    lesson,
    repo: await RepositoryAccess.open(project),
    library: new EpisodeLibrary(path.join(root, 'episodes')),
  };
}
it('keeps source and audio playable after original project deletion and restores the last selection', async () => {
  const { root, project, lesson, repo, library } = await fixture();
  const entry = await library.save(repo, lesson);
  expect((await library.save(repo, lesson)).id).toBe(entry.id);
  await library.remember(entry.id);
  await rm(project, { recursive: true });
  const reopened = new EpisodeLibrary(path.join(root, 'episodes'));
  expect(await reopened.lastId()).toBe(entry.id);
  expect(await reopened.list()).toEqual([entry]);
  const saved = await reopened.get(entry.id);
  await validateLessonSources(saved.record.lesson, saved.source.readSource.bind(saved.source));
  for (const step of flattenSteps(saved.record.lesson)) {
    expect(await saved.media.readAudio(step.audio!)).toMatch(/^data:audio\//);
  }
});
it('persists generated narration with measured duration and rejects mismatched segments', async () => {
  const { lesson, repo, library } = await fixture();
  const entry = await library.save(repo, lesson);
  const clips = flattenSteps(lesson).map((step) => ({
    stepId: step.id,
    cacheKey: 'a'.repeat(64),
    durationSeconds: 42,
    cached: true,
  }));
  await expect(library.attachNarration(entry.id, clips.slice(1), async () => '')).rejects.toThrow(
    'does not match',
  );
  const updated = await library.attachNarration(
    entry.id,
    clips,
    async () => 'data:audio/wav;base64,UklGRg==',
  );
  expect(updated.durationSeconds).toBe(clips.length * 42);
  expect(
    flattenSteps((await library.get(entry.id)).record.lesson).every(
      (step) => step.durationSeconds === 42,
    ),
  ).toBe(true);
});
it('rejects stale source without publishing a partial episode and refuses escaping paths', async () => {
  const { root, project, lesson, repo, library } = await fixture();
  await writeFile(path.join(project, 'src/checkout.ts'), '// changed');
  await expect(library.save(repo, lesson)).rejects.toThrow();
  expect(await library.list()).toEqual([]);
  await expect(library.get('../outside')).rejects.toThrow();
  await symlink(project, path.join(root, 'episodes', 'b'.repeat(64)));
  await expect(library.get('b'.repeat(64))).rejects.toThrow('not allowed');
});
