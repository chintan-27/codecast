import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Download, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  flattenSteps,
  validateLessonSources,
  type CodeLesson,
} from '../../../packages/core/lesson';
import {
  speechVoices,
  type SpeechClip,
  type SpeechProgress,
  type SpeechStatus,
  type SpeechVoice,
} from '../../../packages/speech/contract';

export function SpeechPanel({
  lesson,
  readSource,
  initialVoice,
  onGenerated,
  onClose,
  onWorking,
}: {
  lesson: CodeLesson;
  readSource(path: string): Promise<string>;
  initialVoice: SpeechVoice;
  onGenerated(clips: SpeechClip[], voice: SpeechVoice): void | Promise<void>;
  onClose(): void;
  onWorking(working: boolean): void;
}) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [voice, setVoice] = useState<SpeechVoice>(initialVoice);
  const [progress, setProgress] = useState<SpeechProgress | null>(null);
  const [working, setWorking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpeechClip[] | null>(null);
  const mounted = useRef(true);
  const activeJob = useRef(false);
  const cancelRequested = useRef(false);
  const dialog = useRef<HTMLElement>(null);

  async function refresh() {
    if (!window.codecast) return;
    setChecking(true);
    try {
      const next = await window.codecast.speechStatus();
      if (mounted.current) setStatus(next);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not check the speech engine.');
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = window.codecast?.onSpeechProgress((event) => setProgress(event));
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), a[href]',
        ) ?? []),
      ];
      if (event.key === 'Tab' && controls.length) {
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      mounted.current = false;
      if (activeJob.current) {
        void window.codecast?.cancelSpeech().catch(() => {});
        onWorking(false);
      }
      unsubscribe?.();
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);

  async function run(operation: 'prepare' | 'generate') {
    if (!window.codecast) return;
    activeJob.current = true;
    cancelRequested.current = false;
    setWorking(true);
    onWorking(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      if (operation === 'prepare') {
        const next = await window.codecast.prepareSpeech();
        if (mounted.current) setStatus(next);
      } else {
        await validateLessonSources(lesson, readSource);
        if (!mounted.current || cancelRequested.current) throw new Error('Narration canceled.');
        const clips = await window.codecast.generateSpeech({
          voice,
          steps: flattenSteps(lesson).map((step) => ({
            id: step.id,
            text: step.speechText ?? step.narration,
          })),
        });
        if (cancelRequested.current)
          throw new Error('Narration canceled. Completed clips remain cached.');
        if (mounted.current) {
          await onGenerated(clips, voice);
          setResult(clips);
        }
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Narration generation failed.');
    } finally {
      activeJob.current = false;
      if (mounted.current) {
        setWorking(false);
        setProgress(null);
        onWorking(false);
      }
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!working) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !working) onClose();
      }}
    >
      <section
        className="help-modal speech-panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="speech-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close narration settings"
          disabled={working}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="modal-icon">
          <AudioLines size={26} />
        </span>
        <div className="eyebrow">LOCAL NARRATION</div>
        <h2 id="speech-title">Give the code a voice.</h2>
        <p>
          Generate a Kokoro narration for every step in <strong>{lesson.title}</strong> Choose a
          voice, then let the story follow the source.
        </p>
        {!window.codecast ? (
          <div className="speech-notice">
            <ShieldCheck size={18} />
            <p>
              Open the CodeCast desktop app to generate local speech. The browser preview can play
              imported audio.
            </p>
          </div>
        ) : (
          <>
            <div className={`speech-status ${status?.ready ? 'ready' : ''}`} role="status">
              {checking ? (
                <LoaderCircle className="spin" size={16} />
              ) : status?.ready ? (
                <Check size={16} />
              ) : (
                <Download size={16} />
              )}
              <span>
                {checking
                  ? 'Checking the local speech engine…'
                  : (status?.message ?? 'Checking Kokoro…')}
              </span>
            </div>
            {status && !status.available && (
              <div className="speech-setup">
                <p>Run this once from the CodeCast repository:</p>
                <code>npm run setup:tts</code>
                <p>
                  This installs the isolated speech runtime and downloads the model. Then check
                  again below.
                </p>
                <button className="button secondary" onClick={refresh} disabled={checking}>
                  <RefreshCw size={14} /> Check again
                </button>
              </div>
            )}
            <label className="voice-label" htmlFor="narration-voice">
              Narration voice
            </label>
            <select
              id="narration-voice"
              className="voice-select"
              value={voice}
              onChange={(event) => {
                setVoice(event.target.value as SpeechVoice);
                setResult(null);
              }}
              disabled={working}
            >
              {speechVoices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.accent}
                </option>
              ))}
            </select>
            <p className="speech-privacy">
              <ShieldCheck size={13} /> Speech is generated on this device. Text stays local.
            </p>
            {working && (
              <div className="speech-progress" role="status">
                <span>
                  <LoaderCircle className="spin" size={16} />
                  {progress?.message ?? 'Starting the local speech engine…'}
                </span>
                <progress max={progress?.total ?? 1} value={progress?.completed ?? 0} />
                <small>CPU generation may take a few minutes. Finished clips are cached.</small>
              </div>
            )}
            {error && (
              <div className="speech-error" role="alert">
                {error}
              </div>
            )}
            {result && (
              <div className="speech-success" role="status">
                <Check size={17} />
                <span>
                  Narration is ready for {result.length} steps.{' '}
                  {result.filter((clip) => clip.cached).length} reused from cache.
                </span>
              </div>
            )}
            <div className="speech-actions">
              {working ? (
                <button
                  className="button secondary"
                  onClick={() => {
                    cancelRequested.current = true;
                    void window.codecast?.cancelSpeech().catch((cause) => setError(String(cause)));
                  }}
                >
                  Cancel generation
                </button>
              ) : result ? (
                <button className="button primary" onClick={onClose}>
                  Back to the lesson
                </button>
              ) : status?.available && !status.ready ? (
                <button className="button primary" onClick={() => run('prepare')}>
                  <Download size={15} /> Download model · ~330 MB
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={!status?.ready || checking}
                  onClick={() => run('generate')}
                >
                  <AudioLines size={16} /> Generate narration
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
