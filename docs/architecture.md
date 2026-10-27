# Architecture and security boundaries

## Data flow

```text
Selected source + coding-agent CLI → draft lesson
  → host-assigned IDs, hashes, and source snapshot fingerprint
  → canonical CodeLesson JSON (or a hand-authored import)
  → Zod structure validation
  → SHA-256 and line-range validation against selected source
  → deterministic playback state
  → read-only Monaco view + imported or generated local audio
```

`packages/core/lesson.ts` is the canonical lesson contract. `packages/agents` defines the bounded generation request, model-facing draft contract, context collector, and Codex/Claude Code/OpenCode adapters. Regenerate both JSON Schemas with `npm run schema` after changing contracts. `packages/speech` orchestrates local Kokoro through `services/tts/sidecar.py`.

`packages/playback/state.ts` owns transport transitions. The renderer resolves each step before playing, applies its source range, and advances only after audio ends (or its explicitly labeled reading timer ends). Manual navigation pauses. Obsolete asynchronous reads are discarded.

## Privilege boundary

Electron's renderer has no Node integration, uses context isolation and sandboxing, and receives named preload methods for repository reading, agent detection/generation, lesson selection, and speech operations. IPC handlers verify the calling window and its main frame. New windows, renderer navigation, and permission requests are denied.

Only a user-selected folder can become the active repository. `RepositoryAccess` resolves real paths, rejects traversal and out-of-root symlinks, filters common credential paths, and limits read sizes. Enumeration skips symlinks, dependencies, build directories, and ignored files. Direct reads of explicitly referenced files can include gitignored source, but credential exclusions still apply. This is a bounded local reader, not a snapshot or a guarantee against concurrent filesystem mutation.

The packaged renderer is served through the secure `codecast://app` protocol so editor workers and local audio work without exposing arbitrary `file://` access. Asset paths are constrained to the build directory. Production CSP permits local scripts/workers and local/data audio. Only the loopback development page permits inline scripts for React's development preamble.

Browser preview uses user-selected `File` objects in memory. It filters common sensitive/dependency paths, but does not implement Git ignore semantics or the desktop's real-path boundary. It has no filesystem writes or backend upload endpoint.

## Storage and future integrations

Playback state stays in memory. Imported lessons/audio are read from the selected folder; generated lesson JSON, Kokoro assets, and generated clips are stored under Electron's application data directory. There is no application database or analyzed-source modification. Reloading resets progress.

The renderer sends only bounded text and allowlisted voice IDs to the speech worker. It cannot choose executables, output paths, checkpoint repositories, or shell commands. One speech job runs at a time, uses JSON-lines over stdin/stdout, and is terminated on cancellation/window close/app quit. Model downloads are explicit; generation uses local assets and offline flags. Audio-cache reads accept only SHA-256 keys and reject path/symlink escapes. See [the speech guide](tts.md) for cache identity and setup.

Agent generation reads a user-selected source subset through `RepositoryAccess`, then invokes a fixed CLI in a temporary workspace with bounded source text on stdin. The renderer cannot select arbitrary binaries, shell arguments, working directories, or output paths. Codex uses a read-only sandbox; Claude/OpenCode have tools disabled or denied. Each returned range must belong to the supplied context and match current source. Failed validation does not replace the current lesson. The provider disclosure appears before generation. See [agent setup](agents.md) for the per-CLI controls and limits.

Future project metadata should also live under application data. Multi-lesson curriculum generation and persistent project/progress management remain separate milestones.
