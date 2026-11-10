import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.model_accounts import ModelAccountVault, discover_models


class ModelAccountVaultTests(unittest.TestCase):
    def test_plain_accounts_are_private_and_public_state_redacts_key(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = ModelAccountVault(Path(temp))
            vault.save_account({"provider": "openrouter", "label": "work", "base_url": "https://example/v1", "api_key": "fresh-secret"})
            self.assertEqual(os.stat(vault.plain_path).st_mode & 0o777, 0o600)
            self.assertNotIn("fresh-secret", json.dumps(vault.public_state()))

    def test_optional_encryption_locks_at_restart_and_rejects_wrong_passphrase(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = ModelAccountVault(Path(temp))
            vault.save_account({"provider": "openrouter", "base_url": "https://example/v1", "api_key": "fresh-secret"})
            vault.enable_encryption("test-passphrase")
            self.assertFalse(vault.plain_path.exists())
            raw = vault.enc_path.read_text()
            self.assertNotIn("fresh-secret", raw)
            vault.lock()
            reopened = ModelAccountVault(Path(temp))
            self.assertTrue(reopened.locked)
            with self.assertRaises(ValueError):
                reopened.unlock("wrong")
            reopened.unlock("test-passphrase")
            self.assertEqual(reopened.accounts[0]["api_key"], "fresh-secret")

    def test_legacy_opencode_zen_endpoints_migrate_to_console_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "model_accounts.json"
            path.write_text(json.dumps([{"id": "old", "provider": "opencode-zen", "base_url": "https://opencode.ai/zen/v1", "models_url": "https://opencode.ai/zen/v1/models", "api_key": "stored"}]))
            vault = ModelAccountVault(Path(tmp))
            self.assertEqual(vault.accounts[0]["base_url"], "https://opencode.ai/inference/openai/v1")
            self.assertEqual(vault.accounts[0]["models_url"], "https://opencode.ai/inference/v1/models")
            self.assertEqual(json.loads(path.read_text())[0]["api_key"], "stored")

    def test_edit_keeps_stored_key_and_proxy_when_fields_are_blank(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = ModelAccountVault(Path(tmp))
            saved = vault.save_account({"provider": "custom-openai", "label": "first", "base_url": "https://example.test/v1", "api_key": "secret", "proxy": "http://127.0.0.1:9000"})
            edited = vault.save_account({"id": saved["id"], "provider": "custom-openai", "label": "renamed", "base_url": "https://example.test/v1"})
            self.assertEqual(vault.accounts[0]["api_key"], "secret")
            self.assertEqual(vault.accounts[0]["proxy"], "http://127.0.0.1:9000")
            self.assertNotIn("secret", json.dumps(edited))

    def test_opencode_console_catalog_uses_current_endpoint_and_bearer_auth(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self): return b'{"data":[{"id":"paid-model","name":"Paid Model"}]}'
        with patch("backend.model_accounts.urllib.request.build_opener") as build:
            build.return_value.open.return_value = Response()
            models = discover_models({"provider": "opencode-zen", "base_url": "https://opencode.ai/inference/openai/v1", "api_key": "oc_sk_test"})
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://opencode.ai/inference/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer oc_sk_test")
        self.assertEqual(models[0]["id"], "paid-model")

    def test_openai_compatible_catalog_is_discovered(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self): return b'{"data":[{"id":"one","name":"Model One"}]}'
        with patch("backend.model_accounts.urllib.request.build_opener") as build:
            build.return_value.open.return_value = Response()
            models = discover_models({"provider": "openrouter", "base_url": "https://host/v1", "api_key": "secret"})
        self.assertEqual(models[0]["id"], "one")
        self.assertEqual(models[0]["name"], "Model One")


if __name__ == "__main__":
    unittest.main()
