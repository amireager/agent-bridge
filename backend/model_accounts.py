"""Local model-provider accounts, secret vault, and live model catalog discovery."""
from __future__ import annotations

import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PROVIDERS = {
    "opencode-zen": {
        "name": "OpenCode Console / Zen", "base_url": "https://opencode.ai/inference/openai/v1",
        "models_url": "https://opencode.ai/inference/v1/models", "format": "openai",
        "docs": "https://opencode.ai/docs/console/harnesses", "free_note": "کلید Console؛ مدل‌های رایگان فقط داخل OpenCode کار می‌کنند. برای Bridge از مدل پولی یا Go استفاده کن.",
    },
    "openrouter": {
        "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
        "models_url": "https://openrouter.ai/api/v1/models", "format": "openai",
        "docs": "https://openrouter.ai/docs/quickstart", "free_note": "مدل‌های رایگان و سهمیه تغییرپذیرند.",
    },
    "groq": {
        "name": "Groq", "base_url": "https://api.groq.com/openai/v1",
        "models_url": "https://api.groq.com/openai/v1/models", "format": "openai",
        "docs": "https://console.groq.com/docs/models", "free_note": "محدودیت هر مدل/حساب را در حساب ارائه‌دهنده بررسی کن.",
    },
    "google-gemini": {
        "name": "Google AI Studio · Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models", "format": "openai", "catalog_format": "gemini", "catalog_auth": "x-goog-api-key",
        "docs": "https://ai.google.dev/gemini-api/docs/pricing", "free_note": "سهمیه و شرایط Free tier مدل‌به‌مدل فرق دارد؛ دادهٔ رایگان ممکن است برای بهبود سرویس استفاده شود.",
    },
    "cerebras": {
        "name": "Cerebras Inference", "base_url": "https://api.cerebras.ai/v1",
        "models_url": "https://api.cerebras.ai/v1/models", "format": "openai",
        "docs": "https://inference-docs.cerebras.ai/", "free_note": "Free Trial credits موقتی و مشروط به احراز روش پرداخت است؛ سهمیه را از حساب بررسی کن.",
    },
    "nvidia-nim": {
        "name": "NVIDIA NIM", "base_url": "https://integrate.api.nvidia.com/v1",
        "models_url": "https://integrate.api.nvidia.com/v1/models", "format": "openai",
        "docs": "https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html", "free_note": "دسترسی/سهمیه به حساب و مدل وابسته است.",
    },
    "custom-openai": {
        "name": "Aggregator دلخواه · OpenAI-compatible", "base_url": "",
        "models_url": "", "format": "openai", "docs": "", "free_note": "رایگان‌بودن و سیاست داده را ارائه‌دهنده تعیین می‌کند.",
    },
}


class ModelAccountVault:
    """Credentials live only in .data; secrets are never returned by public_state."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.plain_path = data_dir / "model_accounts.json"
        self.enc_path = data_dir / "model_accounts.enc"
        self.accounts: list[dict] = []
        self._encryption_key: bytes | None = None
        self._salt: bytes | None = None
        self.encryption_enabled = self.enc_path.exists()
        self.locked = self.encryption_enabled
        if not self.encryption_enabled and self.plain_path.exists():
            self.accounts = self._read_plain()
            if self._migrate_provider_endpoints():
                self._write_plain()

    def _migrate_provider_endpoints(self) -> bool:
        changed = False
        for account in self.accounts:
            if account.get("provider") != "opencode-zen":
                continue
            if account.get("base_url", "").rstrip("/") == "https://opencode.ai/zen/v1":
                account["base_url"] = PROVIDERS["opencode-zen"]["base_url"]
                changed = True
            if account.get("models_url", "").rstrip("/") == "https://opencode.ai/zen/v1/models":
                account["models_url"] = PROVIDERS["opencode-zen"]["models_url"]
                changed = True
        return changed

    @staticmethod
    def _crypto():
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
            return AESGCM, Scrypt
        except ImportError as exc:
            raise RuntimeError("برای رمزگذاری اختیاری، cryptography را نصب کن: python3 -m pip install -r requirements-crypto.txt") from exc

    @classmethod
    def _derive(cls, passphrase: str, salt: bytes) -> bytes:
        _, Scrypt = cls._crypto()
        return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode("utf-8"))

    def _read_plain(self) -> list[dict]:
        try:
            value = json.loads(self.plain_path.read_text(encoding="utf-8"))
            return value if isinstance(value, list) else []
        except Exception:
            return []

    def public_state(self) -> dict:
        accounts = [] if self.locked else [
            {k: v for k, v in item.items() if k not in ("api_key", "proxy", "models_url")} | {"has_key": bool(item.get("api_key")), "has_proxy": bool(item.get("proxy")), "has_models_url": bool(item.get("models_url"))}
            for item in self.accounts
        ]
        return {"locked": self.locked, "encryption_enabled": self.encryption_enabled, "accounts": accounts}

    def unlock(self, passphrase: str) -> None:
        if not self.encryption_enabled:
            self.locked = False
            return
        if not passphrase:
            raise ValueError("رمز اصلی را وارد کن.")
        AESGCM, _ = self._crypto()
        envelope = json.loads(self.enc_path.read_text(encoding="utf-8"))
        salt, nonce = base64.b64decode(envelope["salt"]), base64.b64decode(envelope["nonce"])
        key = self._derive(passphrase, salt)
        try:
            clear = AESGCM(key).decrypt(nonce, base64.b64decode(envelope["ciphertext"]), b"agent-bridge-model-accounts-v1")
            accounts = json.loads(clear.decode("utf-8"))
        except Exception as exc:
            raise ValueError("رمز اصلی نادرست است یا فایل کلیدها آسیب دیده.") from exc
        if not isinstance(accounts, list):
            raise ValueError("ساختار فایل کلیدها معتبر نیست.")
        self.accounts, self._encryption_key, self._salt = accounts, key, salt
        self.locked = False
        if self._migrate_provider_endpoints():
            self._persist_encrypted()

    def _persist_encrypted(self) -> None:
        if not self._encryption_key or not self._salt:
            raise PermissionError("خزانهٔ رمز‌شده قفل است.")
        AESGCM, _ = self._crypto()
        nonce = secrets.token_bytes(12)
        clear = json.dumps(self.accounts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ciphertext = AESGCM(self._encryption_key).encrypt(nonce, clear, b"agent-bridge-model-accounts-v1")
        envelope = {"version": 1, "kdf": "scrypt", "salt": base64.b64encode(self._salt).decode(),
                    "nonce": base64.b64encode(nonce).decode(), "ciphertext": base64.b64encode(ciphertext).decode()}
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.enc_path.write_text(json.dumps(envelope), encoding="utf-8")
        os.chmod(self.enc_path, 0o600)

    def enable_encryption(self, passphrase: str) -> None:
        if not passphrase:
            raise ValueError("رمز اصلی خالی نمی‌تواند باشد.")
        self._salt = secrets.token_bytes(16)
        self._encryption_key = self._derive(passphrase, self._salt)
        self.encryption_enabled = True
        self.locked = False
        self._persist_encrypted()
        self.plain_path.unlink(missing_ok=True)

    def disable_encryption(self, passphrase: str) -> None:
        if self.encryption_enabled and self.locked:
            self.unlock(passphrase)
        if self.encryption_enabled:
            self.enc_path.unlink(missing_ok=True)
        self.encryption_enabled, self.locked = False, False
        self._encryption_key, self._salt = None, None
        self._write_plain()

    def lock(self) -> None:
        if self.encryption_enabled:
            self.accounts = []
            self._encryption_key, self._salt = None, None
            self.locked = True

    def _write_plain(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.plain_path.write_text(json.dumps(self.accounts, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(self.plain_path, 0o600)

    def save_account(self, account: dict) -> dict:
        if self.locked:
            raise PermissionError("ابتدا خزانهٔ کلیدها را باز کن.")
        provider_id = str(account.get("provider", ""))
        if provider_id not in PROVIDERS:
            raise ValueError("ارائه‌دهندهٔ ناشناخته است.")
        base_url = str(account.get("base_url", "")).strip()
        parsed_base = urllib.parse.urlparse(base_url)
        if parsed_base.scheme not in ("http", "https") or not parsed_base.hostname or parsed_base.username or parsed_base.password or parsed_base.query or parsed_base.fragment:
            raise ValueError("Base URL معتبر http(s) باشد و اطلاعات ورود را داخل URL نگذار.")
        account_id = str(account.get("id") or secrets.token_hex(8))
        index = next((i for i, item in enumerate(self.accounts) if item.get("id") == account_id), None)
        previous = self.accounts[index] if index is not None else {}
        record = {"id": account_id, "provider": provider_id, "label": str(account.get("label") or "حساب جدید")[:64],
                  "base_url": base_url[:500], "models_url": str(account.get("models_url", "")).strip()[:500] or previous.get("models_url", ""),
                  "api_key": str(account.get("api_key", "")), "proxy": str(account.get("proxy", "")).strip()[:500] or previous.get("proxy", ""),
                  "enabled": bool(account.get("enabled", previous.get("enabled", True)))}
        if index is None:
            self.accounts.append(record)
        else:
            if not record["api_key"]:
                record["api_key"] = self.accounts[index].get("api_key", "")
            self.accounts[index] = record
        if self.encryption_enabled:
            self._persist_encrypted()
        else:
            self._write_plain()
        return {k: v for k, v in record.items() if k not in ("api_key", "proxy", "models_url")} | {"has_key": bool(record["api_key"]), "has_proxy": bool(record.get("proxy")), "has_models_url": bool(record.get("models_url"))}

    def delete_account(self, account_id: str) -> None:
        if self.locked:
            raise PermissionError("ابتدا خزانهٔ کلیدها را باز کن.")
        self.accounts = [item for item in self.accounts if item.get("id") != account_id]
        if self.encryption_enabled:
            self._persist_encrypted()
        else:
            self._write_plain()


def discover_models(account: dict, timeout: float = 8.0) -> list[dict]:
    """Fetch catalog data from the provider's models endpoint; sends no prompt."""
    provider = PROVIDERS.get(account.get("provider"), PROVIDERS["custom-openai"])
    url = str(account.get("models_url") or provider.get("models_url") or "").strip()
    base = str(account.get("base_url", "")).rstrip("/")
    if not url:
        url = base + "/models" if base.endswith("/v1") else base + "/v1/models"
    if not url.startswith(("https://", "http://")):
        raise ValueError("Models URL باید با http:// یا https:// شروع شود.")
    headers = {"Accept": "application/json"}
    key = str(account.get("api_key", ""))
    if key:
        auth_header = provider.get("catalog_auth", "Authorization")
        headers[auth_header] = key if auth_header != "Authorization" else f"Bearer {key}"
    req = urllib.request.Request(url, headers=headers)
    proxy = str(account.get("proxy", "")).strip()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:800]
        if key:
            body = body.replace(key, "[کلید مخفی شد]")
        raise RuntimeError(f"مدل‌ها دریافت نشدند (HTTP {exc.code}): {body}") from exc
    if provider.get("catalog_format") == "gemini":
        raw = payload.get("models", [])
        models = [{"id": item.get("name", "").removeprefix("models/"), "name": item.get("displayName", item.get("name", "")),
                   "tools": "generateContent" in item.get("supportedGenerationMethods", []), "source": "catalog"}
                  for item in raw if item.get("name")]
    else:
        raw = payload.get("data", payload.get("models", []))
        if isinstance(raw, dict):
            raw = list(raw.values())
        models = []
        for item in raw:
            if not isinstance(item, dict) or not (item.get("id") or item.get("name")):
                continue
            pricing = item.get("pricing") or {}
            free = None
            if "prompt" in pricing and "completion" in pricing:
                try: free = float(pricing["prompt"]) == 0 and float(pricing["completion"]) == 0
                except (TypeError, ValueError): free = None
            models.append({"id": item.get("id") or item.get("name", ""), "name": item.get("name") or item.get("id", ""),
                           "tools": item.get("supports_tool_calls", item.get("tool_call", None)), "free": free,
                           "context_length": item.get("context_length"), "source": "catalog"})
    return models


def test_model(account: dict, model_id: str, prompt: str = "Reply exactly with: OK", timeout: float = 25.0) -> dict:
    """Make a minimal generation test and redact provider credentials from all errors."""
    provider = PROVIDERS.get(account.get("provider"), PROVIDERS["custom-openai"])
    base, key = str(account.get("base_url", "")).rstrip("/"), str(account.get("api_key", ""))
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    endpoint = base + ("/chat/completions" if base.endswith("/v1") else "/v1/chat/completions")
    body = {"model": model_id, "messages": [{"role": "user", "content": prompt}], "max_tokens": 32, "temperature": 0, "stream": False}
    proxy = str(account.get("proxy", "")).strip()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
    req = urllib.request.Request(endpoint, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    started = time.perf_counter()
    try:
        with opener.open(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = str(payload.get("choices", [{}])[0].get("message", {}).get("content", ""))
        if not text.strip():
            raise RuntimeError("پاسخ مدل خالی بود.")
        if key:
            text = text.replace(key, "[کلید مخفی شد]")
        return {"ok": True, "model": model_id, "elapsed_ms": round((time.perf_counter()-started)*1000, 1), "sample": text[:500]}
    except Exception as exc:
        message = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            message = exc.read().decode("utf-8", errors="replace")[:800]
            message = f"HTTP {exc.code}: {message}"
        if key:
            message = message.replace(key, "[کلید مخفی شد]")
        return {"ok": False, "model": model_id, "elapsed_ms": round((time.perf_counter()-started)*1000, 1), "error": message}
