import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import wave
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("sidecar", Path(__file__).parents[1] / "sidecar.py")
sidecar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sidecar)


def write_audio(file, rate=24000, channels=1):
    file.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(file), "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x01\x00" * rate * channels)


class SidecarTests(unittest.TestCase):
    def test_normalizes_code_identifiers_and_acronyms(self):
        self.assertEqual(sidecar.normalize_text("Call `createOrder` through the API and HTTPServer."),
                         "Call create Order through the A P I and H T T P Server.")
        self.assertEqual(sidecar.normalize_text("[save_order](https://example.com)\n now"), "save order now")

    def test_cache_identity_tracks_voice_revision_and_normalized_text(self):
        self.assertEqual(sidecar.cache_key("hello  world", "af_heart"),
                         sidecar.cache_key("hello world", "af_heart"))
        self.assertNotEqual(sidecar.cache_key("hello", "af_heart"), sidecar.cache_key("hello", "am_michael"))
        self.assertNotEqual(sidecar.cache_key("hello", "af_heart"), sidecar.cache_key("goodbye", "af_heart"))
        original = sidecar.cache_key("hello", "af_heart")
        with patch.object(sidecar, "MODEL_REVISION", "another-checkpoint"):
            self.assertNotEqual(original, sidecar.cache_key("hello", "af_heart"))
        with patch.object(sidecar, "RUNTIME_LOCK_HASH", "another-runtime"):
            self.assertNotEqual(original, sidecar.cache_key("hello", "af_heart"))

    def test_cached_generation_needs_no_model_and_measures_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            key = sidecar.cache_key("Hello", "af_heart")
            write_audio(root / "audio" / f"{key}.wav")
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                sidecar.generate(root, {"voice": "af_heart", "steps": [{"id": "intro", "text": "Hello"}]})
            event = json.loads(stdout.getvalue().splitlines()[-1])
            self.assertEqual(event["clips"], [{"stepId": "intro", "cacheKey": key,
                                              "durationSeconds": 1.0, "cached": True}])

    def test_corrupt_or_incompatible_cached_audio_is_not_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            key = sidecar.cache_key("Hello", "af_heart")
            file = root / "audio" / f"{key}.wav"
            write_audio(file, rate=8000)
            self.assertIsNone(sidecar.cached_clip(root, "Hello", "af_heart", "intro"))
            write_audio(file)
            file.write_bytes(file.read_bytes()[:50])
            self.assertIsNone(sidecar.cached_clip(root, "Hello", "af_heart", "intro"))

    def test_rejects_unknown_voices_empty_text_and_duplicate_steps(self):
        with tempfile.TemporaryDirectory() as temporary:
            for request in [
                {"voice": "../../file.pt", "steps": [{"id": "a", "text": "hello"}]},
                {"voice": "af_heart", "steps": [{"id": "a", "text": "   "}]},
                {"voice": "af_heart", "steps": [{"id": "a", "text": "hello"}] * 2},
            ]:
                with self.assertRaises(ValueError):
                    sidecar.generate(Path(temporary), request)


if __name__ == "__main__":
    unittest.main()
