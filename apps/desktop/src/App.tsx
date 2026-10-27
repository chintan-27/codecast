import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  FileCode2,
  FolderOpen,
  Headphones,
  Leaf,
  ListTree,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import {
  flattenSteps,
  lessonSchema,
  validateAnchor,
  validateLessonSources,
  type CodeLesson,
  type LessonStep,
} from '../../../packages/core/lesson';
import { initialPlayback, reducePlayback } from '../../../packages/playback/state';
import { CodeViewer } from './CodeViewer';
import { demoLesson, demoSources } from './demo';
import { browserRepository, type Repository } from './repository';
import { SpeechPanel } from './SpeechPanel';
import { GenerationPanel } from './GenerationPanel';
import type { GenerationResult } from '../../../packages/agents/contract';
import { speechVoices, type SpeechClip, type SpeechVoice } from '../../../packages/speech/contract';

const makeDemo = (): Repository => ({
  name: 'little-store',
  files: Object.keys(demoSources),
  kind: 'demo',
  truncated: false,
  readSource: async (path) => {
    if (!Object.hasOwn(demoSources, path)) throw new Error(`File not found: ${path}`);
    return demoSources[path];
  },
  readAudio: async (path) => `${import.meta.env.BASE_URL}demo/${path.split('/').pop()}`,
});

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
type SourceView = { file: string; source: string; range?: LessonStep['anchor'] };
type LoadedStep = { index: number; generation: number; audio: string | null };

export function App() {
  const [repository, setRepository] = useState<Repository>(makeDemo);
  const [lesson, setLesson] = useState<CodeLesson | null>(demoLesson);
  const steps = useMemo(() => (lesson ? flattenSteps(lesson) : []), [lesson]);
  const [playback, dispatch] = useReducer(
    (state: typeof initialPlayback, action: Parameters<typeof reducePlayback>[1]) =>
      reducePlayback(state, action, steps.length),
    initialPlayback,
  );
  const [view, setView] = useState<SourceView | null>(null);
  const [loaded, setLoaded] = useState<LoadedStep | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [speechWorking, setSpeechWorking] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationWorking, setGenerationWorking] = useState(false);
  const [generatedClips, setGeneratedClips] = useState<Record<string, SpeechClip>>({});
  const [speechVoice, setSpeechVoice] = useState<SpeechVoice>('af_heart');
  const [reloadStep, setReloadStep] = useState(0);
  const [tab, setTab] = useState<'lesson' | 'files'>('lesson');
  const audio = useRef<HTMLAudioElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const lessonInput = useRef<HTMLInputElement>(null);
  const viewToken = useRef(0);
  const repositoryToken = useRef(0);
  const step = steps[playback.index];
  const playing = playback.status === 'playing';
  const stepReady = loaded?.index === playback.index && loaded?.generation === reloadStep;
  const totalDuration = steps.reduce((sum, item) => sum + item.durationSeconds, 0);
  const completedDuration = steps
    .slice(0, playback.index)
    .reduce((sum, item) => sum + item.durationSeconds, 0);
  const progress =
    playback.status === 'ended'
      ? 100
      : totalDuration
        ? ((completedDuration + elapsed) / totalDuration) * 100
        : 0;

  useEffect(() => {
    let canceled = false;
    const token = ++viewToken.current;
    audio.current?.pause();
    setLoaded(null);
    setView(null);
    setElapsed(0);
    if (!step) return;
    setError(null);
    (async () => {
      const source = await repository.readSource(step.anchor.file);
      await validateAnchor(step, source);
      const generated = generatedClips[step.id];
      const url =
        generated && window.codecast
          ? await window.codecast.readSpeechAudio(generated.cacheKey)
          : step.audio
            ? await repository.readAudio(step.audio)
            : null;
      if (canceled) return;
      if (audio.current) {
        audio.current.removeAttribute('src');
        if (url) audio.current.src = url;
        audio.current.load();
      }
      if (viewToken.current === token)
        setView({ file: step.anchor.file, source, range: step.anchor });
      setLoaded({ index: playback.index, generation: reloadStep, audio: url });
    })().catch((cause) => {
      if (canceled) return;
      setError(message(cause));
      dispatch({ type: 'pause' });
    });
    return () => {
      canceled = true;
    };
  }, [repository, step, playback.index, reloadStep, generatedClips]);

  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.help-modal');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>('button, a, input, select, [tabindex="0"]') ?? [],
      );
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelp(false);
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [help]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.playbackRate = rate;
    element.muted = muted;
    if (!playing || !loaded?.audio || !stepReady) {
      element.pause();
      return;
    }
    let canceled = false;
    element.play().catch((cause) => {
      if (canceled) return;
      setError(
        `Narration could not play: ${message(cause)} Try playing again or check the audio file.`,
      );
      dispatch({ type: 'pause' });
    });
    return () => {
      canceled = true;
      element.pause();
    };
  }, [playing, loaded, rate, muted, stepReady]);

  // Lessons without audio have an explicitly labeled, timed reading mode.
  useEffect(() => {
    if (!playing || !stepReady || !loaded || loaded.audio || !step) return;
    const interval = window.setInterval(
      () => setElapsed((value) => Math.min(step.durationSeconds, value + 0.1 * rate)),
      100,
    );
    return () => window.clearInterval(interval);
  }, [playing, loaded, step, rate, stepReady]);

  useEffect(() => {
    if (playing && stepReady && loaded && !loaded.audio && step && elapsed >= step.durationSeconds)
      dispatch({ type: 'complete' });
  }, [elapsed, loaded, playing, step, stepReady]);

  async function togglePlayback() {
    if (playing) {
      dispatch({ type: 'pause' });
      return;
    }
    if (!step || !loaded || !stepReady) return;
    if (playback.status === 'ended') {
      if (playback.index === 0) setReloadStep((value) => value + 1);
      dispatch({ type: 'play' });
      return;
    }
    const token = ++viewToken.current;
    try {
      const source = await repository.readSource(step.anchor.file);
      await validateAnchor(step, source);
      if (token !== viewToken.current) return;
      setView({ file: step.anchor.file, source, range: step.anchor });
      setError(null);
      dispatch({ type: 'play' });
    } catch (cause) {
      if (token !== viewToken.current) return;
      setView(null);
      setLoaded(null);
      setError(message(cause));
    }
  }

  function seek(index: number) {
    audio.current?.pause();
    dispatch({ type: 'seek', index });
    // Restarting the current step also resets its audio and elapsed time.
    if (index === playback.index) {
      if (audio.current) audio.current.currentTime = 0;
      setElapsed(0);
      setReloadStep((value) => value + 1);
    }
  }

  function useRepository(next: Repository) {
    audio.current?.pause();
    ++viewToken.current;
    ++repositoryToken.current;
    setRepository(next);
    setGeneratedClips({});
    setSpeechOpen(false);
    setGenerationOpen(false);
    setLesson(null);
    setLoaded(null);
    setView(null);
    setError(null);
    dispatch({ type: 'reset' });
    setTab('files');
  }

  async function openRepository() {
    dispatch({ type: 'pause' });
    if (!window.codecast) {
      directoryInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      const summary = await window.codecast.openRepository();
      if (summary)
        useRepository({
          ...summary,
          kind: 'local',
          readSource: window.codecast.readSource,
          readAudio: window.codecast.readAudio,
        });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importLesson(text: string) {
    const token = repositoryToken.current;
    setBusy(true);
    dispatch({ type: 'pause' });
    try {
      if (text.length > 2 * 1024 * 1024) throw new Error('Lesson exceeds the 2 MB limit.');
      const result = lessonSchema.safeParse(JSON.parse(text));
      if (!result.success) throw new Error(`Invalid lesson: ${result.error.issues[0].message}`);
      await validateLessonSources(result.data, repository.readSource);
      if (token !== repositoryToken.current) return;
      setError(null);
      setLesson(result.data);
      setGeneratedClips({});
      setSpeechOpen(false);
      dispatch({ type: 'reset' });
      setTab('lesson');
    } catch (cause) {
      if (token === repositoryToken.current) setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openLesson() {
    if (!window.codecast) {
      lessonInput.current?.click();
      return;
    }
    setBusy(true);
    dispatch({ type: 'pause' });
    try {
      const text = await window.codecast.openLesson();
      if (text) await importLesson(text);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function browseFile(file: string) {
    dispatch({ type: 'pause' });
    const token = ++viewToken.current;
    setView(null);
    try {
      const source = await repository.readSource(file);
      if (token === viewToken.current) {
        setView({ file, source });
        setError(null);
      }
    } catch (cause) {
      if (token === viewToken.current) setError(message(cause));
    }
  }

  function resetDemo() {
    if (speechWorking || generationWorking) return;
    ++repositoryToken.current;
    setGeneratedClips({});
    setSpeechOpen(false);
    setGenerationOpen(false);
    setRepository(makeDemo());
    setLesson(demoLesson);
    dispatch({ type: 'reset' });
    setTab('lesson');
    setError(null);
    setHelp(false);
  }

  function applyNarration(clips: SpeechClip[], voice: SpeechVoice) {
    if (!lesson) return;
    const byId = Object.fromEntries(clips.map((clip) => [clip.stepId, clip]));
    setGeneratedClips(byId);
    setSpeechVoice(voice);
    setLesson({
      ...lesson,
      scenes: lesson.scenes.map((scene) => ({
        ...scene,
        steps: scene.steps.map((item) => ({
          ...item,
          durationSeconds: byId[item.id]?.durationSeconds ?? item.durationSeconds,
        })),
      })),
    });
    dispatch({ type: 'reset' });
  }

  async function loadGenerated(result: GenerationResult) {
    const token = repositoryToken.current;
    const parsed = lessonSchema.parse(result.lesson);
    await validateLessonSources(parsed, repository.readSource);
    if (token !== repositoryToken.current)
      throw new Error('The selected repository changed. Generate a new walkthrough.');
    audio.current?.pause();
    setGeneratedClips({});
    setLesson(parsed);
    setError(null);
    dispatch({ type: 'reset' });
    setTab('lesson');
    setGenerationOpen(false);
  }

  let globalIndex = 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            resetDemo();
          }}
          aria-label="CodeCast home"
        >
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <span>
            codecast<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-intro">A little context. A lot of clarity.</div>
        <button
          className="project-picker"
          onClick={openRepository}
          disabled={busy || speechWorking || generationWorking}
        >
          <span className="project-icon">
            <FolderOpen size={18} />
          </span>
          <span>
            <strong>{repository.name}</strong>
            <small>{repository.kind === 'demo' ? 'Example project' : 'Local repository'}</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-tabs" role="tablist" aria-label="Project navigation">
          <button role="tab" aria-selected={tab === 'lesson'} onClick={() => setTab('lesson')}>
            <BookOpen size={15} /> Lesson
          </button>
          <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
            <ListTree size={15} /> Files <span>{repository.files.length}</span>
          </button>
        </div>
        <div className="sidebar-scroll">
          {tab === 'lesson' ? (
            <>
              <div className="eyebrow sidebar-label">
                YOUR WALKTHROUGH <span>{steps.length ? `${steps.length} steps` : ''}</span>
              </div>
              {lesson ? (
                lesson.scenes.map((scene, sceneIndex) => (
                  <section className="chapter" key={scene.id}>
                    <h2>
                      <span>{String(sceneIndex + 1).padStart(2, '0')}</span>
                      {scene.title}
                    </h2>
                    {scene.steps.map((item) => {
                      const index = globalIndex++;
                      const active = index === playback.index;
                      return (
                        <button
                          key={item.id}
                          className={`step-link ${active ? 'active' : ''}`}
                          onClick={() => seek(index)}
                          aria-current={active ? 'step' : undefined}
                        >
                          <span className="step-marker">
                            {index < playback.index || playback.status === 'ended' ? (
                              <Check size={12} />
                            ) : active ? (
                              <AudioLines size={12} />
                            ) : (
                              <span />
                            )}
                          </span>
                          <span>
                            {item.title}
                            <small>{time(item.durationSeconds)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </section>
                ))
              ) : (
                <div className="sidebar-empty">
                  <BookOpen size={24} />
                  <p>Your next story starts here.</p>
                  <small>Import a CodeLesson JSON to explore this project.</small>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="eyebrow sidebar-label">REPOSITORY FILES</div>
              {repository.files.map((file) => (
                <button
                  key={file}
                  className={`file-link ${view?.file === file ? 'selected' : ''}`}
                  onClick={() => browseFile(file)}
                  title={file}
                >
                  <FileCode2 size={15} />
                  <span>{file}</span>
                </button>
              ))}
              {repository.truncated && (
                <p className="sidebar-note">
                  Showing the first 5,000 files. Dependencies and sensitive paths are excluded.
                </p>
              )}
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <ShieldCheck size={15} />
            <span>Local files. Read-only access.</span>
          </div>
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={16} /> Getting started <ChevronRight size={14} />
          </button>
          <span className="version">
            EARLY PREVIEW <span>v0.1</span>
          </span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{repository.name}</strong>
          </div>
          <div className="topbar-actions">
            <span className="preview-badge">
              <span />
              {repository.kind === 'demo' ? 'SAMPLE LESSON' : 'LOCAL PROJECT'}
            </span>
            <button
              className="button secondary"
              onClick={openRepository}
              disabled={busy || speechWorking || generationWorking}
            >
              <FolderOpen size={15} /> Open folder
            </button>
            <button
              className="button primary"
              onClick={openLesson}
              disabled={busy || speechWorking || generationWorking || repository.kind === 'demo'}
              title={
                repository.kind === 'demo' ? 'Open your own folder to import a lesson' : undefined
              }
            >
              <ArrowDownToLine size={15} /> Import lesson
            </button>
            <button
              className="button secondary"
              disabled={!lesson || busy || speechWorking || generationWorking}
              onClick={() => {
                dispatch({ type: 'pause' });
                setSpeechOpen(true);
              }}
            >
              <AudioLines size={15} /> Narration
            </button>
            <button
              className="button primary"
              disabled={busy || speechWorking || generationWorking || repository.kind === 'demo'}
              onClick={() => {
                dispatch({ type: 'pause' });
                setGenerationOpen(true);
              }}
              title={
                repository.kind === 'demo'
                  ? 'Open your own folder to generate a walkthrough'
                  : undefined
              }
            >
              <Sparkles size={15} /> Create lesson
            </button>
          </div>
        </header>

        <div className="workspace-body">
          <section className="lesson-heading">
            <div className="eyebrow">
              <span className="tiny-line" /> CODE, WITH CONTEXT
            </div>
            <h1>{lesson?.title ?? 'Meet your codebase.'}</h1>
            <p>
              {lesson?.description ??
                'Browse your source, then create a walkthrough with your coding agent or import a lesson.'}
            </p>
            <div className="lesson-meta">
              <span>
                <Headphones size={14} />{' '}
                {lesson
                  ? `${Math.ceil(totalDuration / 60)} min walkthrough`
                  : 'Your project, on your machine'}
              </span>
              <span className="meta-dot">·</span>
              <span>
                <FileCode2 size={14} />{' '}
                {lesson
                  ? `${new Set(steps.map((item) => item.anchor.file)).size} source files`
                  : `${repository.files.length} files`}
              </span>
              <span className="meta-dot">·</span>
              <span>{lesson ? `${lesson.scenes.length} chapters` : 'Read-only'}</span>
            </div>
          </section>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="busy-message" role="status">
              <LoaderCircle className="spin" size={16} /> Reading and validating local files…
            </div>
          )}

          <div className="lesson-stage">
            <section className="editor-card" aria-label="Source viewer">
              <div className="editor-toolbar">
                <div className="editor-file">
                  <span className="ts-icon">
                    {view?.file.endsWith('.ts') ? 'TS' : <Code2 size={13} />}
                  </span>
                  <span data-testid="active-file">{view?.file ?? 'Source explorer'}</span>
                </div>
                <span className="read-only">
                  <span /> READ ONLY
                </span>
              </div>
              <div className="editor-location">
                <span>{repository.name}</span>
                <ChevronRight size={12} />
                <span>{view?.file ?? 'Select a file'}</span>
                {view?.range && (
                  <span className="line-range" data-testid="active-range">
                    Lines {view.range.startLine}–{view.range.endLine}
                  </span>
                )}
              </div>
              {view ? (
                <CodeViewer source={view.source} file={view.file} range={view.range} />
              ) : (
                <div className="editor-empty">
                  <Code2 size={34} />
                  <h3>{step ? 'Preparing your view…' : 'Every codebase has a story.'}</h3>
                  <p>
                    {step
                      ? 'Checking the source before highlighting.'
                      : 'Choose a file from the sidebar to start exploring.'}
                  </p>
                  {!step && (
                    <button className="button secondary" onClick={() => setTab('files')}>
                      <ListTree size={15} /> Browse files
                    </button>
                  )}
                </div>
              )}
              <div className="editor-footer">
                <span>
                  <ShieldCheck size={12} />{' '}
                  {view?.range ? 'Source verified · SHA-256' : 'Original source · read-only'}
                </span>
                <span>{view ? `${view.source.split('\n').length} lines` : 'No file selected'}</span>
              </div>
            </section>

            <aside className="narration-card" aria-label="Lesson narration">
              <div className="narration-label">
                <span className={`voice-icon ${playing ? 'is-playing' : ''}`}>
                  <AudioLines size={19} />
                </span>
                <div>
                  <strong>Your code, explained</strong>
                  <small>
                    {loaded?.audio
                      ? step && generatedClips[step.id]
                        ? `${speechVoices.find((item) => item.id === speechVoice)?.name} · Kokoro`
                        : 'Local audio narration'
                      : lesson
                        ? 'Reading mode · no audio'
                        : 'A guided walkthrough'}
                  </small>
                </div>
                <span className="live-dot" />
              </div>
              {step ? (
                <>
                  <div className="step-kicker">
                    STEP {String(playback.index + 1).padStart(2, '0')}{' '}
                    <span>/ {String(steps.length).padStart(2, '0')}</span>
                  </div>
                  <h2>{step.title}</h2>
                  <div className="narration-text" data-testid="narration">
                    {step.narration}
                  </div>
                  <button className="source-reference" onClick={() => seek(playback.index)}>
                    <FileCode2 size={14} />
                    <span>
                      {step.anchor.file}
                      <small>
                        Lines {step.anchor.startLine}–{step.anchor.endLine}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                  {playback.status === 'ended' && (
                    <div className="recap" role="status">
                      <Check size={16} />
                      <div>
                        <strong>That’s the whole journey.</strong>
                        <p>{lesson?.recap}</p>
                      </div>
                    </div>
                  )}
                  <div className="up-next">
                    <span className="eyebrow">
                      {steps[playback.index + 1] ? 'COMING UP NEXT' : 'THE TAKEAWAY'}
                    </span>
                    <p>
                      {steps[playback.index + 1]?.title ?? 'You can now follow the complete flow.'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="empty-lesson">
                  <BookOpen size={30} />
                  <h2>Turn source into a story.</h2>
                  <p>
                    Open a folder and import a CodeLesson JSON. Each step connects an explanation to
                    verified lines in your source.
                  </p>
                  <button className="button secondary" onClick={resetDemo}>
                    <Play size={14} /> Explore the example
                  </button>
                  <small>
                    Create a lesson with your coding agent, then generate local narration with
                    Kokoro.
                  </small>
                </div>
              )}
            </aside>
          </div>

          <div className="below-stage">
            <span>
              <Leaf size={14} /> Made for understanding, one step at a time.
            </span>
            {lesson && (
              <button onClick={() => setHelp(true)}>
                How this walkthrough works <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>

        <footer className="player" aria-label="Playback controls">
          <div
            className="progress-track"
            style={{ '--progress': `${Math.min(100, progress)}%` } as React.CSSProperties}
          >
            <input
              type="range"
              min={0}
              max={Math.max(steps.length - 1, 1)}
              value={playback.index}
              disabled={!step}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="Seek lesson step"
            />
          </div>
          <div className="player-inner">
            <div className="player-now">
              <span className="mini-cover">
                <AudioLines size={21} />
              </span>
              <div>
                <strong>{lesson?.title ?? 'No lesson loaded'}</strong>
                <small>{step?.scene ?? 'Import a lesson to begin'}</small>
              </div>
            </div>
            <div className="transport">
              <button
                aria-label="Previous step"
                disabled={!step || playback.index === 0}
                onClick={() => seek(playback.index - 1)}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="play-button"
                aria-label={
                  playing
                    ? 'Pause lesson'
                    : playback.status === 'ended'
                      ? 'Replay lesson'
                      : 'Play lesson'
                }
                onClick={togglePlayback}
                disabled={!stepReady || busy || speechWorking || generationWorking}
              >
                {playing ? (
                  <Pause size={19} fill="currentColor" />
                ) : playback.status === 'ended' ? (
                  <RotateCcw size={19} />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
              <button
                aria-label="Next step"
                disabled={!step || playback.index === steps.length - 1}
                onClick={() => seek(playback.index + 1)}
              >
                <SkipForward size={18} />
              </button>
              <span className="player-time">
                {time(completedDuration + elapsed)}
                <span> / {time(totalDuration)}</span>
              </span>
            </div>
            <div className="player-options">
              <select
                aria-label="Playback speed"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                  <option value={value} key={value}>
                    {value}×
                  </option>
                ))}
              </select>
              <span className="control-divider" />
              <button
                aria-label={muted ? 'Unmute narration' : 'Mute narration'}
                aria-pressed={muted}
                onClick={() => setMuted(!muted)}
              >
                <Volume2 size={18} opacity={muted ? 0.35 : 1} />
              </button>
              <span className="sound-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        </footer>
      </main>

      <audio
        ref={audio}
        onTimeUpdate={() => {
          if (audio.current) setElapsed(audio.current.currentTime);
        }}
        onEnded={() => dispatch({ type: 'complete' })}
        onError={() => {
          if (audio.current?.getAttribute('src')) {
            setError(
              'Narration audio is missing or cannot be decoded. Check the lesson audio path.',
            );
            dispatch({ type: 'pause' });
          }
        }}
      />
      <input
        ref={directoryInput}
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        hidden
        aria-label="Choose repository folder"
        onChange={(event) => {
          if (event.target.files?.length) useRepository(browserRepository(event.target.files));
          event.target.value = '';
        }}
      />
      <input
        ref={lessonInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Choose lesson JSON"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            if (file.size > 2 * 1024 * 1024) setError('Lesson exceeds the 2 MB limit.');
            else await importLesson(await file.text());
          }
        }}
      />

      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="modal-close" aria-label="Close help" onClick={() => setHelp(false)}>
              <X size={18} />
            </button>
            <span className="modal-icon">
              <Headphones size={27} />
            </span>
            <div className="eyebrow">WELCOME TO CODECAST</div>
            <h2 id="help-title">Get the bigger picture.</h2>
            <p>
              Listen to an explanation while the actual code follows along. Pause to explore, or
              select any step to jump back in.
            </p>
            <ol>
              <li>
                <strong>Try the example.</strong> Six narrated steps trace a checkout across three
                files.
              </li>
              <li>
                <strong>Open your folder.</strong> Browse local source with read-only access. In the
                browser preview, selected files stay in this tab.
              </li>
              <li>
                <strong>Import a lesson.</strong> Choose a version 1.0 CodeLesson JSON. Source and
                audio paths resolve from the repository root. Try <code>tests/fixtures/sample</code>{' '}
                with its included lesson.
              </li>
            </ol>
            <p className="help-note">
              Import a hand-authored lesson, then choose Narration to generate local Kokoro speech.
              Choose Create lesson to generate a walkthrough with Codex, Claude Code, or OpenCode.
            </p>
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
      {speechOpen && lesson && (
        <SpeechPanel
          lesson={lesson}
          readSource={repository.readSource}
          initialVoice={speechVoice}
          onGenerated={applyNarration}
          onClose={() => setSpeechOpen(false)}
          onWorking={setSpeechWorking}
        />
      )}
      {generationOpen && (
        <GenerationPanel
          onClose={() => setGenerationOpen(false)}
          onWorking={setGenerationWorking}
          onLoad={loadGenerated}
        />
      )}
    </div>
  );
}
