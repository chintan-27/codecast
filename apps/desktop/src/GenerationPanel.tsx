import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileCode2, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { flattenSteps } from '../../../packages/core/lesson';
import {
  agentDefinitions,
  suggestSources,
  type AgentId,
  type AgentStatus,
  type GenerationProgress,
  type GenerationResult,
} from '../../../packages/agents/contract';

export function GenerationPanel({
  onClose,
  onWorking,
  onLoad,
}: {
  onClose(): void;
  onWorking(working: boolean): void;
  onLoad(result: GenerationResult): Promise<void>;
}) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [agent, setAgent] = useState<AgentId>('codex');
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [depth, setDepth] = useState<'overview' | 'deep'>('deep');
  const [model, setModel] = useState('');
  const [search, setSearch] = useState('');
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const mounted = useRef(true);
  const activeJob = useRef(false);
  const canceled = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const currentAgent = agents.find((item) => item.id === agent);
  const visible = files.filter((file) => file.toLowerCase().includes(search.toLowerCase()));

  async function refresh() {
    if (!window.codecast) return;
    setChecking(true);
    setError(null);
    try {
      const [detected, sources] = await Promise.all([
        window.codecast.listAgents(),
        window.codecast.generationFiles(),
      ]);
      if (!mounted.current) return;
      setAgents(detected);
      setFiles(sources);
      setSelected((previous) =>
        previous.length
          ? previous.filter((file) => sources.includes(file))
          : suggestSources(sources),
      );
      if (!detected.find((item) => item.id === agent)?.available) {
        const available = detected.find((item) => item.available);
        if (available) setAgent(available.id);
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not detect installed agents.');
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = window.codecast?.onGenerationProgress(setProgress);
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        ) ?? []),
      ];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      mounted.current = false;
      unsubscribe?.();
      if (activeJob.current) {
        void window.codecast?.cancelLessonGeneration().catch(() => {});
        onWorking(false);
      }
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);

  async function generate() {
    if (!window.codecast) return;
    activeJob.current = true;
    canceled.current = false;
    setWorking(true);
    onWorking(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const generated = await window.codecast.generateLesson({
        agent,
        objective,
        files: selected,
        depth,
        model: model.trim(),
      });
      if (mounted.current && !canceled.current) setResult(generated);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Lesson generation failed.');
    } finally {
      activeJob.current = false;
      if (mounted.current) {
        setWorking(false);
        onWorking(false);
        setProgress(null);
      }
    }
  }

  async function load() {
    if (!result) return;
    setError(null);
    try {
      await onLoad(result);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not load the lesson.');
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
        className="help-modal generation-panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close lesson generation"
          onClick={onClose}
          disabled={working}
        >
          <X size={18} />
        </button>
        <span className="modal-icon">
          <Sparkles size={26} />
        </span>
        <div className="eyebrow">FROM SOURCE TO STORY</div>
        <h2 id="generation-title">What would you like to understand?</h2>
        {!window.codecast ? (
          <p>
            Open the CodeCast desktop app to generate a walkthrough with Codex, Claude Code, or
            OpenCode. The browser preview supports importing lessons.
          </p>
        ) : (
          <>
            {result ? (
              <div className="generation-result">
                <div className="speech-success">
                  <Check size={17} />
                  <span>Lesson validated against {result.context.files} source files.</span>
                </div>
                <h3>{result.lesson.title}</h3>
                <p>{result.lesson.description}</p>
                <ul>
                  {result.lesson.learningObjectives.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="generated-outline">
                  {result.lesson.scenes.map((scene) => (
                    <div key={scene.id}>
                      <BookChapter title={scene.title} count={scene.steps.length} />
                    </div>
                  ))}
                </div>
                <p>
                  {flattenSteps(result.lesson).length} steps ·{' '}
                  {Math.ceil(result.context.bytes / 1024)} KB of selected source. Open the
                  walkthrough, then choose Narration to generate local speech.
                </p>
              </div>
            ) : (
              <>
                <div className="generation-options">
                  <label className="voice-label">
                    Coding agent
                    <select
                      className="voice-select"
                      value={agent}
                      onChange={(event) => setAgent(event.target.value as AgentId)}
                      disabled={working || checking}
                    >
                      {agentDefinitions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {agents.find((entry) => entry.id === item.id)?.available
                            ? ' · installed'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="voice-label">
                    Explanation depth
                    <select
                      className="voice-select"
                      value={depth}
                      onChange={(event) => setDepth(event.target.value as typeof depth)}
                      disabled={working}
                    >
                      <option value="overview">Overview · 4–7 steps</option>
                      <option value="deep">Deep understanding · 8–16 steps</option>
                    </select>
                  </label>
                </div>
                <div className="agent-status">
                  <span>
                    {checking
                      ? 'Checking installed CLIs…'
                      : currentAgent?.available
                        ? `CLI ${currentAgent.version} detected. Sign in through the CLI before generating.`
                        : (currentAgent?.message ?? 'Checking installed CLIs…')}
                  </span>
                  <button
                    className="button secondary"
                    disabled={working || checking}
                    onClick={refresh}
                    aria-label="Refresh agents"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <label className="voice-label" htmlFor="lesson-objective">
                  Learning goal
                </label>
                <textarea
                  id="lesson-objective"
                  className="goal-input"
                  rows={3}
                  maxLength={2000}
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  disabled={working}
                  placeholder="Trace checkout from the user action through validation and storage."
                />
                <label className="voice-label" htmlFor="generation-model">
                  Model{' '}
                  <span className="optional-label">optional · uses the CLI default when empty</span>
                </label>
                <input
                  id="generation-model"
                  className="voice-select"
                  value={model}
                  maxLength={200}
                  disabled={working}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={agent === 'opencode' ? 'provider/model' : 'Model ID or alias'}
                />
                <div className="source-picker-heading">
                  <span className="voice-label">Source context · {selected.length}/24 files</span>
                  <button disabled={working} onClick={() => setSelected(suggestSources(files))}>
                    Suggest files
                  </button>
                </div>
                <input
                  className="source-search"
                  aria-label="Filter source files"
                  placeholder="Filter files…"
                  value={search}
                  disabled={working}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="generation-files">
                  {visible.slice(0, 150).map((file) => (
                    <label key={file}>
                      <input
                        type="checkbox"
                        checked={selected.includes(file)}
                        disabled={working || (!selected.includes(file) && selected.length >= 24)}
                        onChange={(event) =>
                          setSelected((value) =>
                            event.target.checked
                              ? [...value, file]
                              : value.filter((entry) => entry !== file),
                          )
                        }
                      />
                      <FileCode2 size={13} />
                      <span>{file}</span>
                    </label>
                  ))}
                  {!visible.length && <p>No matching source files.</p>}
                </div>
                {visible.length > 150 && (
                  <p className="generation-limit">
                    Showing 150 of {visible.length} files. Filter to find others.
                  </p>
                )}
                <p className="generation-limit">
                  Up to 64 KB per file and 200 KB total. Choose the files involved in one workflow.
                </p>
                <p className="provider-disclosure">
                  Selected source contents and your goal are sent through the selected CLI to its
                  configured model provider. Existing provider usage applies. CodeCast does not host
                  your source.
                </p>
              </>
            )}
            {working && (
              <div className="speech-progress" role="status">
                <span>
                  <LoaderCircle className="spin" size={16} />
                  {progress?.message ?? 'Preparing the lesson…'}
                </span>
                <small>You can cancel at any time. Your current lesson stays available.</small>
              </div>
            )}
            {error && (
              <div className="speech-error" role="alert">
                {error}
              </div>
            )}
            <div className="speech-actions">
              {working ? (
                <button
                  className="button secondary"
                  onClick={() => {
                    canceled.current = true;
                    void window.codecast
                      ?.cancelLessonGeneration()
                      .catch((cause) => setError(String(cause)));
                  }}
                >
                  Cancel lesson generation
                </button>
              ) : result ? (
                <button className="button primary" onClick={load}>
                  Open walkthrough <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={
                    checking ||
                    !currentAgent?.available ||
                    objective.trim().length < 10 ||
                    selected.length < 1
                  }
                  onClick={generate}
                >
                  <Sparkles size={15} /> Generate walkthrough
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function BookChapter({ title, count }: { title: string; count: number }) {
  return (
    <>
      <strong>{title}</strong>
      <span>{count} steps</span>
    </>
  );
}
