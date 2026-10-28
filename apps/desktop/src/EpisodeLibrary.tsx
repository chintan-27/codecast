import { useEffect, useRef, useState } from 'react';
import { AudioLines, Headphones, LoaderCircle, Play, X } from 'lucide-react';
import type { OpenedEpisode, SavedEpisode } from '../../../packages/storage/episode-contract';

export function EpisodeLibrary({
  onClose,
  onOpen,
}: {
  onClose(): void;
  onOpen(episode: OpenedEpisode): void;
}) {
  const [episodes, setEpisodes] = useState<SavedEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    element.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ];
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    if (!window.codecast?.listEpisodes) {
      setLoading(false);
      setError('Restart the desktop app to use the saved episode library.');
    } else
      window.codecast
        .listEpisodes()
        .then((items) => {
          if (alive.current) setEpisodes(items);
        })
        .catch((cause) => {
          if (alive.current) setError(String(cause));
        })
        .finally(() => {
          if (alive.current) setLoading(false);
        });
    return () => {
      alive.current = false;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);

  async function open(id: string) {
    if (!window.codecast?.openEpisode) return;
    setOpening(id);
    setError(null);
    try {
      const episode = await window.codecast.openEpisode(id);
      if (alive.current) onOpen(episode);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Could not open this episode.');
    } finally {
      if (alive.current) setOpening(null);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!opening) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !opening) onClose();
      }}
    >
      <section
        className="help-modal episode-library"
        ref={element}
        role="dialog"
        aria-modal="true"
        aria-labelledby="episode-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close episode library"
          disabled={!!opening}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="modal-icon">
          <Headphones size={26} />
        </span>
        <div className="eyebrow">ON THIS DEVICE</div>
        <h2 id="episode-library-title">Your episodes.</h2>
        <p>
          Saved scripts, narration, and recorded source stay available when you reopen CodeCast.
        </p>
        {loading && (
          <p className="library-loading" role="status">
            <LoaderCircle className="spin" size={16} /> Reading your library…
          </p>
        )}
        {error && (
          <div className="speech-error" role="alert">
            {error}
          </div>
        )}
        {!loading && !episodes.length && !error && (
          <div className="library-empty">
            <AudioLines size={28} />
            <p>No saved episodes yet. Create or import an episode to keep it here.</p>
          </div>
        )}
        <div className="episode-list">
          {episodes.map((episode) => (
            <button
              key={episode.id}
              className="episode-entry"
              disabled={!!opening}
              onClick={() => open(episode.id)}
              aria-label={`Open episode ${episode.title}`}
            >
              <span className="episode-cover">
                {opening === episode.id ? (
                  <LoaderCircle className="spin" size={21} />
                ) : (
                  <Play size={21} />
                )}
              </span>
              <span className="episode-details">
                <strong>{episode.title}</strong>
                <small>
                  {episode.projectName} · {Math.floor(episode.durationSeconds / 60)}:
                  {String(Math.floor(episode.durationSeconds % 60)).padStart(2, '0')} ·{' '}
                  {episode.stepCount} segments
                </small>
                <span>
                  {episode.audioStepCount === episode.stepCount
                    ? 'Audio ready'
                    : episode.audioStepCount
                      ? `${episode.audioStepCount} segments narrated`
                      : 'Script ready · add narration'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
