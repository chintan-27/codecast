import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { LessonGenerationService } from '../packages/agents/service';
import { collectContext } from '../packages/agents/context';
import { agentIdSchema } from '../packages/agents/contract';
import { RepositoryAccess } from '../packages/repository/access';
import { SpeechService } from '../packages/speech/service';
import { voiceSchema } from '../packages/speech/contract';
import { flattenSteps, lessonSchema, validateLessonSources } from '../packages/core/lesson';

const run = promisify(execFile);
const files = [
  'apps/desktop/electron/main/index.ts',
  'apps/desktop/electron/preload/index.ts',
  'apps/desktop/src/App.tsx',
  'apps/desktop/src/GenerationPanel.tsx',
  'apps/desktop/src/SpeechPanel.tsx',
  'packages/repository/access.ts',
  'packages/agents/service.ts',
  'packages/agents/context.ts',
  'packages/agents/adapters.ts',
  'packages/core/lesson.ts',
  'packages/speech/service.ts',
  'services/tts/sidecar.py',
  'packages/playback/state.ts',
];
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

async function main() {
  const root = process.cwd();
  const output = path.resolve(
    process.argv[2] ??
      path.join('artifacts/codecast-podcast', new Date().toISOString().replace(/[:.]/g, '-')),
  );
  const relativeOutput = path.relative(root, output);
  if (
    !relativeOutput.startsWith(`artifacts${path.sep}`) ||
    relativeOutput.includes(`..${path.sep}`)
  )
    throw new Error('Episode output must be inside this repository’s artifacts directory.');
  const appData =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  const agent = agentIdSchema.parse(process.env.CODECAST_SELF_TEST_AGENT ?? 'codex');
  const voice = voiceSchema.parse(process.env.CODECAST_SELF_TEST_VOICE ?? 'af_heart');
  const agents = new LessonGenerationService({ dataDirectory: path.join(output, 'generation') });
  const speech = new SpeechService({
    projectRoot: root,
    dataDirectory: process.env.CODECAST_TTS_DATA_DIR ?? path.join(appData, 'codecast/speech'),
    python: process.env.CODECAST_TTS_PYTHON,
  });
  const cancellation = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      agents.cancel();
      speech.cancel();
      cancellation.abort();
    });
  const status = await speech.status();
  if (!status.ready)
    throw new Error(`${status.message} Run npm run setup:tts before this live test.`);
  const repo = await RepositoryAccess.open(root);
  await mkdir(path.join(output, 'audio'), { recursive: true });
  console.log(`Episode directory: ${relativeOutput}`);

  let episode;
  if (process.argv[2]) {
    episode = lessonSchema.parse(
      JSON.parse(await readFile(path.join(output, 'episode.source.json'), 'utf8')),
    );
    await validateLessonSources(episode, repo.readSource.bind(repo));
    console.log('Resuming the existing script; no new provider request.');
  } else {
    const detected = await agents.detect();
    if (!detected.find((item) => item.id === agent)?.available)
      throw new Error(`The ${agent} CLI is unavailable.`);
    const result = await agents.generate(
      repo,
      {
        agent,
        model: process.env.CODECAST_SELF_TEST_MODEL ?? '',
        depth: 'overview',
        files,
        objective:
          'Create a short, roughly three-minute single-host podcast about CodeCast itself. Tell the story of how opening a local repository turns into an AI-written script, verified code references, local Kokoro narration, and synchronized playback. Use six segments of about 60–80 words each with a hook, smooth transitions, and a closing takeaway. Explain the read-only boundary, the common Codex/Claude Code/OpenCode adapters, how source hashes prevent stale highlighting, and how audio completion advances the player. Be conversational and grounded in the supplied code. Do not frame this as a course, curriculum, lesson plan, or quiz. Do not claim that saved listening progress or a project library exists.',
      },
      (event) => console.log(event.message),
    );
    episode = result.lesson;
    await writeFile(
      path.join(output, 'episode.source.json'),
      JSON.stringify(episode, null, 2) + '\n',
    );
    await writeFile(
      path.join(output, 'script.md'),
      `# ${episode.title}\n\n${flattenSteps(episode)
        .map((step) => `## ${step.title}\n\n${step.narration}`)
        .join('\n\n')}\n`,
    );
  }
  const steps = flattenSteps(episode);
  console.log(`Script validated: ${steps.length} segments. Generating local ${voice} narration…`);
  const clips = await speech.generate(
    {
      voice,
      steps: steps.map((step) => ({ id: step.id, text: step.speechText ?? step.narration })),
    },
    (event) => console.log(event.message),
  );
  const byId = new Map(clips.map((clip) => [clip.stepId, clip]));
  let position = 0;
  const chapters = [];
  const transcript = [`# ${episode.title}`, episode.description, 'Voice: Kokoro ' + voice];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const clip = byId.get(step.id)!;
    const filename = `segment-${String(index + 1).padStart(2, '0')}.wav`;
    const uri = await speech.readAudio(clip.cacheKey);
    const audio = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    await writeFile(path.join(output, 'audio', filename), audio);
    chapters.push({
      stepId: step.id,
      title: step.title,
      startSeconds: position,
      durationSeconds: clip.durationSeconds,
      file: step.anchor.file,
      startLine: step.anchor.startLine,
      endLine: step.anchor.endLine,
      audioHash: createHash('sha256').update(audio).digest('hex'),
    });
    transcript.push(
      `## ${stamp(position)} — ${step.title}`,
      step.narration,
      `Source: ${step.anchor.file}:${step.anchor.startLine}–${step.anchor.endLine}`,
    );
    position += clip.durationSeconds;
    for (const scene of episode.scenes) {
      const original = scene.steps.find((item) => item.id === step.id);
      if (original) {
        original.durationSeconds = clip.durationSeconds;
        original.audio = `${relativeOutput.split(path.sep).join('/')}/audio/${filename}`;
      }
    }
  }
  await validateLessonSources(episode, repo.readSource.bind(repo));
  const finalContext = await collectContext(repo, files, cancellation.signal);
  if (finalContext.revision !== episode.repositoryRevision)
    throw new Error(
      'Selected source changed while narrating the episode. Regenerate against the current source.',
    );
  await writeFile(path.join(output, 'episode.json'), JSON.stringify(episode, null, 2) + '\n');
  await writeFile(path.join(output, 'transcript.md'), transcript.join('\n\n') + '\n');
  await writeFile(path.join(output, 'chapters.json'), JSON.stringify(chapters, null, 2) + '\n');
  await writeFile(
    path.join(output, 'concat.txt'),
    steps
      .map((_step, index) => `file 'audio/segment-${String(index + 1).padStart(2, '0')}.wav'`)
      .join('\n') + '\n',
  );
  console.log('Encoding the complete podcast…');
  await run(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-i',
      'concat.txt',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '3',
      '-metadata',
      `title=${episode.title}`,
      'episode.mp3',
    ],
    { cwd: output, signal: cancellation.signal },
  );
  const { stdout } = await run('ffprobe', [
    '-v',
    'quiet',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    path.join(output, 'episode.mp3'),
  ]);
  const media = JSON.parse(stdout);
  const duration = Number(media.format.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - position) > 0.25 ||
    media.streams[0]?.codec_type !== 'audio'
  )
    throw new Error('Combined podcast audio failed duration validation.');
  await writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        title: episode.title,
        agent,
        voice,
        repository: root,
        snapshot: episode.repositoryRevision,
        selectedFiles: files,
        sourceReferencesVerified: true,
        segments: steps.length,
        durationSeconds: duration,
        cachedSegments: clips.filter((clip) => clip.cached).length,
        audioBytes: Number(media.format.size),
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      episode: path.join(relativeOutput, 'episode.json'),
      audio: path.join(relativeOutput, 'episode.mp3'),
      transcript: path.join(relativeOutput, 'transcript.md'),
      segments: steps.length,
      duration: stamp(duration),
    }),
  );
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : 'Podcast self-test failed.');
  process.exitCode = 1;
});
