import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from backend import translator


class TranslationProviderTests(unittest.TestCase):
    @staticmethod
    def fake_get(url, proxy="", timeout=8):
        query = parse_qs(urlparse(url).query).get("q", [""])[0]
        if "mymemory" in url:
            data = {"responseData": {"translatedText": "Translated " + query}}
        elif "clients5.google.com" in url:
            data = [["Translated " + query]]
        else:
            data = [[ ["Translated " + query] ]]
        return json.dumps(data).encode("utf-8")

    def test_each_online_provider_is_selected(self):
        for engine in ("builtin-online", "online-google", "online-google-gtx", "online-mymemory"):
            with self.subTest(engine=engine), patch.object(translator, "_http_get_external", self.fake_get):
                result = translator.translate_prose("سلام", "en", {"engine": engine}, [])
                self.assertTrue(result["translation"])
                self.assertTrue(result["engine"].startswith("online:"))

    def test_explicit_target_fa_preserves_persian_spans_and_code(self):
        with patch.object(translator, "_http_get_external", self.fake_get):
            result = translator.translate_prose(
                "Welcome دنیا to `--fa on`.", "fa", {"engine": "online-google-gtx"}, []
            )
        self.assertIn("دنیا", result["translation"])
        self.assertIn("`--fa on`", result["translation"])

    def test_mode_resolution_keeps_online_provider_selectable(self):
        expected = {
            "builtin-online": "builtin-online",
            "online-google": "online-google",
            "online-google-gtx": "online-google-gtx",
            "online-mymemory": "online-mymemory",
        }
        for engine, provider in expected.items():
            with self.subTest(engine=engine):
                mode, resolved, _, _ = translator._resolve_mode({"engine": engine})
                self.assertEqual((mode, resolved), ("online", provider))

    def test_target_fa_does_not_retranslate_pure_persian(self):
        result = translator.translate_prose("سلام دنیا", "fa", {"engine": "online-google"}, [])
        self.assertEqual(result["translation"], "سلام دنیا")
        self.assertEqual(result["engine"], "already-target-language")


if __name__ == "__main__":
    unittest.main()
