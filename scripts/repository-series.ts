import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LessonGenerationService } from '../packages/agents/service';
import { collectContext } from '../packages/agents/context';
import { agentIdSchema, isLessonSource } from '../packages/agents/contract';
import { flattenSteps, lessonSchema, validateLessonSources } from '../packages/core/lesson';
import { RepositoryAccess } from '../packages/repository/access';
import { EpisodeLibrary } from '../packages/storage/episode-library';
import { SpeechService } from '../packages/speech/service';

// A listening series about this repository, grouped by the behavior each episode follows.
// Every eligible source/config/test/document is assigned once; recordings and locks are inventoried separately.
const topics = [
  {
    title: 'The shape of CodeCast',
    match: /^(README\.md|implementation_plan\.md|docs\/architecture\.md)$/,
    focus:
      'Introduce what CodeCast does and how its pieces fit. Distinguish implemented behavior documented in README from proposals in the historical implementation plan. Explain trust boundaries and the end-to-end listening experience.',
  },
  {
    title: 'Opening the desktop',
    match:
      /^(apps\/desktop\/(electron\/|index\.html|src\/(main\.tsx|env\.d\.ts))|packages\/core\/contracts\.ts|scripts\/(dev|build-electron)\.mjs|(?:package|tsconfig)\.json|vite\.config\.ts)/,
    focus:
      'Trace startup from development/build commands into Electron, preload IPC, the renderer, and window lifecycle. Explain trusted senders, permissions, custom-protocol assets, navigation, and failure behavior.',
  },
  {
    title: 'The repository boundary',
    match:
      /^(packages\/repository\/|apps\/desktop\/src\/repository\.ts|tests\/integration\/repository\.test\.ts)/,
    focus:
      'Follow folder selection into file enumeration, ignore rules, secret filtering, safe path resolution, symlink checks, text/audio reads, and browser fallback. Use concrete allowed and rejected examples.',
  },
  {
    title: 'The podcast contract',
    match: /^(packages\/core\/|schemas\/|docs\/lesson-format\.md|tests\/unit\/lesson\.test\.ts)/,
    focus:
      'Explain the episode data contract, chapter/segment structure, exact SHA-256 references, line ranges, schema export, validation failures, and what version 1 can and cannot represent.',
  },
  {
    title: 'Code that follows the voice',
    match:
      /^(apps\/desktop\/src\/(App|CodeViewer)\.tsx|packages\/playback\/|tests\/unit\/playback\.test\.ts)/,
    focus:
      'Trace playback through React effects, loading races, source verification, editor decoration, audio events, seeking, mute, speed, reading mode, and deterministic transitions. Explain cancellation tokens and failure recovery using code evidence.',
  },
  {
    title: 'Writing a code podcast',
    match:
      /^(packages\/agents\/(contract|context)\.ts|apps\/desktop\/src\/GenerationPanel\.tsx|docs\/agents\.md)/,
    focus:
      'Follow topic and source selection into bounded numbered context, prompt construction, structured drafts, host-generated identities/hashes, freshness checks, review, and loading. Explain narrative depth and provider disclosure without turning the episode into a course.',
  },
  {
    title: 'Talking to coding agents',
    match:
      /^(packages\/agents\/|tests\/integration\/agents\.test\.ts|tests\/fixtures\/(fake-agent\.mjs|agent-draft\.json))/,
    focus:
      'Compare Codex, Claude Code, and OpenCode adapters. Trace subprocess arguments, disabled tools, isolated directories, streamed output, normalization, cancellation, timeouts, authentication failures, and validation. Explain how fake agents test those boundaries.',
  },
  {
    title: 'Making the voice',
    match: /^(packages\/speech\/|services\/tts\/|docs\/tts\.md|scripts\/setup-tts\.mjs)/,
    focus:
      'Follow local Kokoro setup and offline generation, pinned assets, voice selection, normalization, cache keys, WAV writing, audio validation, process protocol, cancellation, CPU limits, and Python tests. Distinguish speech synthesis from coding-agent script generation.',
  },
  {
    title: 'Keeping the narration',
    match:
      /^(apps\/desktop\/src\/SpeechPanel\.tsx|tests\/(desktop\/speech\.spec|integration\/speech\.test)\.ts)/,
    focus:
      'Follow narration UI state, focus handling, runtime readiness, voice changes, source freshness, progress, cancellation, cache reuse, persistent narration, and boundary tests. Explain the user-visible failure paths.',
  },
  {
    title: 'A library that survives edits',
    match:
      /^(packages\/storage\/|apps\/desktop\/src\/EpisodeLibrary\.tsx|tests\/(desktop\/library\.spec|integration\/episode-library\.test)\.ts)/,
    focus:
      'Trace atomic episode saving, immutable source snapshots, copied media, narration updates, deduplication, last-selection restore, library UI, missing original projects, traversal protection, and restart tests. Explain the difference between recorded code and the live project.',
  },
  {
    title: 'The desktop experience',
    match: /^(apps\/desktop\/src\/(styles\.css|demo\.ts)|tests\/fixtures\/sample\/)/,
    focus:
      'Explain the visual layout, responsive rules, editor/player presentation, sample repository and bundled episode. Use the checkout example to connect a listener action with validation and storage. Discuss only evidenced UI behavior.',
  },
  {
    title: 'Proving the journey',
    match: /./,
    focus:
      'Explain how the remaining tests, build/test configuration, smoke scripts, self-podcast exports and series runner establish confidence. Walk through real inputs and observable assertions, differentiate fake-provider checks from opt-in live tests, and describe actual limitations.',
  },
];
const run = promisify(execFile);
const root = process.cwd();
const output = path.resolve(process.argv[2] ?? 'artifacts/codecast-series');
if (!path.relative(root, output).startsWith(`artifacts${path.sep}`))
  throw new Error('Keep series output under this repository’s artifacts directory.');
const appData =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
const data = path.join(appData, 'codecast');
const libraryDirectory = process.env.CODECAST_EPISODES_DIR ?? path.join(data, 'episodes');
const library = new EpisodeLibrary(libraryDirectory);
const agent = agentIdSchema.parse(process.env.CODECAST_SERIES_AGENT ?? 'codex');
const generation = new LessonGenerationService({ dataDirectory: path.join(output, 'generation') });
const speech = new SpeechService({
  projectRoot: root,
  dataDirectory: process.env.CODECAST_TTS_DATA_DIR ?? path.join(data, 'speech'),
  python: process.env.CODECAST_TTS_PYTHON,
});
const cancel = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    cancel.abort();
    generation.cancel();
    speech.cancel();
  });
const json = async (filename: string, value: unknown) =>
  writeFile(filename, JSON.stringify(value, null, 2) + '\n');
async function main() {
  const repo = await RepositoryAccess.open(root);
  const inventory = await repo.summary();
  if (inventory.truncated)
    throw new Error('Repository inventory was truncated; cannot claim complete series coverage.');
  const eligible = inventory.files.filter(isLessonSource);
  const assignments = topics.map((topic) => ({ ...topic, files: [] as string[] }));
  for (const file of eligible)
    assignments.find((topic) => topic.match.test(file))!.files.push(file);
  const episodes = [];
  for (const topic of assignments) {
    let files: string[] = [],
      bytes = 0,
      part = 1;
    const batches: string[][] = [];
    for (const file of topic.files.sort()) {
      const size = Buffer.byteLength(await repo.readSource(file));
      if (size > 64 * 1024)
        throw new Error(`Split the oversized source before generating: ${file}`);
      if (files.length && (files.length >= 16 || bytes + size > 100 * 1024)) {
        batches.push(files);
        files = [];
        bytes = 0;
      }
      files.push(file);
      bytes += size;
    }
    if (files.length) batches.push(files);
    for (const files of batches)
      episodes.push({
        number: episodes.length + 1,
        title: topic.title + (batches.length > 1 ? ` · part ${part++}` : ''),
        focus: topic.focus,
        files,
      });
  }
  await mkdir(output, { recursive: true });
  const snapshots = [];
  for (const episode of episodes)
    snapshots.push(await collectContext(repo, episode.files, cancel.signal));
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(snapshots.map((context) => context.revision)))
    .digest('hex');
  const plan = {
    title: 'Inside CodeCast',
    fingerprint,
    agent,
    target:
      'Approximately 10–15 minutes per episode; measured audio duration is reported after synthesis.',
    episodes,
    selectedFiles: eligible.length,
    excludedFiles: inventory.files.filter((file) => !isLessonSource(file)),
    coverageMeaning:
      'Every eligible source/config/test/document is supplied to one episode and must have at least one verified source reference. This is not line-by-line coverage. Generated artifacts, dependencies, instructions, lockfiles, and binary assets are excluded.',
  };
  const planFile = path.join(output, 'plan.json');
  try {
    const previous = JSON.parse(await readFile(planFile, 'utf8'));
    if (previous.fingerprint !== fingerprint && !process.argv.includes('--plan'))
      throw new Error(
        'Repository changed since this series was planned. Use a new artifact directory.',
      );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
  await json(planFile, plan);
  await writeFile(
    path.join(output, 'plan.md'),
    `# Inside CodeCast\n\n${plan.coverageMeaning}\n\n${episodes.map((episode) => `## ${episode.number}. ${episode.title}\n\n${episode.focus}\n\n${episode.files.map((file) => `- ${file}`).join('\n')}`).join('\n\n')}\n`,
  );
  console.log(
    `Series plan: ${episodes.length} episodes, ${eligible.length} source/config/test/document files. ${planFile}`,
  );
  if (process.argv.includes('--plan')) return;
  const scriptsOnly = process.argv.includes('--scripts-only');
  if (!scriptsOnly) {
    const status = await speech.status();
    if (!status.ready)
      throw new Error(status.message + ' No downloads are performed by this script.');
  }
  const requested = process.argv.find((arg) => arg.startsWith('--episode='));
  const selectedEpisodes = requested
    ? episodes.filter((episode) => episode.number === Number(requested.split('=')[1]))
    : episodes;
  if (!selectedEpisodes.length) throw new Error('Episode number is outside the plan.');
  for (const episode of selectedEpisodes) {
    cancel.signal.throwIfAborted();
    const directory = path.join(output, String(episode.number).padStart(2, '0'));
    await mkdir(directory, { recursive: true });
    const scriptFile = path.join(directory, 'script.json');
    let lesson;
    try {
      lesson = lessonSchema.parse(JSON.parse(await readFile(scriptFile, 'utf8')));
      await validateLessonSources(lesson, repo.readSource.bind(repo));
      console.log(`Reusing script ${episode.number}.`);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      console.log(`Writing episode ${episode.number}/${episodes.length}: ${episode.title}`);
      const result = await generation.generate(
        repo,
        {
          agent,
          model: process.env.CODECAST_SERIES_MODEL ?? '',
          depth: 'deep',
          files: episode.files,
          objective: `Inside CodeCast, episode ${episode.number} of ${episodes.length}: ${episode.title}. ${episode.focus} This is a detailed podcast with roughly 1,400–2,200 spoken words, not a summary or curriculum. Give every supplied file at least one relevant, specific source-anchored segment. Discuss how pieces interact, concrete examples and limitations. Keep this episode within its assigned scope. Other episodes cover other subsystems.`,
        },
        (event) => console.log(event.message),
      );
      lesson = result.lesson;
      lesson.title = `Inside CodeCast · ${String(episode.number).padStart(2, '0')} · ${episode.title}`;
      const referenced = new Set(flattenSteps(lesson).map((step) => step.anchor.file));
      const missing = episode.files.filter((file) => !referenced.has(file));
      const words = flattenSteps(lesson).reduce(
        (total, step) => total + step.narration.trim().split(/\s+/).length,
        0,
      );
      if (missing.length || words < 1200) {
        await json(path.join(directory, 'rejected-draft.json'), lesson);
        throw new Error(
          `Episode ${episode.number} needs revision: ${words} words; missing file references: ${missing.join(', ') || 'none'}. Draft preserved; no narration generated.`,
        );
      }
      await json(scriptFile, lesson);
    }
    const referenced = new Set(flattenSteps(lesson).map((step) => step.anchor.file));
    const words = flattenSteps(lesson).reduce(
      (total, step) => total + step.narration.trim().split(/\s+/).length,
      0,
    );
    if (words < 1200 || episode.files.some((file) => !referenced.has(file)))
      throw new Error(
        `Saved script ${episode.number} does not meet the series coverage/depth requirements.`,
      );
    const entry = await library.save(repo, lesson);
    await writeFile(
      path.join(directory, 'transcript.md'),
      `# ${lesson.title}\n\n${flattenSteps(lesson)
        .map(
          (step) =>
            `## ${step.title}\n\n${step.narration}\n\nSource: ${step.anchor.file}:${step.anchor.startLine}–${step.anchor.endLine}`,
        )
        .join('\n\n')}\n`,
    );
    await json(path.join(directory, 'script-verification.json'), {
      ...entry,
      agent,
      words,
      sourceReferencesVerified: true,
      selectedFiles: episode.files,
      referencedFiles: [...referenced],
      allSelectedFilesReferenced: true,
      seriesFingerprint: fingerprint,
      audioReady: entry.audioStepCount === entry.stepCount,
      durationIsEstimate: entry.audioStepCount !== entry.stepCount,
    });
    if (scriptsOnly) {
      console.log(
        `Episode ${episode.number} script ready in Episode library: ${words} words, ${entry.stepCount} segments. ${entry.audioStepCount === entry.stepCount ? 'Existing narration retained.' : 'Choose Narration in the desktop app to render audio on demand.'}`,
      );
      continue;
    }
    let saved = entry;
    let cachedSegments = 0;
    if (entry.audioStepCount === entry.stepCount) {
      const existing = await library.get(entry.id);
      for (const step of flattenSteps(existing.record.lesson))
        await existing.media.readAudio(step.audio!);
      cachedSegments = entry.stepCount;
      console.log(`Reusing saved narration for episode ${episode.number}.`);
    } else {
      console.log(
        `Saved script ${episode.number} to the desktop library. Rendering local Kokoro narration sequentially…`,
      );
      const clips = await speech.generate(
        {
          voice: 'af_heart',
          steps: flattenSteps(lesson).map((step) => ({
            id: step.id,
            text: step.speechText ?? step.narration,
          })),
        },
        (event) => console.log(event.message),
      );
      saved = await library.attachNarration(entry.id, clips, (key) => speech.readAudio(key));
      cachedSegments = clips.filter((clip) => clip.cached).length;
    }
    const record = await library.get(entry.id);
    await json(path.join(directory, 'library-episode.json'), record.record.lesson);
    const quoteConcatPath = (filename: string) => filename.replace(/'/g, "'\\''");
    await writeFile(
      path.join(directory, 'concat.txt'),
      flattenSteps(record.record.lesson)
        .map((step) => `file '${quoteConcatPath(path.join(record.media.directory, step.audio!))}'`)
        .join('\n') + '\n',
    );
    await run(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'concat.txt',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '3',
        '-metadata',
        `title=${lesson.title}`,
        'episode.mp3',
      ],
      { cwd: directory, signal: cancel.signal },
    );
    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        path.join(directory, 'episode.mp3'),
      ],
      { signal: cancel.signal },
    );
    const media = JSON.parse(stdout);
    if (
      media.streams[0]?.codec_type !== 'audio' ||
      !Number.isFinite(Number(media.format.duration)) ||
      Math.abs(Number(media.format.duration) - saved.durationSeconds) > 0.25
    )
      throw new Error('Combined episode failed audio duration verification.');
    await json(path.join(directory, 'verification.json'), {
      ...saved,
      agent,
      voice: 'af_heart',
      sourceReferencesVerified: true,
      selectedFiles: episode.files,
      referencedFiles: [...new Set(flattenSteps(lesson).map((step) => step.anchor.file))],
      allSelectedFilesReferenced: true,
      cachedSegments,
      seriesFingerprint: fingerprint,
      libraryDirectory,
    });
    await library.remember(entry.id);
    console.log(
      `Episode ${episode.number} ready in Episode library: ${(saved.durationSeconds / 60).toFixed(1)} minutes, ${saved.stepCount} segments.`,
    );
  }
}
main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
