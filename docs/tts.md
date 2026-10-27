# Local speech generation

CodeCast uses [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) through the upstream Python `kokoro==0.9.4` package. The checkpoint is pinned to `f3ff3571791e39611d31c381e3a41a3af07b4987`; dependencies are pinned in `services/tts/uv.lock`. The four supported voices are Heart (`af_heart`), Bella (`af_bella`), Michael (`am_michael`), and Emma (`bf_emma`). Emma uses British English; the others use American English.

## Setup

1. Install Node.js/npm and [uv](https://docs.astral.sh/uv/getting-started/installation/).
2. Run `npm run setup:tts` from the repository root.
3. Run `npm run dev`, open a lesson, and choose **Narration**.
4. Choose a voice and click **Generate narration**.

Setup creates `services/tts/.venv` with Python 3.12, CPU PyTorch, Kokoro, SoundFile, and the English spaCy phonemizer model. Kokoro's supported Python range is 3.10–3.13; the system interpreter is not modified. Setup downloads the model and all four voices, about 330 MB plus runtime dependencies. If the runtime is installed but model assets are absent, the app also offers **Download model**.

Both setup and the model-download button require internet access. Inference uses explicit local checkpoint and voice paths with Hugging Face/Transformers offline flags. Lesson text is sent only over the local worker's stdin. There is no HTTP inference server, cloud speech API, or repository upload.

## Playback and caching

Generation uses `speechText` when supplied, otherwise `narration`. The normalizer expands common acronyms, splits camelCase/snake_case identifiers, removes Markdown link targets and backticks, and collapses whitespace. The visible transcript remains unchanged. Playback speed is applied by the player rather than synthesizing separate audio variants.

Each clip is mono PCM16 WAV at 24 kHz. Its duration is measured from the produced samples. The cache key covers normalized text, voice, checkpoint, runtime lock hash, sample rate, synthesis speed, and normalization version. Writes use temporary files and atomic replacement. Invalid/truncated cached WAVs are regenerated.

The default data directory is:

- Linux: `~/.config/codecast/speech` (or `$XDG_CONFIG_HOME/codecast/speech`).
- macOS: `~/Library/Application Support/codecast/speech`.
- Windows: `%APPDATA%\codecast\speech`.

`models/` holds pinned assets; `audio/` holds generated clips. Neither is written inside an analyzed repository. Generation accepts up to 200 steps and 200,000 text characters per job, with a maximum of 10,000 characters per step. Each clip is limited to 10 minutes and 25 MB.

Canceling terminates the worker and preserves finished clips. Retry with the same voice/text to reuse them. A failed or canceled job does not replace the active lesson's audio. Reloading currently resets lesson progress and its generated-audio selection; importing the lesson and generating again reuses matching clips without running inference again. Persistent course management remains a later milestone.

## Troubleshooting and tests

If the app reports a missing runtime, run `npm run setup:tts` and use **Check again**. CPU model loading and first-time inference can take time; the progress panel distinguishes loading from generation. Model and voice downloads can be resumed by rerunning setup.

For development, `CODECAST_TTS_PYTHON` can select a compatible Python executable. `CODECAST_TTS_DATA_DIR` selects a different cache directory; set it consistently for setup and app launch. These are process environment settings, not lesson-controlled options.

```sh
npm run test:tts
npm test
npm run build
CODECAST_TEST_KOKORO=1 npm run test:desktop
```

The opt-in desktop test uses the actual local model, generates the complete demo, plays its WAV, and requests it again to verify cache reuse. Add `CODECAST_HEADLESS=1` on Linux to use the headless Ozone display. Regular tests cover normalization, cache corruption, request validation, worker protocol, cancellation, and cache path containment without downloading a model.

The TTS runtime currently runs from a source checkout. Installer bundling and notices for redistributed dependencies still belong to the packaging milestone.
