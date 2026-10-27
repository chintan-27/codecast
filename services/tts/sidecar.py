"""Kokoro JSON-lines worker. Only `prepare` is allowed to download assets."""

import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import wave

MODEL_REPO = "hexgrad/Kokoro-82M"
MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
VOICES = ("af_heart", "af_bella", "am_michael", "bf_emma")
SAMPLE_RATE = 24000
CACHE_VERSION = "kokoro-0.9.4-normalization-1"
RUNTIME_LOCK_HASH = hashlib.sha256(Path(__file__).with_name("uv.lock").read_bytes()).hexdigest()
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def emit(event):
    print(json.dumps(event), flush=True)


def normalize_text(text):
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    text = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", text)
    text = re.sub(r"(?<=\w)_(?=\w)", " ", text)
    for token, pronunciation in {
        "API": "A P I", "HTTP": "H T T P", "HTTPS": "H T T P S",
        "URL": "U R L", "SQL": "S Q L", "CLI": "C L I", "IPC": "I P C",
        "TTS": "T T S", "JSON": "jay son", "SHA": "sha",
    }.items():
        text = re.sub(rf"\b{token}\b", pronunciation, text)
    return re.sub(r"\s+", " ", text).strip()


def cache_key(text, voice):
    payload = {
        "version": CACHE_VERSION, "revision": MODEL_REVISION,
        "runtimeLock": RUNTIME_LOCK_HASH,
        "voice": voice, "text": normalize_text(text), "sampleRate": SAMPLE_RATE,
        "speed": 1,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def audio_info(file):
    if file.stat().st_size > MAX_AUDIO_BYTES:
        raise ValueError("Generated narration exceeds the 25 MB clip limit.")
    with wave.open(str(file), "rb") as audio:
        duration = audio.getnframes() / audio.getframerate()
        if audio.getframerate() != SAMPLE_RATE or audio.getnchannels() != 1:
            raise ValueError("Invalid cached audio format.")
        if audio.getsampwidth() != 2 or not 0 < duration <= 600:
            raise ValueError("Narration must be between zero and 600 seconds.")
        if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
            raise ValueError("Cached audio is truncated.")
        return duration


def cached_clip(data_dir, text, voice, step_id):
    key = cache_key(text, voice)
    file = data_dir / "audio" / f"{key}.wav"
    if file.is_symlink():
        return None
    try:
        duration = audio_info(file)
    except (OSError, ValueError, wave.Error, EOFError):
        return None
    return {"stepId": step_id, "cacheKey": key, "durationSeconds": duration, "cached": True}


def runtime_status(data_dir):
    missing = [name for name in ("kokoro", "soundfile", "en_core_web_sm")
               if importlib.util.find_spec(name) is None]
    if missing:
        return {"available": False, "ready": False,
                "message": "Install the local speech engine with npm run setup:tts, then retry."}
    if importlib.metadata.version("kokoro") != "0.9.4":
        return {"available": False, "ready": False,
                "message": "Speech engine version differs. Run npm run setup:tts to restore it."}
    assets = ["config.json", "kokoro-v1_0.pth", *[f"voices/{voice}.pt" for voice in VOICES]]
    model_dir = data_dir / "models" / MODEL_REVISION
    ready = all((model_dir / name).is_file() and (model_dir / name).stat().st_size > 0
                for name in assets)
    return {"available": True, "ready": ready,
            "message": "Kokoro is ready. Speech stays on this device." if ready
            else "Download Kokoro once to generate narration locally."}


def prepare(data_dir):
    if not runtime_status(data_dir)["available"]:
        raise RuntimeError(runtime_status(data_dir)["message"])
    from huggingface_hub import hf_hub_download

    assets = ["config.json", "kokoro-v1_0.pth", *[f"voices/{voice}.pt" for voice in VOICES]]
    model_dir = data_dir / "models" / MODEL_REVISION
    for index, asset in enumerate(assets):
        emit({"type": "progress", "phase": "setup", "completed": index,
              "total": len(assets), "message": f"Downloading model assets ({index + 1}/{len(assets)})…"})
        hf_hub_download(repo_id=MODEL_REPO, filename=asset, revision=MODEL_REVISION,
                        local_dir=str(model_dir))
    emit({"type": "done", "status": runtime_status(data_dir)})


def generate(data_dir, request):
    voice = request.get("voice")
    steps = request.get("steps")
    if voice not in VOICES or not isinstance(steps, list) or not 1 <= len(steps) <= 200:
        raise ValueError("Invalid narration request.")
    total_text = 0
    seen = set()
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("id"), str) or not isinstance(step.get("text"), str):
            raise ValueError("Invalid narration step.")
        if step["id"] in seen or not 1 <= len(step["id"]) <= 100 or not 1 <= len(step["text"]) <= 10000:
            raise ValueError("Invalid narration step ID or text length.")
        if not normalize_text(step["text"]):
            raise ValueError("Narration is empty after normalization.")
        seen.add(step["id"])
        total_text += len(step["text"])
    if total_text > 200000:
        raise ValueError("Narration exceeds the 200,000 character job limit.")

    pipeline = None
    clips = []
    audio_dir = data_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for index, step in enumerate(steps):
        emit({"type": "progress", "phase": "generating", "completed": index,
              "total": len(steps), "message": f"Preparing narration {index + 1} of {len(steps)}…"})
        clip = cached_clip(data_dir, step["text"], voice, step["id"])
        if clip is None:
            if pipeline is None:
                status = runtime_status(data_dir)
                if not status["ready"]:
                    raise RuntimeError(status["message"])
                emit({"type": "progress", "phase": "loading", "completed": index,
                      "total": len(steps), "message": "Loading Kokoro on this device…"})
                import torch
                from kokoro import KModel, KPipeline
                torch.set_num_threads(min(4, os.cpu_count() or 1))
                model_dir = data_dir / "models" / MODEL_REVISION
                with contextlib.redirect_stdout(sys.stderr):
                    model = KModel(repo_id=MODEL_REPO, config=str(model_dir / "config.json"),
                                   model=str(model_dir / "kokoro-v1_0.pth")).to("cpu").eval()
                    pipeline = KPipeline(lang_code=voice[0], repo_id=MODEL_REPO, model=model)
                voice_file = str(model_dir / "voices" / f"{voice}.pt")
            import numpy as np
            import soundfile as sf
            chunks = []
            samples = 0
            with contextlib.redirect_stdout(sys.stderr):
                for _graphemes, _phonemes, audio in pipeline(normalize_text(step["text"]), voice=voice_file, speed=1):
                    if audio is None:
                        raise RuntimeError("Kokoro returned no audio for this text.")
                    chunk = audio.detach().cpu().numpy()
                    if not np.isfinite(chunk).all():
                        raise RuntimeError("Kokoro returned invalid audio samples.")
                    samples += len(chunk)
                    if samples > SAMPLE_RATE * 600:
                        raise ValueError("Narration exceeds the ten minute clip limit.")
                    chunks.append(chunk)
            if not chunks:
                raise RuntimeError("Kokoro returned no audio for this text.")
            key = cache_key(step["text"], voice)
            descriptor, temp_name = tempfile.mkstemp(prefix=".speech-", suffix=".wav", dir=audio_dir)
            os.close(descriptor)
            temp = Path(temp_name)
            try:
                sf.write(str(temp), np.concatenate(chunks), SAMPLE_RATE, subtype="PCM_16")
                duration = audio_info(temp)
                temp.replace(audio_dir / f"{key}.wav")
            finally:
                temp.unlink(missing_ok=True)
            clip = {"stepId": step["id"], "cacheKey": key, "durationSeconds": duration, "cached": False}
        clips.append(clip)
    emit({"type": "done", "clips": clips})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("Speech request is too large.")
    request = json.loads(raw)
    operation = request.get("operation")
    if operation != "prepare":
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HOME"] = str(args.data_dir / "huggingface")
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    if operation == "status":
        emit({"type": "done", "status": runtime_status(args.data_dir)})
    elif operation == "prepare":
        prepare(args.data_dir)
    elif operation == "generate":
        generate(args.data_dir, request)
    else:
        raise ValueError("Unknown speech operation.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Protocol errors are actionable; do not log lesson text or full tracebacks.
        emit({"type": "error", "message": str(error) or type(error).__name__})
        sys.exit(1)
