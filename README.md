# CodeCast

Understand a codebase through narrated walkthroughs of its actual source. CodeCast is a local Electron application with a React interface, a read-only Monaco viewer, and a deterministic lesson player.

## Current milestone

Architecture/contracts, the narrated player, agent-generated walkthroughs, and local Kokoro speech generation are implemented (phases 0–2 and the speech integration from phase 3 of [the implementation plan](implementation_plan.md)):

- A bundled checkout lesson with six locally synthesized audio clips across three source files.
- Play, pause, replay, previous/next, step seeking, speed, and mute controls.
- Open a local folder, browse files, and import hand-authored CodeLesson JSON.
- Schema validation and exact SHA-256 source verification before highlighting.
- Explicit errors for changed source, invalid ranges, and missing audio.
- Local Kokoro generation with four English voices, progress, cancellation, and persistent audio caching.
- Generate a lesson with Codex, Claude Code, or OpenCode; review its outline before loading it.

Multi-lesson curricula, persistent project management/progress, Git snapshot reconstruction, and distributable installers are **not implemented yet**. The bundled fixture uses Flite narration; no speech model or account is required to try it. Choose **Narration** in the desktop app to replace it with locally generated Kokoro speech.

## Run locally

Requires Node.js **22.12+** and npm. Desktop use requires a graphical Linux, macOS, or Windows session and Electron's system dependencies.

```sh
npm ci
npm run setup:electron
npm run dev
```

The setup command downloads the platform's Electron runtime. Vite reloads renderer edits; restart the development command after changing Electron code.

For a browser preview:

```sh
npm run dev:web
```

Visit `http://127.0.0.1:5173`. Folder selection in this preview uses the browser's directory picker. Selected files are read in memory in the current tab; nothing is uploaded. Electron provides the native picker and filesystem boundary.

Build and launch the production app:

```sh
npm run build
npm start
```

## Try your own folder

1. Play the example to explore the controls.
2. Click **Open folder** and select `tests/fixtures/sample`.
3. Click **Import lesson** and select its `codecast.lesson.json`.
4. Play the walkthrough. Click **Files** to inspect source; playing restores the lesson's highlighted range.

The lesson's source and audio paths are relative to the **selected repository root**, not the JSON file's directory. See [the lesson format](docs/lesson-format.md) to author another walkthrough. Lessons without audio use labeled, timed reading mode until you explicitly generate narration.

## Generate a walkthrough

Install and sign in to at least one CLI: **Codex**, **Claude Code**, or **OpenCode**. CodeCast detects these commands on `PATH` and invokes them without an interactive terminal.

1. Open your repository folder and click **Create lesson**.
2. Choose a coding agent, explanation depth, and an optional model ID. OpenCode model IDs use `provider/model`.
3. Describe one workflow and review the selected source files. You can filter and adjust the suggestions.
4. Click **Generate walkthrough**, review its objectives and chapters, then click **Open walkthrough**.
5. Choose **Narration** to add local Kokoro speech.

Selected source contents and your learning goal are sent through the selected CLI to its configured model provider. Existing provider usage and access limits apply. The agent receives a bounded source snapshot in an isolated working directory; CodeCast does not grant repository editing access. Generated references are checked against the selected files and current source before loading. Successful lesson JSON is saved in CodeCast's application data directory, outside your repository.

See [agent setup and generation](docs/agents.md) for CLI restrictions, context limits, saved lesson locations, and live tests. Browser preview supports lesson import and playback; CLI generation requires the desktop app.

## Test a podcast about CodeCast itself

With Codex signed in, Kokoro set up, and FFmpeg installed, run:

```sh
npm run test:podcast:self
```

This invokes CodeCast's generation and speech services against a fixed selection of this repository's source. It creates a podcast script, chapter WAVs, a complete MP3, a timestamped transcript, and a replayable `episode.json` under the ignored `artifacts/codecast-podcast/<timestamp>/` directory. Provider usage applies to script generation; speech runs locally. To resume an interrupted run without requesting another script, pass its artifact directory to the same command.

In the desktop app, open the CodeCast repository folder and import that `episode.json` to play the exported audio alongside the original code. To automate the playback check:

```sh
CODECAST_HEADLESS=1 CODECAST_TEST_EPISODE=artifacts/codecast-podcast/<timestamp>/episode.json npm run test:desktop -- --grep 'CodeCast repository podcast'
```

The opt-in check verifies pause/resume, chapter seeking, source highlights, and every actual media-end transition. It writes a screenshot and playback results beside the exported episode. Generated audio and reports are kept out of Git.

## Local narration with Kokoro

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run:

```sh
npm run setup:tts
```

This creates an isolated Python 3.12 environment and downloads the pinned Kokoro model and four voices (about 330 MB of model assets, plus Python dependencies). Linux/Windows use CPU-only PyTorch wheels. The setup does not change your system Python.

Restart the desktop development app after updating the Electron code. Open a lesson, click **Narration**, choose Heart, Bella, Michael, or Emma, and click **Generate narration**. Generated clips replace that lesson's audio in the current session; source files and imported JSON remain unchanged. Generation works offline after setup, and repeated requests reuse audio cached in CodeCast's application data directory.

See [TTS setup and troubleshooting](docs/tts.md) for storage paths, cancellation, runtime overrides, and real-model tests. The browser preview does not run Python or download models.

## Development

```sh
npm run typecheck      # TypeScript, including tests
npm test               # Vitest: contracts, playback, repository access
npm run test:tts       # Python: normalization and audio cache behavior (no model required)
npm run test:e2e        # Playwright: browser player and imports
npm run test:desktop    # Build first; verify Electron and native IPC
npm run test:agents:live -- codex # Opt in: generate from the public sample with a signed-in CLI
npm run schema         # Regenerate the versioned JSON Schema
npm run format:check   # Prettier
```

For browser tests, install Chromium once with `npx playwright install chromium`, or use an existing Chrome binary: `CHROME_PATH=/usr/bin/google-chrome npm run test:e2e`. Desktop tests require the Electron runtime and a display; on Linux, `xvfb-run npm run test:desktop` can supply a virtual display.

Code uses two-space indentation in TypeScript and four spaces in Python, TypeScript strict mode, PascalCase components/types, and camelCase functions. Python functions use snake_case. Use `*.test.ts` for Vitest, `*.spec.ts` for Playwright, and `test_*.py` for Python unittest. The speech boundary tests require a Python interpreter, but no model. There is no numeric coverage gate; changes to contracts, file boundaries, or playback should include behavioral tests.

## Layout

`apps/desktop` contains the renderer and Electron main/preload processes. `packages/core`, `packages/playback`, `packages/repository`, `packages/agents`, and `packages/speech` define contracts, playback, filesystem access, CLI adapters, and speech orchestration. `services/tts` contains the Python worker and locked dependencies. `schemas` contains the generated lesson contracts, and `tests/fixtures/sample` is a portable lesson with its source and audio.

See [architecture and security boundaries](docs/architecture.md) before extending filesystem access, agent execution, or speech generation.
