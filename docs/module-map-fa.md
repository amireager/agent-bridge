# نقشهٔ ماژول‌های Agent Bridge

این نقشه مشخص می‌کند برای هر رفتار، کدام فایل نقطهٔ ورود تغییر است. اصل تغییر: هر لایه مسئول یک مرز مشخص باشد؛ قابلیت جدید را در فایل‌های نامرتبط پخش نکنیم.

## جریان درخواست مدل

```text
عامل CLI / صفحهٔ چت
  → backend/http_server.py     مسیرهای HTTP، پروکسی /v1، SSE و اتصال payload به سرویس‌ها
  → backend/agents.py          وضعیت نشست، آینه‌های PTY، tool cycle، Lab و snapshot رابط
  → backend/engine.py          ارتباط با upstream مدل محلی و آمار درخواست
  → backend/store.py           فایل‌های runtime و SQLite در ./.data/
```

## محل تغییر بر اساس موضوع

| موضوع | فایل اصلی | فایل‌های مرتبط / آزمون |
|---|---|---|
| ترجمه، تشخیص زبان، حفظ Markdown و cache | `backend/translator.py` | `tests/test_translation.py`، تنظیمات در `frontend/pages/settings/settings.js` |
| انتخاب موتور online/offline و تست اتصال | `backend/translator.py`, `backend/http_server.py` | `frontend/pages/settings/settings.js`, `tests/test_translation.py` |
| فعالیت request و proxy `/v1` | `backend/http_server.py` | ثبت نشست در `backend/agents.py` |
| نشست‌های Lab و mirror، tool cycle و status | `backend/agents.py` | `tests/test_mirror_history.py` |
| ذخیره‌سازی و retention/cleanup | `backend/store.py` | routeها در `backend/http_server.py`، UI در settings |
| نمایش چت، Think، ترجمهٔ انتخابی، tool card | `frontend/pages/chat/chat.js` | استایل در `frontend/pages/chat/chat.css` |
| تنظیمات و cleanup dialogs | `frontend/pages/settings/settings.js` | API cleanup در `backend/http_server.py` و `backend/store.py` |
| نمودارها و usage | `frontend/pages/usage/usage.js` | داده از `backend/agents.py` و `backend/store.py` |
| launcher و سیگنال‌های CLI | `bridge.py`, `cli.py` | راهنمای NixOS در `README.fa.md` |
| گام آزمایش مستقل | `step0_tap.py`, `agent-team/` | مستقل از مسیرهای runtime؛ `agent-team/` را وارد تنظیمات/دادهٔ Bridge نکن |

## قواعد مرزی

- فایل‌های runtime، config، cache و نشست‌ها فقط زیر `./.data/` هستند؛ هیچ‌یک از آن‌ها را commit نکن.
- `agent-team/` workspace آزمایشی جدا است و نباید به‌عنوان storage یا import path داخلی Bridge استفاده شود.
- منطق provider ترجمه را در توابع/شاخه‌های ترجمه نگه‌دار؛ UI فقط شناسهٔ موتور را بفرستد و backend مرجع نهایی resolve باشد.
- تغییر رفتار session باید آزمون‌های `tests/test_mirror_history.py` را به‌روز کند؛ ترجمه باید آزمون‌های `tests/test_translation.py` را به‌روز کند.
- آزمون‌های واحد شبکه را mock می‌کنند؛ آن‌ها جایگزین اجرای واقعی llama-server نیستند.

## اجرای آزمون‌ها

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile backend/*.py
node --check frontend/pages/chat/chat.js
node --check frontend/pages/settings/settings.js
```
