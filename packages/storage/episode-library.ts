import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  flattenSteps,
  lessonSchema,
  validateAnchor,
  validateLessonSources,
  type CodeLesson,
} from '../core/lesson';
import { RepositoryAccess } from '../repository/access';
import { speechClipSchema, type SpeechClip } from '../speech/contract';
import type { SavedEpisode } from './episode-contract';

const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z
  .object({
    id: idSchema,
    projectRoot: z.string().min(1),
    projectName: z.string().min(1),
    savedAt: z.string().datetime(),
    lesson: lessonSchema,
  })
  .strict();
type EpisodeRecord = z.infer<typeof recordSchema>;

function summary(record: EpisodeRecord): SavedEpisode {
  const steps = flattenSteps(record.lesson);
  return {
    id: record.id,
    title: record.lesson.title,
    projectName: record.projectName,
    savedAt: record.savedAt,
    durationSeconds: steps.reduce((total, step) => total + step.durationSeconds, 0),
    stepCount: steps.length,
    audioStepCount: steps.filter((step) => step.audio).length,
  };
}

export class EpisodeLibrary {
  private stateWrites: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async list(): Promise<SavedEpisode[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const episodes: SavedEpisode[] = [];
    for (const entry of entries.slice(0, 1000)) {
      if (!entry.isDirectory() || !idSchema.safeParse(entry.name).success) continue;
      try {
        episodes.push(summary((await this.get(entry.name)).record));
      } catch {
        /* Incomplete/corrupt entries cannot be opened. */
      }
    }
    return episodes.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async get(id: string) {
    idSchema.parse(id);
    const root = await realpath(this.directory);
    const entry = await realpath(path.join(root, id));
    if (path.dirname(entry) !== root) throw new Error('Saved episode path is not allowed.');
    const filename = await realpath(path.join(entry, 'record.json'));
    if (path.dirname(filename) !== entry || (await stat(filename)).size > 2 * 1024 * 1024)
      throw new Error('Saved episode metadata is invalid.');
    const record = recordSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
    if (record.id !== id) throw new Error('Saved episode identity is invalid.');
    const sourceRoot = await realpath(path.join(entry, 'source'));
    if (path.dirname(sourceRoot) !== entry) throw new Error('Saved source path is not allowed.');
    return {
      record,
      entry: summary(record),
      source: await RepositoryAccess.open(sourceRoot),
      media: await RepositoryAccess.open(entry),
    };
  }

  async save(repo: RepositoryAccess, input: CodeLesson): Promise<SavedEpisode> {
    const lesson = lessonSchema.parse(structuredClone(input));
    const steps = flattenSteps(lesson);
    if (steps.length > 200) throw new Error('Saved episodes are limited to 200 segments.');
    const id = createHash('sha256')
      .update(repo.directory + '\0' + JSON.stringify(lesson))
      .digest('hex');
    await mkdir(this.directory, { recursive: true });
    try {
      return (await this.get(id)).entry;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    const temporary = path.join(this.directory, `.saving-${randomUUID()}`);
    await mkdir(path.join(temporary, 'source'), { recursive: true });
    try {
      const sources = new Map<string, string>();
      for (const step of steps) {
        const source = sources.get(step.anchor.file) ?? (await repo.readSource(step.anchor.file));
        await validateAnchor(step, source);
        if (!sources.has(step.anchor.file)) {
          sources.set(step.anchor.file, source);
          const destination = path.join(temporary, 'source', step.anchor.file);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, source, { mode: 0o600 });
        }
      }
      let index = 0;
      for (const scene of lesson.scenes)
        for (const step of scene.steps) {
          index++;
          if (step.audio)
            step.audio = await this.writeAudio(temporary, index, await repo.readAudio(step.audio));
        }
      await validateLessonSources(input, repo.readSource.bind(repo));
      const record: EpisodeRecord = {
        id,
        projectRoot: repo.directory,
        projectName: path.basename(repo.directory),
        savedAt: new Date().toISOString(),
        lesson,
      };
      const serialized = JSON.stringify(record, null, 2) + '\n';
      if (Buffer.byteLength(serialized) > 2 * 1024 * 1024)
        throw new Error('Saved episode metadata exceeds 2 MB.');
      await writeFile(path.join(temporary, 'record.json'), serialized, {
        mode: 0o600,
      });
      await rename(temporary, path.join(this.directory, id));
      return summary(record);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async attachNarration(
    id: string,
    input: SpeechClip[],
    readAudio: (key: string) => Promise<string>,
  ) {
    const clips = z.array(speechClipSchema).min(1).max(200).parse(input);
    const saved = await this.get(id);
    const lesson = structuredClone(saved.record.lesson);
    const steps = flattenSteps(lesson);
    const byId = new Map(clips.map((clip) => [clip.stepId, clip]));
    if (
      byId.size !== steps.length ||
      clips.length !== steps.length ||
      steps.some((step) => !byId.has(step.id))
    )
      throw new Error('Narration does not match the saved episode.');
    let index = 0;
    for (const scene of lesson.scenes)
      for (const step of scene.steps) {
        const clip = byId.get(step.id)!;
        step.audio = await this.writeAudio(
          saved.media.directory,
          ++index,
          await readAudio(clip.cacheKey),
          randomUUID(),
        );
        step.durationSeconds = clip.durationSeconds;
      }
    const record = { ...saved.record, lesson };
    const temporary = path.join(saved.media.directory, `.record-${randomUUID()}.json`);
    try {
      await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, path.join(saved.media.directory, 'record.json'));
    } finally {
      await rm(temporary, { force: true });
    }
    return summary(record);
  }

  remember(id: string): Promise<void> {
    idSchema.parse(id);
    const operation = this.stateWrites.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = path.join(this.directory, `.state-${randomUUID()}.json`);
      try {
        await writeFile(temporary, JSON.stringify({ lastEpisodeId: id }), { mode: 0o600 });
        await rename(temporary, path.join(this.directory, 'state.json'));
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.stateWrites = operation.catch(() => {});
    return operation;
  }

  async lastId(): Promise<string | null> {
    try {
      const filename = path.join(this.directory, 'state.json');
      if ((await stat(filename)).size > 4096) throw new Error('Saved session metadata is invalid.');
      return idSchema.parse(JSON.parse(await readFile(filename, 'utf8')).lastEpisodeId);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  private async writeAudio(root: string, index: number, uri: string, suffix = '') {
    const match = /^data:(audio\/(?:wav|mpeg|ogg|mp4));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(uri);
    if (!match) throw new Error('Episode audio format is unsupported.');
    const audio = Buffer.from(match[2], 'base64');
    if (!audio.length || audio.length > 25 * 1024 * 1024)
      throw new Error('Episode audio exceeds the size limit.');
    const extensions: Record<string, string> = {
      'audio/wav': '.wav',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg',
      'audio/mp4': '.m4a',
    };
    const relative = `audio/segment-${index}${suffix ? `-${suffix}` : ''}${extensions[match[1]]}`;
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    if ((await realpath(path.dirname(destination))) !== path.join(await realpath(root), 'audio'))
      throw new Error('Episode audio path is not allowed.');
    await writeFile(destination, audio, { mode: 0o600, flag: 'wx' });
    return relative;
  }
}
