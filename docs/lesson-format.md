# Authoring a lesson

Use `tests/fixtures/sample/codecast.lesson.json` as a complete example. Validate document structure against `schemas/codelesson-v1.schema.json`; CodeCast also checks IDs, line ranges, and source hashes at runtime.

The version 1.0 contract contains `schemaVersion`, `lessonId`, `title`, `description`, `repositoryRevision`, `learningObjectives`, `scenes`, and `recap`. Each scene has a unique `id`, a `title`, and ordered `steps`. Scene and step IDs must be unique throughout the document.

Each step contains:

```json
{
  "id": "validate-input",
  "title": "Validate at the boundary",
  "narration": "Explain this source range in a short paragraph.",
  "durationSeconds": 12,
  "audio": "audio/validate-input.mp3",
  "anchor": {
    "file": "src/server.ts",
    "startLine": 8,
    "endLine": 14,
    "sourceHash": "<64 lowercase hexadecimal characters>"
  }
}
```

Replace the placeholder hash with the SHA-256 digest of the complete file's UTF-8 bytes. For example, run `sha256sum src/server.ts` on Linux or `shasum -a 256 src/server.ts` on macOS. Line numbers are one-based and inclusive. Line-ending changes affect hashes. Git revision labels are descriptive metadata in this milestone; they do not reconstruct historical files.

Paths must be relative, use forward slashes, and stay inside the selected folder. Audio and source paths resolve from that folder, regardless of where the lesson JSON lives. Supported audio extensions are `.mp3`, `.wav`, `.ogg`, and `.m4a` (actual decoder availability depends on the runtime). Audio is limited to 25 MB per file; source and lesson files to 2 MB.

`audio` is optional. Without it, `durationSeconds` drives timed reading mode until you choose **Narration** to generate local speech. With audio, the actual media end event advances playback; `durationSeconds` should match the clip duration for accurate progress estimates. Optional `speechText` supplies the script for Kokoro generation; otherwise the engine uses `narration`. The normalizer applies to either script without changing the visible transcript.

The player pauses on manual navigation. Audio completion advances to the next step automatically, while pause freezes both audio and progression. Seeking selects a step and resets its audio. The last step ends with a recap, and replay starts from the first step.

If a source hash differs or the range is invalid, the player refuses to highlight it. Update the lesson after reviewing the new source; this milestone does not relocate stale anchors automatically.
