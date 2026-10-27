# Repository Guidelines

## Project Structure & Module Organization

CodeCast is currently in the planning stage. `implementation_plan.md` is the product and engineering reference; application source, tests, assets, and package manifests have not been added yet.

Follow its proposed layout as implementation begins:

- `apps/desktop/`: Electron main/preload processes and React UI.
- `packages/`: Shared contracts, agent adapters, repository access, curriculum, lessons, playback, and storage.
- `services/tts/`: Python sidecar for local speech generation.
- `schemas/`: Versioned lesson schemas.
- `tests/{fixtures,unit,integration,e2e}/`: Example repositories and automated checks.
- `docs/`: Supporting design and contributor documentation.

Create directories only when needed. Keep generation separate from deterministic lesson playback.

## Build, Test, and Development Commands

No install, development, build, lint, or test commands are configured yet. Do not assume `npm test` or `npm run build` works.

- `git status --short`: Review pending changes before submitting.
- `git diff --check`: Check tracked changes for whitespace errors.

When scaffolding the application, document exact setup and execution commands in `README.md` and expose consistent package scripts. The plan proposes Vite, Vitest, and Playwright; these are not installed tooling yet.

## Coding Style & Naming Conventions

Use descriptive Markdown headings and fenced code blocks with language labels. Preserve the plan’s distinction between proposed and implemented behavior.

For new code, use the planned TypeScript/React stack and Python for the TTS service. Prefer PascalCase for React components and types, camelCase for TypeScript functions and variables, and snake_case for Python functions and modules. Establish formatter, linter, and indentation rules when introducing each language.

## Testing Guidelines

Plan unit tests with Vitest and end-to-end tests with Playwright. Prioritize schema validation, source anchors, agent adapters, playback transitions, and audio synchronization. Use small fixture repositories for integration tests, including changed Git files and non-Git folders. No coverage threshold or test naming convention is currently enforced; establish both with the test setup.

## Commit & Pull Request Guidelines

The only existing commit is `Implementation plan`; no formal message convention is established. Use concise, descriptive commit subjects. Pull requests should explain the change, reference relevant plan sections or issues, and report validation performed. Include screenshots for UI changes and identify unimplemented dependencies.

## Security & Configuration

Keep analyzed repositories read-only by default. Validate filesystem paths and IPC payloads, isolate Electron’s renderer, and exclude credentials from fixtures and logs. Keep TTS local and disclose coding-agent network use.
