// Lean OS-style settings: conditional Online Proxy / user-owned Offline endpoint, local-only model connection.
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;
  const $ = id => document.getElementById(id);
  const cfg = () => window.ABApp.getState().config;

  async function saveTranslation() {
    const isOnline = $('sEngine').value === 'builtin-online';
    await api('/api/config', { translation: {
      enabled: $('sEnabled').checked,
      engine: isOnline ? 'builtin-online' : 'custom-offline',
      proxy: isOnline ? $('sProxy').value.trim() : '',
      offline_protocol: $('sProtocol').value,
      offline_url: $('sOfflineUrl').value.trim(),
      offline_model: $('sOfflineModel').value.trim()
    }});
  }

  async function testConnection() {
    const out = $('sTestResult'); out.textContent = 'در حال تست...';
    const online = $('sEngine').value === 'builtin-online';
    const res = await api('/api/translate/ping', {
      engine: online ? 'builtin-online' : 'custom-offline',
      proxy: online ? $('sProxy').value.trim() : '',
      offline_protocol: $('sProtocol').value,
      offline_url: $('sOfflineUrl').value.trim(),
      offline_model: $('sOfflineModel').value.trim()
    });
    out.textContent = res.ok ? `اتصال موفق · ${res.latency_ms} ms · ${res.engine}${res.sample ? ` · ${res.sample}` : ''}` : `خطا · ${res.error}`;
    out.style.color = res.ok ? 'var(--phosphor)' : 'var(--red)';
  }

  async function saveUI() {
    const theme = $('sTheme').value;
    const font_scale = $('sFont').value;
    const sidebar_side = $('sSide').value;
    const show_think = $('sThink').checked;
    const translate_thinking = $('sTranslateThink').checked;
    const show_tools = $('sTools').checked;
    const show_inline_tokens = $('sTokens').checked;
    const show_shadow_cost = $('sCost').checked;
    await api('/api/config', { ui: { theme, font_scale, sidebar_side, show_think, translate_thinking, show_tools, show_inline_tokens, show_shadow_cost } });
  }

  async function saveModel() {
    await api('/api/config', { tap: {
      upstream_url: $('sUpstream').value.trim(),
      workdir: $('sWorkdir').value.trim(),
      lab_enable_tools: $('sLabTools').checked,
      lab_system_prompt: $('sLabPrompt').value
    }});
  }

  async function clearData(kind) {
    if (!confirm('واقعاً این داده‌ها پاک شوند؟')) return;
    if (kind === 'telemetry') await api('/api/telemetry/clear', {});
    if (kind === 'sessions') await api('/api/lab/delete-all', {});
    if (kind === 'all') { await api('/api/telemetry/clear', {}); await api('/api/lab/delete-all', {}); }
  }

  function toggleHelp(id) { $(id).classList.toggle('open'); }
  function syncConditional() {
    const online = $('sEngine').value === 'builtin-online';
    $('onlineFields').hidden = !online;
    $('offlineFields').hidden = online;
  }

  function render(host, state, route) {
    const c = state.config, tr = c.translation, ui = c.ui, tap = c.tap;
    if (route === 'set-translate') {
      host.innerHTML = `<div class="panel-wrap">
        <div class="panel rtl"><div class="panel-head"><h3>مترجم همه‌فن‌حریف · اتصال قابل‌تغییر</h3></div>
          <div class="os-row"><div class="os-row-top"><div class="os-title-wrap">ترجمه خودکار روشن باشد</div><label class="ui-switch"><input id="sEnabled" type="checkbox" ${tr.enabled !== false ? 'checked' : ''} onchange="ABSettingsPage.saveTranslation()"><span class="ui-slider"></span></label></div>
            <div class="os-help-drawer open" id="hEnabled">اگر خاموش باشد، Agent Bridge در مسیر OpenAI pass-through عمل می‌کند و متن را ترجمه نمی‌کند.</div></div>
          <div class="fld" style="margin-top:18px"><label>حالت ترجمه</label><select id="sEngine" onchange="ABSettingsPage.syncConditional()"><option value="builtin-online" ${tr.engine !== 'custom-offline' ? 'selected' : ''}>آنلاین داخلی</option><option value="custom-offline" ${tr.engine === 'custom-offline' ? 'selected' : ''}>آفلاین دلخواه من</option></select></div>
          <div id="onlineFields" class="os-card" style="margin-top:14px" ${tr.engine === 'custom-offline' ? 'hidden' : ''}><div class="os-card-head"><h3>اتصال آنلاین</h3></div><div class="os-row"><div class="fld"><label>Proxy (خالی = اتصال مستقیم)</label><input id="sProxy" value="${esc(tr.proxy || '')}" placeholder="socks5h://127.0.0.1:1080"></div><button class="btn" style="margin-top:12px" onclick="ABSettingsPage.testConnection()">تست اتصال و پروکسی</button></div></div>
          <div id="offlineFields" class="os-card" style="margin-top:14px" ${tr.engine !== 'custom-offline' ? 'hidden' : ''}><div class="os-card-head"><h3>API آفلاین دلخواه کاربر</h3></div><div class="os-row"><div class="field-grid"><div class="fld"><label>قرارداد API</label><select id="sProtocol"><option value="openai" ${(tr.offline_protocol || 'openai') === 'openai' ? 'selected' : ''}>OpenAI-compatible Chat Completions</option><option value="rest" ${tr.offline_protocol === 'rest' ? 'selected' : ''}>JSON REST · POST /translate</option></select></div><div class="fld"><label>URL پایه (پورت آزاد)</label><input id="sOfflineUrl" value="${esc(tr.offline_url || 'http://127.0.0.1:18095')}"></div><div class="fld"><label>نام مدل (برای OpenAI API)</label><input id="sOfflineModel" value="${esc(tr.offline_model || 'local-translator')}"></div></div><div class="os-help-drawer open">قرارداد OpenAI: <code>POST /v1/chat/completions</code> با <code>messages</code>؛ REST: <code>POST /translate</code> و JSON برابر <code>{"text":"...","from":"fa","to":"en"}</code>، پاسخ <code>{"translation":"..."}</code>. آدرس و پورت را خودت انتخاب کن.</div><button class="btn" style="margin-top:12px" onclick="ABSettingsPage.testConnection()">تست endpoint</button></div></div>
          <div id="sTestResult" class="mono" style="margin-top:14px"></div><button class="btn primary" style="margin-top:14px" onclick="ABSettingsPage.saveTranslation()">ذخیره تنظیمات مترجم</button>
        </div>
        <div class="panel rtl"><div class="panel-head"><h3>واژه‌نامه</h3></div><p class="muted">مدیریت واژه‌نامه‌ی موجود در بخش قبلی به‌زودی به این پنل سبک منتقل می‌شود؛ فایل داده در <code>.data/glossary.json</code> می‌ماند.</p></div>
      </div>`;
    } else if (route === 'set-hud') {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>ظاهر و نمایش</h3></div>
        <div class="field-grid"><div class="fld"><label>تم سبک</label><select id="sTheme"><option value="openwebui-dark">Open WebUI · Slate</option><option value="mocha-dark">Catppuccin Mocha</option><option value="zed-dark">Zed Dark</option><option value="lobechat-dark">LobeChat Glass</option></select></div><div class="fld"><label>اندازه فونت</label><select id="sFont"><option value="normal">معمولی</option><option value="large">خوانا · 15.5px</option><option value="xlarge">درشت</option></select></div><div class="fld"><label>جایگاه سایدبار</label><select id="sSide"><option value="left">چپ</option><option value="right">راست</option></select></div></div>
        <div class="os-card" style="margin-top:18px">${[['sThink','نمایش Think',ui.show_think],['sTranslateThink','ترجمه Think',ui.translate_thinking],['sTools','نمایش ابزارها',ui.show_tools],['sTokens','نمایش آمار توکن',ui.show_inline_tokens],['sCost','نمایش هزینه سایه‌ای',ui.show_shadow_cost]].map(([id,label,val])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}<button class="help-pill" onclick="ABSettingsPage.toggleHelp('help-${id}')">؟ توضیح</button></div><label class="ui-switch"><input id="${id}" type="checkbox" ${val ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer" id="help-${id}">این گزینه فقط نحوه نمایش/ترجمه در رابط را کنترل می‌کند و موتور مدل را تغییر نمی‌دهد.</div></div>`).join('')}</div><button class="btn primary" style="margin-top:16px" onclick="ABSettingsPage.saveUI()">ذخیره</button></div></div>`;
      $('sTheme').value = ui.theme || 'openwebui-dark'; $('sFont').value = ui.font_scale || 'large'; $('sSide').value = ui.sidebar_side || 'left';
    } else if (route === 'set-tap') {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>مدل محلی و چت آزمایشی</h3></div><div class="fld"><label>llama-server upstream محلی</label><input id="sUpstream" value="${esc(tap.upstream_url)}" placeholder="http://127.0.0.1:8080"></div><div class="fld" style="margin-top:12px"><label>دایرکتوری کاری ابزارهای Lab</label><input id="sWorkdir" value="${esc(tap.workdir || '.')}"></div><div class="os-row"><div class="os-row-top"><div class="os-title-wrap">فعال‌کردن ابزارهای محلی (shell/read/list)</div><label class="ui-switch"><input id="sLabTools" type="checkbox" ${tap.lab_enable_tools ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer open">ابزارها فقط در چت داخلی Lab فعال‌اند، نه آینه‌ی pi. دستورات در workdir اجرا می‌شوند؛ مدل محلیِ ناآزموده می‌تواند فرمان نامناسب بسازد—قبل از فعال‌سازی این ریسک را در نظر بگیر.</div></div><div class="fld" style="margin-top:12px"><label>System Prompt برای Lab</label><textarea id="sLabPrompt" rows="4">${esc(tap.lab_system_prompt || '')}</textarea></div><button class="btn primary" style="margin-top:15px" onclick="ABSettingsPage.saveModel()">ذخیره اتصال</button></div></div>`;
    } else {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>نگهداری و پاکسازی داده</h3></div><p>فایل‌های اجرایی و وضعیت فقط در <code>.data/</code> قرار دارند. حجم فعلی: <strong>${state.storage?.total_kib || 0} KiB</strong> · ${state.storage?.file_count || 0} فایل.</p><div class="field-grid"><button class="btn danger" onclick="ABSettingsPage.clearData('telemetry')">پاک‌کردن آمار توکن</button><button class="btn danger" onclick="ABSettingsPage.clearData('sessions')">پاک‌کردن نشست‌های Lab</button><button class="btn danger" onclick="ABSettingsPage.clearData('all')">پاک‌کردن آمار + نشست‌ها</button></div><details style="margin-top:16px"><summary>فهرست فایل‌های داده</summary><pre class="acc-body">${esc((state.storage?.files || []).map(f => `${f.path} · ${f.bytes} B`).join('\n'))}</pre></details></div></div>`;
    }
  }
  return { render, saveTranslation, testConnection, saveUI, saveModel, clearData, toggleHelp, syncConditional };
})();
