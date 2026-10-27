# CodeCast — Product & Engineering Execution Plan

**Version:** 1.0  
**Status:** Proposed implementation  
**Platform:** Cross-platform desktop application  
**Initial targets:** Linux and macOS, followed by Windows  
**Architecture:** Electron + Existing Coding Agents + Local TTS  
**Primary objective:** Make complex, unfamiliar, and AI-generated codebases deeply understandable through structured, narrated walkthroughs of actual source code.

---

# 1. Product Vision

## 1.1 The problem

AI coding agents have made it possible to develop large, sophisticated applications with relatively little manual code writing.

However, this creates a new problem: developers can own functional applications without fully understanding their implementations.

Traditional approaches to learning an unfamiliar codebase have significant limitations:

- Reading every source file is slow and mentally exhausting.
- Codebases are organized for execution and maintenance, not education.
- AI chats provide fragmented explanations without an overarching learning progression.
- Generated documentation tends to become outdated.
- Dependency graphs show relationships but often fail to explain the reasoning behind them.
- Existing code assistants generally require users to decide what to investigate next.

A developer needs an experience that systematically teaches the software instead of requiring them to discover everything independently.

## 1.2 Proposed solution

CodeCast is a desktop application that transforms a local codebase into an interactive, narrated educational series.

The user opens a folder, selects an installed AI coding agent, chooses an explanation depth, and generates a personalized course.

During playback:

- The AI narrates how the application works.
- The actual source code appears in a built-in editor.
- Relevant lines, symbols, expressions, and functions are highlighted.
- The viewer automatically scrolls and navigates between files.
- Explanations follow meaningful execution paths.
- Concepts are introduced in a deliberate teaching order.
- Listeners can pause, replay, inspect code, and eventually ask questions.
- The course maintains context across lessons.

The intended experience resembles a professionally structured programming tutorial, except the subject is the user's own codebase.

## 1.3 Success criteria

A successful CodeCast experience enables a user to:

1. Explain the application's architecture and major components.
2. Understand the responsibilities of significant modules.
3. Trace user-facing operations through their implementations.
4. Understand important algorithms and data transformations.
5. Explain the relationships between functions, files, services, and state.
6. Recognize the rationale and tradeoffs behind architectural choices.
7. Identify where to make changes and predict their likely consequences.
8. Explain important failure scenarios and edge cases.
9. Return to specific concepts without repeating the entire course.
10. Build an increasingly accurate mental model of the software.

Passive listening alone cannot guarantee complete understanding. CodeCast should maximize learning through progressive explanations, examples, reinforcement, and optional comprehension checks.

---

# 2. Core Product Principles

## 2.1 Real code is the primary visual medium

CodeCast must display the actual repository source.

The AI should control the viewport by opening files, highlighting exact source ranges, moving between callers and callees, and showing related implementations.

Architecture diagrams, charts, and additional educational visuals may be introduced later, but they should never replace real source-code exploration.

## 2.2 Reuse existing coding agents

Do not recreate the capabilities already available in Codex, Claude Code, and OpenCode.

Use these agents for repository exploration, reasoning, identifying execution paths, constructing explanations, and producing structured educational material.

CodeCast should primarily implement orchestration, curriculum design, validation, narration, and playback.

## 2.3 Teaching quality is the primary differentiator

A technically accurate explanation can still be difficult to learn from.

The generated course must have a coherent storyline, logical progression, appropriate prerequisite explanations, contextual examples, and useful recaps.

The application should not merely describe files in directory order.

## 2.4 Separate generation from playback

The AI agent should produce a declarative lesson specification, not control the editor during playback.

The player should independently interpret the specification and render the correct visual state.

This enables deterministic playback, portability, caching, regeneration, and support for multiple coding agents.

## 2.5 Local-first design

- Open local folders directly.
- Keep generated lessons and audio locally.
- Run TTS locally.
- Avoid unnecessary external infrastructure.
- Never require uploading repositories to CodeCast servers.
- Respect the user's existing coding-agent authentication and provider configuration.

Coding agents may still communicate with cloud model providers, depending on the agent and model selected. This distinction must be transparent.

## 2.6 Non-destructive by default

Repository analysis should operate in read-only mode.

CodeCast must not modify application source files during course generation without explicit user authorization.

---

# 3. Overall System Architecture

The application consists of eight major subsystems.

### A. Electron desktop shell

Responsible for application lifecycle, project selection, filesystem access, secure IPC, agent process management, and local service orchestration.

### B. Repository manager

Responsible for Git information, file snapshots, repository revisions, ignored files, source references, file-change detection, and course invalidation.

### C. Agent adapter layer

Provides a common interface for Codex CLI, Claude Code, OpenCode, and potentially additional coding agents.

### D. Curriculum engine

Determines what the listener should learn, in what order, and at what depth.

### E. Lesson director

Converts the curriculum into narration, visual instructions, code references, transitions, and teaching interactions.

### F. Validation engine

Verifies file references, source ranges, lesson structure, code evidence, narrative coherence, and stale references.

### G. Local speech engine

Generates and caches narration audio using free, locally running TTS models.

### H. Interactive lesson player

Displays source code and executes synchronized navigation, highlighting, narration, playback controls, and user interactions.

## High-level data flow

```text
LOCAL PROJECT FOLDER
        |
        v
Repository Manager
        |
        v
Agent Adapter
(Codex / Claude / OpenCode)
        |
        v
Repository Exploration
        |
        v
Curriculum Planning
        |
        v
Detailed Lesson Generation
        |
        v
Source + Lesson Validation
        |
        v
CodeLesson JSON
        |
        +-----------------------+
        |                       |
        v                       v
Local TTS Engine         Visual Playback Engine
        |                       |
        v                       v
Audio Segments           Code Navigation Events
        |                       |
        +-----------+-----------+
                    |
                    v
       SYNCHRONIZED CODE PLAYER
```

---

# 4. Technology Stack

| Component | Initial technology | Responsibility |
|---|---|---|
| Desktop shell | Electron | Native desktop application |
| Frontend | React + TypeScript | Application interface |
| Build system | Vite | Frontend development and builds |
| Code display | Monaco Editor | Syntax-highlighted code viewer |
| Agent execution | Node.js child processes | Run installed coding agents |
| Data contracts | JSON Schema + Zod | Validate generated content |
| Repository tools | Git CLI + Node filesystem APIs | Revisions and source access |
| Persistent metadata | SQLite | Projects, progress, settings, jobs |
| Course content | Versioned JSON files | Portable lesson representation |
| Initial TTS | Kokoro-82M | Local narration |
| TTS execution | Python sidecar | Model initialization and inference |
| Audio playback | HTMLAudioElement / Web Audio API | Narration playback |
| Desktop packaging | Electron Builder or Forge | Distributable applications |
| Testing | Vitest + Playwright | Unit and end-to-end tests |

Avoid building a custom source-code indexer, vector database, or knowledge graph for the MVP.

Introduce these only if testing demonstrates that existing agents and lightweight metadata are insufficient.

---

# 5. Desktop Application UX

## 5.1 Home screen

Provide:

- Open project folder.
- Recently opened projects.
- Previously generated courses.
- Available coding agents.
- Installed speech models.
- Basic settings.

## 5.2 Initial project workflow

When the user opens a directory:

1. Verify the directory exists and is accessible.
2. Detect Git metadata when available.
3. Identify the current commit and uncommitted changes.
4. Detect relevant frameworks, languages, and project structure.
5. Detect available coding-agent executables.
6. Allow the user to choose a coding agent and model.
7. Present explanation-depth options.
8. Begin repository analysis.

Do not require a Git repository. Non-Git directories should use content snapshots and hashes.

## 5.3 Course creation screen

Display a structured curriculum showing:

- Course title.
- Chapters and lessons.
- Main topics.
- Learning objectives.
- Prerequisites.
- Major files involved.
- Expected coverage.
- Generation status.

Allow the user to review and edit the curriculum before generating the full course.

## 5.4 Lesson player

The player should contain:

**Main area**

A Monaco-based source-code viewer with line numbers, syntax highlighting, automatic navigation, and visual focus.

**Secondary area**

The current lesson, chapter outline, explanation transcript, and optionally a file tree.

**Bottom controls**

Play, pause, seek, previous/next explanation, skip backward/forward, playback speed, and volume.

**Context controls**

Show current file, jump to source location, inspect current function, and view the relevant lesson objective.

During playback, the system should visually emphasize the code currently being explained while keeping surrounding context readable.

The viewer should support automatic navigation and manual inspection modes.

If the user scrolls manually, the application should avoid immediately fighting for control. Provide a clear Resume Guided View action.

---

# 6. Coding Agent Integration

## 6.1 Supported initial agents

Target:

- OpenAI Codex CLI.
- Anthropic Claude Code CLI.
- OpenCode CLI.

All integrations should use installed executables and existing provider configurations.

No API keys should be collected or stored directly by CodeCast when the CLI handles authentication.

## 6.2 Agent adapter interface

Define a common TypeScript contract:

```typescript
interface AgentAdapter {
  id: string;

  detect(): Promise<AgentAvailability>;

  getCapabilities(): AgentCapabilities;

  execute(
    request: AgentRequest
  ): Promise<AgentResult>;

  cancel(jobId: string): Promise<void>;
}
```

Each adapter should normalize:

- Model selection.
- Working-directory configuration.
- Session continuation.
- Prompt submission.
- Structured output.
- Status events.
- Token or cost usage, when available.
- Errors.
- Cancellation.
- Permissions.

The application must not assume every agent supports identical permissions or JSON Schema enforcement.

## 6.3 Agent execution

Use argument-based child-process spawning rather than interpolated shell commands.

Set the selected project as the working directory.

Capture stdout and stderr independently.

Apply process timeouts and cancellation handling.

Store raw run logs separately from validated lesson artifacts.

## 6.4 Agent permissions

Default to the most restrictive practical read-only configuration supported by the selected agent.

Do not automatically allow:

- Repository writes.
- Package installation.
- Arbitrary execution of project scripts.
- Destructive Git commands.
- Access to unrelated directories.
- External network access beyond what the selected agent requires.

Because agent permissions differ, implement per-provider capability checks rather than assuming a universal sandbox.

## 6.5 Generation job system

Agent operations may be long-running.

Create a job controller supporting:

- Queued jobs.
- Running jobs.
- Completed jobs.
- Failed jobs.
- Cancellation.
- Retry.
- Partial-output recovery.
- Progress events.
- Resume when supported.

Preserve successfully generated chapters when later chapters fail.

---

# 7. Repository Understanding Pipeline

Do not generate all explanations from a single large prompt.

Use a multistage analysis workflow.

## Pass 1 — Repository reconnaissance

The agent examines the repository to identify:

- Application purpose.
- Main frameworks.
- Languages.
- Entry points.
- Major modules.
- User-facing features.
- API boundaries.
- Data models.
- Configuration.
- Persistence mechanisms.
- Background processes.
- External integrations.
- Significant algorithms.
- Tests.
- Major execution paths.

**Output:** `repository-manifest.json`

This artifact is the shared factual foundation for later stages.

## Pass 2 — Architectural understanding

The agent identifies:

- Responsibilities of subsystems.
- Inter-module relationships.
- Critical workflows.
- Application state.
- Important data transformations.
- Architectural patterns.
- Coupling and dependencies.
- External services.

**Output:** `architecture.json`

Relationships should include supporting source references whenever practical.

## Pass 3 — Curriculum planning

The agent transforms the technical understanding into a learning plan.

It must decide:

- What should be taught.
- Why each topic matters.
- Which topics require prerequisite explanations.
- Which workflows to teach first.
- Which code deserves detailed treatment.
- Which topics can be summarized.
- Where recaps are needed.
- How the overall course should build toward deeper understanding.

**Output:** `curriculum.json`

## Pass 4 — Individual lesson planning

For each lesson, produce:

- Learning objectives.
- Prerequisite knowledge.
- Opening question or motivating problem.
- Narrative progression.
- Key source-code targets.
- Concepts to introduce.
- Examples.
- Common misconceptions.
- Important edge cases.
- Closing recap.
- Comprehension objectives.

**Output:** `lesson-plan.json`

## Pass 5 — Detailed lesson generation

The agent produces the actual narration script and visual instructions.

Each meaningful explanation step should have a clear purpose.

**Output:** `lesson.json`

## Pass 6 — Validation and refinement

Validate source references, factual claims, learning progression, and completeness.

If necessary, return specific sections to the agent for correction.

Do not regenerate the entire course because one code reference is invalid.

---

# 8. Curriculum Engine

This is the most important intellectual component of CodeCast.

Its purpose is to optimize for understanding rather than documentation coverage alone.

## 8.1 Default learning progression

### Stage 1: Purpose and context

Explain what the application does, who uses it, and its major capabilities.

### Stage 2: The overall mental model

Introduce the main components, responsibilities, boundaries, and high-level data flow.

### Stage 3: A complete real workflow

Choose a meaningful user action and follow it through the relevant implementation.

### Stage 4: Detailed implementation

Explore important functions, algorithms, control flow, data structures, and state changes.

### Stage 5: Interactions and edge cases

Explain how components interact, how failures propagate, and how concurrency, retries, validation, and exceptional conditions are handled.

### Stage 6: Architectural reasoning

Explore meaningful implementation decisions, alternatives, and tradeoffs.

Distinguish documented design rationale from the AI's interpretation.

### Stage 7: Consolidation

Reconstruct the entire workflow and connect it back to the application's architecture.

## 8.2 Concept dependency model

Create a lightweight concept graph describing educational prerequisites.

For example:

```text
HTTP requests
      |
      v
Asynchronous request handling
      |
      v
Background processing
      |
      v
Task queues
      |
      v
Retries and failure recovery
```

This graph differs from the repository dependency graph.

A source function might depend on a queue library, but a listener may need to understand asynchronous execution before queue internals.

The curriculum should respect these learning dependencies.

## 8.3 Narrative structure

Every substantial explanation should follow an intuitive progression:

1. Establish the question or problem.
2. Connect it to something already understood.
3. Introduce the relevant concept.
4. Show the actual code.
5. Explain the implementation.
6. Follow significant dependencies.
7. Explore design reasoning and edge cases.
8. Reinforce the learning objective.
9. Transition naturally to the next topic.

Avoid unnecessary repetition and abrupt transitions.

## 8.4 Understanding versus coverage

Track two separate measures.

**Code coverage**

Which modules, functions, workflows, and concepts have been discussed?

**Educational coverage**

Which learning objectives have been explained, reinforced, and optionally tested?

A function being mentioned does not mean its behavior has been sufficiently taught.

## 8.5 Depth modes

### Overview

Architecture, major features, and important flows.

### Deep Understanding — default

Architecture, complete workflows, significant functions, algorithms, data transformations, state management, and failure handling.

### Exhaustive

Nearly all meaningful source components, nontrivial branches, important utility functions, relevant configuration, and implementation details.

Exhaustive should not mean mechanically explaining every trivial statement.

---

# 9. Lesson Director

The Lesson Director translates educational structure into a synchronized code-and-audio experience.

## 9.1 Primary responsibilities

- Generate clear spoken narration.
- Select the source code relevant to each explanation.
- Specify navigation between files.
- Specify highlights and focus regions.
- Maintain visual context.
- Coordinate caller/callee exploration.
- Produce transitions between topics.
- Control instructional pacing.
- Associate each narration segment with a precise visual state.

## 9.2 Supported visual actions

Initial action vocabulary:

| Action | Purpose |
|---|---|
| `open_file` | Display a source file |
| `focus_range` | Scroll to an exact source range |
| `highlight_range` | Emphasize relevant code |
| `highlight_symbol` | Highlight a named symbol |
| `select_expression` | Emphasize a specific expression |
| `navigate_to_symbol` | Follow a function or definition |
| `show_context` | Expand surrounding source |
| `clear_highlights` | Remove temporary highlights |
| `hold_view` | Keep the current context visible |

Later:

- Split view.
- Caller/callee comparison.
- Inline annotations.
- Runtime traces.
- Animated control-flow indicators.
- Diff visualizations.
- Architecture diagrams.

## 9.3 Instruction granularity

Narration must be divided into meaningful segments.

Do not generate one enormous audio file for an entire lesson.

Each segment should describe one closely related concept and have one or more associated visual instructions.

Shorter segments enable better highlighting, seeking, audio regeneration, and interruption.

However, narration must remain natural. Segment boundaries should not create awkward pauses or robotic delivery.

---

# 10. CodeLesson Format

## 10.1 Design choice

Use versioned JSON as the canonical machine-readable lesson format.

JSON is suitable because it supports:

- Schema validation.
- Deterministic interpretation.
- Compatibility across agents.
- Simple local persistence.
- Easy debugging.
- Programmatic migration.
- Audio and UI generation.

Markdown can be generated as a human-readable export, but should not be the primary playback contract.

## 10.2 Proposed document structure

```text
CodeLesson
├── schemaVersion
├── lessonId
├── title
├── description
├── learningObjectives
├── prerequisites
├── repositoryRevision
├── scenes
│   ├── sceneId
│   ├── title
│   └── steps
│       ├── stepId
│       ├── narration
│       ├── speechText
│       ├── visualActions
│       ├── evidence
│       └── transitions
└── recap
```

## 10.3 Example

```json
{
  "schemaVersion": "1.0",
  "lessonId": "upload-workflow",
  "title": "Understanding File Uploads",
  "learningObjectives": [
    "Trace the upload request",
    "Understand task creation",
    "Understand background processing"
  ],
  "steps": [
    {
      "id": "step-001",
      "narration": "Let's begin with the upload handler. This function receives the incoming file and starts the validation process.",
      "speechText": "Let's begin with the upload handler. This function receives the incoming file and starts the validation process.",
      "visualActions": [
        {
          "type": "open_file",
          "file": "backend/upload.py"
        },
        {
          "type": "highlight_range",
          "file": "backend/upload.py",
          "startLine": 14,
          "endLine": 20
        }
      ],
      "evidence": [
        {
          "file": "backend/upload.py",
          "symbol": "handle_upload"
        }
      ]
    }
  ]
}
```

This is an illustrative schema fragment rather than the complete final contract.

## 10.4 Visual timing model

The agent does not generate absolute audio timestamps.

Instead:

1. Load the current explanation step.
2. Apply its visual actions.
3. Load the corresponding synthesized audio.
4. Play the audio.
5. Advance when playback completes.

Any resulting timestamps are derived from actual audio durations.

For sub-sentence highlighting, use smaller narration phrases or optional forced alignment.

## 10.5 Reliable code anchors

Every reference should ideally contain:

- Relative file path.
- Symbol identifier.
- Source range.
- Nearby source snippet or fingerprint.
- Source-content hash.
- Git revision or snapshot identifier.

The validator should first resolve the reference against the original snapshot.

If the repository has changed, attempt safe relocation using symbols, source matching, and Git diff information.

Never silently highlight unrelated code when a source reference becomes invalid.

---

# 11. Local Text-to-Speech Engine

## 11.1 Initial model

Start with Kokoro-82M.

Reasons:

- Free local inference.
- Relatively lightweight.
- Suitable for natural narration.
- Apache 2.0 model licensing.
- Compatible with a straightforward local inference service.

Evaluate voice quality, CPU-only performance, and packaging on target operating systems before finalizing distribution.

## 11.2 Alternatives

Consider:

- Chatterbox for more expressive narration and conversational delivery.
- Piper as a lightweight fallback.

Alternative models should be evaluated for voice quality, speed, hardware requirements, licensing, and distribution complexity.

## 11.3 TTS abstraction

Implement a generic interface:

```typescript
interface TTSProvider {
  initialize(): Promise<void>;

  synthesize(
    request: SpeechRequest
  ): Promise<AudioSegment>;

  listVoices(): Promise<VoiceInfo[]>;

  dispose(): Promise<void>;
}
```

The rest of the application should not depend on Kokoro-specific APIs.

## 11.4 Audio generation

For every narration segment:

1. Normalize text for speech.
2. Resolve technical-identifier pronunciations.
3. Generate local audio.
4. Measure the audio duration.
5. Store the file in a content-addressed cache.
6. Associate it with the explanation step.

## 11.5 Technical pronunciation

Separate text displayed to the user from text spoken by the model.

Example:

```json
{
  "displayText": "Next we call getUserById().",
  "speechText": "Next we call get user by I D."
}
```

Maintain a pronunciation dictionary for frequently encountered technologies, symbols, and code identifiers.

Allow users to override pronunciations.

## 11.6 Audio caching

Cache keys should incorporate:

- Normalized speech text.
- Model identifier and version.
- Voice.
- Speech speed.
- Relevant synthesis parameters.

Regenerate only the segments affected by changes.

## 11.7 Audio-player requirements

Support:

- Play/pause.
- Speed adjustment.
- Previous/next segment.
- Seek within a lesson.
- Volume.
- Resume position.
- Transcript display.
- Audio preloading.
- Smooth segment transitions.

The player must not drift away from the associated code state.

---

# 12. Repository Versioning and Git Integration

## 12.1 Snapshot identification

For Git projects, record:

- Repository identity.
- Current commit.
- Branch.
- Working-tree status.
- Content fingerprints for relevant files.
- The actual source snapshot used for lesson generation.

Uncommitted changes must be accounted for.

## 12.2 Non-Git folders

Generate stable file hashes and a source manifest.

Do not require the user to initialize Git.

## 12.3 Change detection

When reopening a project:

1. Compare the current source against the course snapshot.
2. Identify modified, moved, added, and deleted files.
3. Determine affected lessons.
4. Flag potentially outdated explanations.
5. Offer selective regeneration.

Avoid rebuilding the entire course when only one unrelated file has changed.

## 12.4 Exact historical playback

When possible, retain verified source snapshots necessary for playback.

Optionally reconstruct committed versions using Git.

Never assume an old commit hash alone identifies uncommitted source content.

## 12.5 Git history as teaching evidence

A future version may use commit history to explain why code evolved.

However, Git history should be treated as supporting evidence, not definitive proof of developer intent.

---

# 13. Project Storage

Use the application's data directory by default.

Suggested structure:

```text
codecast-data/
├── config/
│   └── settings.json
├── projects/
│   └── project-id/
│       ├── manifest.json
│       ├── repository-lock.json
│       ├── architecture.json
│       ├── curriculum.json
│       ├── lessons/
│       ├── lesson-plans/
│       ├── snapshots/
│       ├── audio/
│       ├── generation-logs/
│       └── validation-reports/
├── models/
└── cache/
```

Use SQLite for metadata such as project identities, playback progress, generation jobs, recent projects, and user settings.

Keep lesson contents in versioned files for easy inspection, editing, export, and migration.

---

# 14. Prompt Engineering Strategy

Instead of one giant prompt, maintain separate prompt templates for each responsibility.

## 14.1 Repository analyst

Goal: establish a factually grounded understanding of the codebase.

Must identify real source evidence, distinguish observed behavior from inference, and acknowledge uncertainty.

## 14.2 Curriculum architect

Goal: transform code understanding into a coherent educational sequence.

Must consider prerequisite knowledge, learning objectives, narrative flow, cognitive load, code importance, and reinforcement.

## 14.3 Lesson writer

Goal: produce engaging, detailed narration.

Must use natural spoken explanations rather than documentation-style summaries.

Must introduce concepts before relying on them.

Must explain why important code exists before dissecting implementation details.

## 14.4 Visual director

Goal: align the explanation with real code.

Must select the smallest useful source range while retaining enough surrounding context.

Must coordinate file changes with narration and prevent distracting navigation.

## 14.5 Educational reviewer

Goal: evaluate the lesson as teaching material.

Checks for:

- Missing context.
- Unexplained terminology.
- Abrupt transitions.
- Repeated content.
- Overly shallow explanations.
- Unsupported architectural claims.
- Excessive time spent on trivial code.
- Important concepts introduced out of order.
- Learning objectives not actually addressed.

## 14.6 Technical reviewer

Goal: verify code accuracy.

Checks that explanations and source references are compatible with the actual repository.

Use structured validation reports and targeted repair prompts.

---

# 15. Playback State Machine

Implement explicit player states:

```text
IDLE
  |
  v
LOADING
  |
  v
READY
  |
  v
PLAYING <----> PAUSED
  |
  v
COMPLETED

ERROR / CANCELLED
```

Track:

- Active project.
- Active course.
- Active lesson.
- Active step.
- Current audio position.
- Current file.
- Applied highlights.
- Navigation history.
- Playback speed.
- Whether guided scrolling is enabled.

Seeking must restore both the audio position and the correct code view.

All previous visual effects must be cleared or reconstructed deterministically when seeking.

A lesson should be playable identically after restarting the application.

---

# 16. Security and Privacy

Security must be part of the initial implementation.

## Electron security

- Enable context isolation.
- Disable Node.js integration in the renderer.
- Use a limited preload bridge.
- Validate IPC messages.
- Restrict navigation and external URLs.
- Use a restrictive Content Security Policy.
- Avoid rendering repository content as trusted HTML.

## Repository access

- Restrict reading to approved project directories.
- Exclude dependency caches, build outputs, secrets, and irrelevant generated files.
- Respect `.gitignore` where appropriate.
- Provide additional exclusion rules.
- Validate paths to prevent traversal outside permitted directories.
- Handle symlinks carefully.

## Agent safety

- Prefer read-only permissions.
- Never use unrestricted auto-approval by default.
- Require explicit authorization for potentially destructive commands.
- Separate agent-generated text from executable instructions.
- Treat repository files and agent output as untrusted input.

## Privacy

- Explain that selected coding agents may transmit repository content to their model providers.
- Keep TTS generation local.
- Do not collect repository content for telemetry.
- Exclude secrets and credentials from diagnostic logs.
- Allow deletion of generated courses, caches, and snapshots.

---

# 17. Testing and Quality Assurance

## 17.1 Unit tests

Test:

- Agent adapters.
- Schema validation.
- Source anchor resolution.
- Git-change detection.
- Narration normalization.
- Audio-cache keys.
- Player state transitions.
- Lesson migrations.

## 17.2 Integration tests

Test complete flows using small example repositories.

Examples:

- Simple Python project.
- React frontend.
- FastAPI backend.
- Full-stack React + FastAPI application.
- Git repository with changed files.
- Non-Git directory.

## 17.3 Playback tests

Verify that:

- The correct file opens.
- The correct lines are highlighted.
- Navigation follows the lesson specification.
- Audio completion advances the lesson.
- Pausing stops progression.
- Seeking restores visual state.
- Missing audio fails gracefully.
- Invalid source references cannot trigger unrelated highlights.

## 17.4 Educational quality tests

Develop a benchmark set of repositories with manually established explanations of important workflows.

Evaluate generated lessons for:

- Factual correctness.
- Coverage.
- Teaching order.
- Prerequisite handling.
- Narrative coherence.
- Explanation depth.
- Visual relevance.
- Redundancy.
- Learning-objective completion.

Add optional comprehension questions and practical navigation tasks to evaluate user understanding.

## 17.5 Human evaluation

The strongest early test is to give the application an unfamiliar working codebase and determine whether a listener can accurately explain and trace its major behavior afterward.

---

# 18. Implementation Roadmap

## Phase 0 — Architecture and contracts

**Goal:** Define how the components communicate before building the interface.

Tasks:

- Finalize the product scope.
- Define TypeScript domain models.
- Design the CodeLesson JSON Schema.
- Define source-anchor format.
- Define agent adapter contracts.
- Define TTS interface.
- Define player state machine.
- Define storage layout.
- Document the security boundaries.

**Deliverable:** A small set of stable schemas, interfaces, and architectural decisions.

**Exit criterion:** A hand-authored CodeLesson document can be validated and interpreted without an AI agent.

## Phase 1 — Minimal narrated code player

**Goal:** Prove the core experience works.

Tasks:

- Initialize Electron + React + TypeScript.
- Integrate Monaco.
- Open a local repository.
- Implement file navigation.
- Implement source-range highlighting.
- Implement sequential narration steps.
- Integrate basic audio playback.
- Implement play, pause, next, previous, and seeking.
- Track active audio and visual state.

Use manually written lesson JSON initially.

**Deliverable:** A standalone desktop application capable of playing a synchronized code walkthrough.

**Exit criterion:** A complete example lesson plays correctly, including cross-file navigation, highlighting, pause, and seek.

## Phase 2 — Agent integration

**Goal:** Generate real lesson specifications from source code.

Tasks:

- Implement agent detection.
- Build Codex adapter first.
- Add structured prompt execution.
- Implement generation-job lifecycle.
- Generate a repository manifest.
- Generate a small curriculum.
- Generate one detailed lesson.
- Validate JSON and source references.
- Load generated content into the player.

**Deliverable:** Open a real folder, generate a lesson, and play its code-navigation sequence.

**Exit criterion:** A validated lesson generated by a coding agent can run without manually fixing its source references.

## Phase 3 — Local voice integration

**Goal:** Turn a text walkthrough into a narrated experience.

Tasks:

- Integrate Kokoro.
- Add local model initialization.
- Generate speech for lesson segments.
- Normalize code pronunciations.
- Cache generated audio.
- Connect audio completion to visual progression.
- Implement playback-speed changes.
- Add preloading and recovery.
- Save playback progress.

**Deliverable:** A complete, offline-playable lesson after agent generation finishes.

**Exit criterion:** Playback remains synchronized through pauses, seeks, file transitions, and restarts.

## Phase 4 — Educational curriculum engine

**Goal:** Make generated lessons coherent and genuinely educational.

Tasks:

- Generate concept dependency maps.
- Implement curriculum-planning prompts.
- Implement detailed lesson-planning prompts.
- Build learning-objective tracking.
- Add narrative quality review.
- Add code-reference verification.
- Add targeted regeneration.
- Add introductory lessons and recaps.
- Add explanation-depth configurations.
- Maintain course-level learning context.

**Deliverable:** A coherent multi-lesson course covering the major architecture and workflows of a repository.

**Exit criterion:** An unfamiliar developer can follow a complete feature and accurately explain its major implementation steps afterward.

## Phase 5 — Full application experience

**Goal:** Make CodeCast practical for repeated daily use.

Tasks:

- Implement project library.
- Add recent projects.
- Add curriculum editing.
- Add lesson regeneration.
- Add playback-history persistence.
- Add generation progress reporting.
- Add source-change detection.
- Add model and voice settings.
- Add better error handling.
- Add multiple agent adapters.
- Add cross-platform packaging.

**Deliverable:** Usable desktop application.

**Exit criterion:** Users can repeatedly generate, resume, update, and manage courses across multiple projects.

## Phase 6 — Advanced learning capabilities

**Goal:** Extend the application beyond passive playback.

Tasks:

- Interactive pause-and-question workflow.
- Branching explanations.
- Deeper explanations of selected functions.
- Two-host conversational podcast mode.
- Optional knowledge checks.
- Coverage dashboard.
- Code-change explanation.
- Additional TTS backends.
- Lesson export.
- Optional runtime traces and execution playback.

**Deliverable:** Interactive code-learning environment.

---

# 19. Development Priorities

## P0 — Essential

- Electron desktop shell.
- Local folder opening.
- Monaco source viewer.
- CLI agent execution.
- Validated lesson JSON.
- Correct source references.
- Narration generation.
- Synchronized playback.
- Pause, resume, seek.
- Read-only repository handling.
- Meaningful curriculum order.

## P1 — Important

- Multiple agent support.
- Git revision tracking.
- Audio caching.
- Playback persistence.
- Multi-lesson courses.
- Curriculum editing.
- Automatic prerequisite planning.
- Detailed educational review.
- Incremental lesson regeneration.

## P2 — Advanced

- Conversational hosts.
- Interactive questioning.
- Adaptive lesson depth.
- Knowledge checks.
- Runtime execution tracing.
- Advanced visualizations.
- Video export.
- Collaborative course sharing.

---

# 20. Major Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Agent misunderstands the code | Ground claims in source references and validate important behavior |
| Narration becomes boring | Separate curriculum planning from scriptwriting; optimize for explanation and storytelling |
| Excessive generation cost | Reuse agent sessions when useful, generate lessons incrementally, cache validated outputs |
| Invalid code highlighting | Validate anchors against exact source snapshots |
| Repository changes invalidate lessons | Track revisions and regenerate affected sections |
| TTS mispronounces identifiers | Speech normalization and pronunciation dictionary |
| Audio and visuals drift | Event-driven segment playback rather than generated timestamps |
| TTS makes playback feel fragmented | Use natural phrase boundaries, audio preloading, and smooth transitions |
| Agent modifies source files | Restrictive permissions and explicit approval policies |
| Large repositories overwhelm analysis | Hierarchical reconnaissance, bounded lesson generation, and incremental work |
| Cross-platform model packaging is difficult | Isolate TTS behind a provider interface and test packaging early |
| Generated course is excessively long | Prioritize complexity and importance, with configurable depth |
| Technical coverage is mistaken for learning | Separate source coverage from educational-objective coverage |

---

# 21. Project Structure

Suggested implementation layout:

```text
codecast/
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main/
│       │   └── preload/
│       └── src/
│           ├── components/
│           ├── views/
│           ├── player/
│           └── state/
│
├── packages/
│   ├── core/
│   │   ├── schemas/
│   │   ├── types/
│   │   └── validation/
│   │
│   ├── agents/
│   │   ├── codex/
│   │   ├── claude/
│   │   ├── opencode/
│   │   └── shared/
│   │
│   ├── repository/
│   │   ├── filesystem/
│   │   ├── git/
│   │   └── anchors/
│   │
│   ├── curriculum/
│   │   ├── prompts/
│   │   ├── planning/
│   │   └── evaluation/
│   │
│   ├── lessons/
│   │   ├── generation/
│   │   ├── verification/
│   │   └── migration/
│   │
│   ├── playback/
│   │   ├── timeline/
│   │   ├── visual-actions/
│   │   └── synchronization/
│   │
│   └── storage/
│
├── services/
│   └── tts/
│       ├── providers/
│       ├── normalization/
│       └── cache/
│
├── schemas/
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
└── README.md
```

Keep the initial structure pragmatic. Extract packages only where responsibilities genuinely benefit from isolation.

---

# 22. First End-to-End Demonstration

The first major demonstration should use a small but realistic application, ideally one containing a frontend, API, and backend operation.

### User experience

1. Launch CodeCast.
2. Click Open Folder.
3. Select the project.
4. Choose Codex as the coding agent.
5. Choose Deep Understanding.
6. Request a lesson explaining one user-facing feature.
7. Review the generated lesson outline.
8. Generate the narration.
9. Press Play.

### Expected behavior

The instructor introduces the application's purpose.

The real frontend source opens.

The instructor explains which user action triggers the workflow.

The relevant handler is highlighted.

The editor navigates to the API request.

The backend route opens.

The narration explains validation, data handling, and downstream function calls.

The viewer follows those calls into their implementations.

The instructor discusses important design decisions and potential failure cases.

The lesson closes by reconstructing the complete flow.

The listener can pause, inspect the code, return to earlier explanations, and resume playback.

This demonstration validates the central product experience before adding advanced features.

---

# 23. Completion Criteria for Version 1.0

CodeCast 1.0 should be considered complete when:

- A user can open an ordinary local repository.
- At least one installed coding agent can analyze it.
- The system can generate a structured curriculum.
- The curriculum can produce detailed, validated lessons.
- The lessons reference actual repository files.
- Local TTS can generate natural narration.
- Playback automatically opens and highlights the correct source.
- Audio and code navigation remain synchronized.
- Users can pause, rewind, seek, and resume reliably.
- Source changes are detected.
- Generated courses persist across restarts.
- Repositories are not modified during normal course generation.
- The application clearly explains when remote model providers may access source content.
- The teaching sequence is coherent enough to support meaningful understanding of a real feature.

---

# 24. Long-Term Product Direction

CodeCast could eventually become an independent educational layer for software.

Potential applications include:

- Understanding AI-generated applications.
- Onboarding engineers to unfamiliar repositories.
- Learning open-source projects.
- Teaching programming through real examples.
- Understanding legacy systems.
- Explaining complex research code.
- Reviewing architectural changes.
- Learning how specific algorithms are implemented.
- Creating reusable technical training courses.

The product should remain coding-agent agnostic and TTS-provider agnostic.

The underlying structured lesson format could eventually become portable across desktop applications, web players, and other learning platforms.

However, the initial product should remain focused on one experience:

**Open a codebase, press Play, and progressively understand how the software works while seeing its real implementation.**

---

# 25. Final Engineering Strategy

Build CodeCast in this order:

**First, prove the player.** Create a manually authored lesson and ensure the desktop application can display real code, navigate between files, highlight precise regions, and play narration deterministically.

**Second, connect the coding agent.** Generate the same lesson format directly from an existing repository using Codex, without building a separate code intelligence engine.

**Third, integrate local speech.** Turn generated narration into reusable audio segments and synchronize them with source navigation.

**Fourth, perfect the teaching workflow.** Introduce multi-pass curriculum planning, concept prerequisites, educational reviews, and course continuity.

**Fifth, make it a complete desktop product.** Add persistent projects, multiple agents, Git-aware updates, packaging, and recovery.

**Finally, introduce advanced interactivity.** Add questions, adaptive lessons, conversational hosts, deeper explorations, and personalized learning.

The most important rule throughout development is:

**Never sacrifice the quality of understanding for the quantity of generated explanations.**

CodeCast should not be an AI that reads source code aloud.

It should be an AI-powered instructor that uses the actual codebase to teach software engineering, implementation details, and system behavior in a structured, intuitive, and deeply understandable way.
