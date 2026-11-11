# نقشهٔ فعلی ماژول‌های Agent Bridge

این نقشه بر اساس کد فعلی است. پیش از تغییر هر قابلیت، مسیر و آزمون مرتبط را از همین جدول پیدا کن؛ `PROJECT_RULES.md` و `GOALS.md` مرجع تصمیم‌های جاری‌اند.

## مسیر اصلی درخواست

```text
CLIهای مستقل / رابط چت
       │
       ├─ cli.py ── PTY mirror یکتا برای هر نشست
       │
       └─ frontend ── backend/http_server.py
                           ├─ مسیر /v1 و provider مدل
                           ├─ مترجم و APIهای تنظیمات
                           └─ backend/agents.py ── نشست، Lab، وضعیت زنده
                                                └─ backend/store.py ── ./.data/
```

## فایل‌ها بر اساس موضوع

| موضوع | نقطهٔ ورود / فایل اصلی | آزمون یا بخش مرتبط |
|---|---|---|
| اجرای Bridge و سرور HTTP | `bridge.py`, `backend/http_server.py` | `tests/test_http_proxy_integration.py` |
| wrapper و نام‌گذاری یکتای عامل‌ها | `cli.py` | `tests/test_cli_wrapper.py`, `tests/test_mirror_history.py` |
| وضعیت عامل، PTY mirror، Lab و مسیرهای درحال‌اجرا | `backend/agents.py` | `tests/test_route_trace.py`, `tests/test_mirror_history.py` |
| پراکسی /v1، provider/model، خطای مقصد و telemetry | `backend/http_server.py` | `tests/test_http_proxy_integration.py`, `tests/test_usage_accuracy.py` |
| SQLite، migration، نگهداری و پاک‌سازی telemetry | `backend/store.py` | `tests/test_usage_accuracy.py`, `tests/test_cleanup.py` |
| انتخاب provider و خزانهٔ کلیدها | `backend/model_accounts.py` | `tests/test_model_accounts.py` و تنظیمات مدل |
| ترجمه و حفظ Markdown | `backend/translator.py` | `tests/test_translation.py`, `tests/test_chat_translation_modes.js` |
| صفحهٔ چت، ارسال و ترجمهٔ قابل‌بازبینی | `frontend/pages/chat/` | `tests/test_markdown_display.js`, `tests/test_chat_translation_modes.js` |
| داشبورد، نشست‌ها و audit درخواست‌ها | `frontend/pages/home/` | `tests/test_home_dashboard.js` |
| تنظیمات مدل، مترجم و ظاهر | `frontend/pages/settings/settings.js` | `tests/test_settings_render.js`, `tests/test_model_settings_render.js`, `tests/test_ui_settings_render.js` |
| آمار و نمایهٔ استفاده | `frontend/pages/usage/usage.js` | داده از `backend/store.py` و `backend/agents.py` |
| نقشه و معرفی رابط | `frontend/pages/about/` | `tests/test_about_page.js` |
| alias قدیمی برای اجرای Bridge | `step0_tap.py` | فقط به `bridge.py` ارجاع می‌دهد؛ مسیر مستقل آزمایشگاهی نیست |
| گالری نمونه‌های ظاهری | `docs/ui-patterns-gallery.html` | سند مرجع؛ بخشی از runtime نیست |
| فضای مستقل آیندهٔ agent-team | `agent-team/` | فعلاً فقط scaffold/راهنما؛ به storage یا import path هسته تبدیل نشود |
| یادداشت‌های طراحی اولیه | `archive/NOTES-early-design.md` | تاریخی و غیرمرجع؛ ادعاها/دستورها را دوباره بررسی کن |

## مرزهای مهم

- runtime، config، کلیدها، cache و تاریخچه فقط در `./.data/` قرار بگیرند.
- `agent-team/` از برنامه و PTYهای Bridge مستقل بماند؛ نبودنش نباید اجرای هسته را مختل کند.
- UI فقط وضعیت و مقصدی را نشان دهد که از state یا telemetry واقعی آمده؛ مجهول را حدس نزن.
- ترجمهٔ دستی متن اصلی را حذف یا خودکار ارسال نمی‌کند؛ تغییر این رفتار نیازمند تصمیم جدا است.
- تغییر رفتار wrapper، lifecycle نشست یا telemetry باید تست رفتاری همان حوزه را به‌روز کند.

## اجرای آزمون‌ها

```bash
python3 -m unittest discover -s tests -v
for f in tests/*.js; do node "$f" || exit 1; done
```

`py_compile` و `node --check` فقط بررسی syntax هستند و جای آزمون رفتاری را نمی‌گیرند.
