# Generate lessons with coding agents

CodeCast supports three installed CLIs through one generation flow:

| Agent | Command | Before using CodeCast |
| --- | --- | --- |
| Codex | `codex` | Install the CLI and run `codex login`. |
| Claude Code | `claude` | Install Claude Code and sign in through its terminal interface. |
| OpenCode | `opencode` | Install OpenCode and connect a provider in its terminal interface. |

Detection checks the CLI version, not account/model access. A detected CLI may still need a login or an accessible model. Unsupported headless flags produce an update instruction rather than falling back to broader permissions. The adapters were developed against Codex 0.162.1, Claude Code 2.1.301, and OpenCode 1.19.4.

## Workflow and context

Open a folder, click **Create lesson**, select an agent, and describe a specific episode focus. Choose **Overview** for roughly 4–7 steps or **Deep understanding** for roughly 12–20. An optional model field passes an ID directly to the CLI; OpenCode uses `provider/model`. Leaving it empty uses that agent's default model for the restricted run.

Review the suggested files before generation. CodeCast supplies complete, numbered source files rather than granting the agent filesystem access to the original repository. The initial limit is **24 files**, **64 KB per file**, and **200 KB total**. Dependency/build directories, common credential paths, ignored files, agent configuration directories, instruction files, and lockfiles are excluded from generation context. Narrow the selection when a file or total exceeds the budget.

The model sees only the selected snapshot and episode focus. This is one bounded walkthrough, not autonomous exploration of an entire repository. Include callers and callees relevant to the workflow. If the supplied context is incomplete, the prompt asks the model to state that limitation.

## Adapter restrictions

- **Codex:** non-interactive `exec`, read-only sandbox, approvals disabled, ephemeral session, and JSON Schema output. User configuration/rules are not loaded, and shell, app, hook, and multi-agent features are disabled for this invocation. Existing authentication is retained; custom user-configured providers are not imported by this adapter. See [official non-interactive guidance](https://learn.chatgpt.com/docs/non-interactive-mode) and [CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
- **Claude Code:** print mode, safe mode, no built-in tools, no MCP tools, non-interactive permission handling, no session persistence, and structured JSON output. Safe mode preserves authentication while disabling customizations. See [Claude's CLI reference](https://code.claude.com/docs/en/cli-reference).
- **OpenCode:** headless JSON events and a dedicated agent with all tool permissions denied. External plugins/project configuration are disabled, and repository snapshots are disabled in the temporary workspace. Provider configuration and login are reused. See [OpenCode CLI](https://opencode.ai/docs/cli/), [permissions](https://opencode.ai/docs/permissions/), and [configuration](https://opencode.ai/docs/config/).

All agents run in a temporary directory containing only the host's output schema and result file, with source passed through stdin. The original repository is not the CLI working directory, and its files are not copied there. Read-only Codex sandboxing and Claude/OpenCode tool restrictions are different mechanisms; the latter are CLI controls rather than OS filesystem isolation. Installed CLIs and administrator-managed settings remain trusted components.

Selected source and goals may be transmitted to the configured provider; CodeCast has no source-upload backend. CLIs may maintain their own local diagnostics, credentials, or history. In particular, OpenCode may retain its session transcript under its normal storage settings.

## Validation, cancellation, and saved lessons

The model returns a draft containing narration and source ranges. CodeCast rejects unexpected fields, references outside the selected files, invalid ranges, and source changed during generation. The host supplies unique IDs, exact source hashes, a snapshot fingerprint, and estimated reading durations. Generated lessons initially have no audio; Kokoro replaces reading estimates with measured clip durations when narration is generated.

Validation establishes that source references match, not that every explanation is correct. Review the outline and inspect the highlighted code. Source is checked again when opening the reviewed lesson and during playback.

Only one generation job runs at a time. Canceling terminates its process group on Linux/macOS and preserves the current lesson. Windows process termination uses the spawned process handle. Jobs time out after ten minutes and agent output is capped at 8 MB. Failed/canceled jobs do not save a successful lesson. Temporary job files are removed after completion.

Successful canonical lesson JSON is saved under `<CodeCast userData>/generation/lessons/<lessonId>.json`; on Linux the default is `~/.config/codecast/generation/lessons`. You can import it later after selecting the same repository. The desktop also saves generated episodes to its local `episodes/` library with referenced source snapshots. Choose **Episode library** to reopen them. The last opened episode restores automatically on launch; playback position is not saved. Narration generated for a library episode persists there.

## Configuration and verification

`CODECAST_CODEX_BIN`, `CODECAST_CLAUDE_BIN`, and `CODECAST_OPENCODE_BIN` can specify trusted executable paths when commands are not on the desktop process's `PATH`. They cannot be set by lesson content or renderer requests. Use native executables where npm command shims are not directly executable, particularly on Windows. `CODECAST_GENERATION_DATA_DIR` overrides the archive directory for development.

```sh
npm test
npm run test:agents:live -- codex
npm run test:agents:live -- claude
npm run test:agents:live -- opencode provider/model
npm run build
CODECAST_TEST_AGENT=codex npm run test:desktop
```

Live tests send only the three files in `tests/fixtures/sample/src` through the selected CLI and may consume provider usage. Set `CODECAST_HEADLESS=1` for the Linux headless display, or `CODECAST_TEST_AGENT_MODEL` to test an explicit model in the desktop flow. Regular tests use deterministic CLI protocol fixtures and exercise all three adapters without calling a provider.

## Scripts first, narration on demand

For the repository-wide CodeCast podcast, use `npm run podcast:series -- artifacts/codecast-series --scripts-only` to generate and save the scripts without starting Python, checking speech readiness, or rendering audio. Existing narrated episodes retain their recordings. Each script must contain at least 1,200 spoken words and reference every assigned file; the artifacts include a transcript and `script-verification.json`. Durations for unnarrated scripts are estimates.

Open **Episode library**, select a script, then choose **Narration** when you want its audio. That action uses the installed local Kokoro engine and saves the resulting recording with the episode. Generate one script with `--scripts-only --episode=3`, or render a planned script with `--episode=3` without the script-only flag. `--plan` refreshes the source inventory before starting a new run; validate existing scripts before reusing a plan after source edits.
