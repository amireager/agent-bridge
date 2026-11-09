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
    const recent_requests_limit = Math.max(1, Math.min(100, Number($('sRecentLimit').value || 10)));
    const xray_limit = Math.max(1, Math.min(200, Number($('sXrayLimit').value || 40)));
    await api('/api/config', { ui: { theme, font_scale, sidebar_side, show_think, translate_thinking, show_tools, show_inline_tokens, show_shadow_cost, recent_requests_limit, xray_limit } });
  }

  async function saveModel() {
    await api('/api/config', { tap: {
      upstream_url: $('sUpstream').value.trim(),
      lab_enable_tools: $('sLabTools').checked,
      lab_system_prompt: $('sLabPrompt').value
    }});
  }

  async function clearData(kind) {
    const scopes = kind === 'telemetry' ? ['telemetry'] : (kind === 'sessions' ? ['lab'] : ['telemetry','lab','mirrors']);
    const days = Number($('cleanupDays')?.value ?? 7);
    const preview = await api('/api/cleanup/preview', { days, scopes });
    $('cleanupPreview').innerHTML = `در آستانه‌ی حذف: ${preview.telemetry_requests} درخواست آماری، ${preview.file_count} فایل، حدود ${(preview.bytes/1048576).toFixed(2)} MiB. تأیید نهایی لازم است.`;
    if (!confirm('این پاکسازی را اجرا کنم؟')) return;
    const result = await api('/api/cleanup/run', { days, scopes });
    $('cleanupPreview').textContent = `انجام شد: ${result.deleted_requests} درخواست، ${result.deleted_files} فایل؛ آزادسازی تقریبی ${(result.freed_bytes/1048576).toFixed(2)} MiB.`;
  }

  function selectedCleanupScopes() {
    return ['telemetry','lab','mirrors'].filter(x => $(`cleanup-${x}`).checked);
  }
  async function previewCleanup() {
    const scopes = selectedCleanupScopes();
    const result = await api('/api/cleanup/preview', { days:Number($('cleanupDays').value), scopes });
    $('cleanupPreview').innerHTML = `<strong>پیش‌نمایش حذف</strong><br>آمار درخواست‌ها: ${result.telemetry_requests}<br>فایل/سشن‌های هدف: ${result.file_count}<br>حجم قابل‌آزادسازی تقریبی: ${(result.bytes/1048576).toFixed(2)} MiB<br><small>${result.files.map(x=>esc(x.path)).join('<br>')}</small>`;
  }
  async function runSelectedCleanup() {
    const scopes = selectedCleanupScopes();
    if (!scopes.length) { alert('حداقل یک دسته را انتخاب کن.'); return; }
    await previewCleanup();
    if (!confirm('فقط موارد مطابق پیش‌نمایش و بازه‌ی زمانی انتخاب‌شده حذف شوند؟')) return;
    const result = await api('/api/cleanup/run', { days:Number($('cleanupDays').value), scopes });
    $('cleanupPreview').textContent = `انجام شد: ${result.deleted_requests} درخواست، ${result.deleted_files} فایل؛ حدود ${(result.freed_bytes/1048576).toFixed(2)} MiB.`;
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
        <div class="field-grid"><div class="fld"><label>تم سبک</label><select id="sTheme"><option value="openwebui-dark">Open WebUI · Slate</option><option value="mocha-dark">Catppuccin Mocha</option><option value="zed-dark">Zed Dark</option><option value="lobechat-dark">LobeChat Glass</option><option value="nord-dark">Nord</option><option value="forest-dark">Forest</option><option value="paper-light">Paper Light</option></select></div><div class="fld"><label>اندازه فونت</label><select id="sFont"><option value="compact">فشرده · 13px</option><option value="normal">معمولی · 14px</option><option value="large">خوانا · 15.5px</option><option value="xlarge">درشت · 17px</option><option value="xxlarge">خیلی درشت · 19px</option></select></div><div class="fld"><label>جایگاه سایدبار</label><select id="sSide"><option value="left">چپ</option><option value="right">راست</option></select></div></div>
        <div class="os-card" style="margin-top:18px">${[['sThink','نمایش Think',ui.show_think],['sTranslateThink','ترجمه Think',ui.translate_thinking],['sTools','نمایش ابزارها',ui.show_tools],['sTokens','نمایش آمار توکن',ui.show_inline_tokens],['sCost','نمایش هزینه سایه‌ای',ui.show_shadow_cost]].map(([id,label,val])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}<button class="help-pill" onclick="ABSettingsPage.toggleHelp('help-${id}')">؟ توضیح</button></div><label class="ui-switch"><input id="${id}" type="checkbox" ${val ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer" id="help-${id}">این گزینه فقط نحوه نمایش/ترجمه در رابط را کنترل می‌کند و موتور مدل را تغییر نمی‌دهد.</div></div>`).join('')}</div><div class="field-grid" style="margin-top:16px"><div class="fld"><label>تعداد درخواست‌های اخیر در Usage</label><input id="sRecentLimit" type="number" min="1" max="100" value="${ui.recent_requests_limit || 10}"></div><div class="fld"><label>سقف قاب‌های X-Ray در حافظه</label><input id="sXrayLimit" type="number" min="1" max="200" value="${ui.xray_limit || 40}"></div></div><button class="btn primary" style="margin-top:16px" onclick="ABSettingsPage.saveUI()">ذخیره</button></div></div>`;
      $('sTheme').value = ui.theme || 'openwebui-dark'; $('sFont').value = ui.font_scale || 'large'; $('sSide').value = ui.sidebar_side || 'left';
    } else if (route === 'set-tap') {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>مدل محلی و چت آزمایشی</h3></div><div class="fld"><label>llama-server upstream محلی</label><input id="sUpstream" value="${esc(tap.upstream_url)}" placeholder="http://127.0.0.1:8080"></div><div class="fld" style="margin-top:12px"><label>Workspace ایزوله‌ی Lab</label><input value="agent-team/ (فقط همین پوشه)" readonly></div><div class="os-row"><div class="os-row-top"><div class="os-title-wrap">فعال‌کردن ابزارهای فقط‌خواندنی agent-team</div><label class="ui-switch"><input id="sLabTools" type="checkbox" ${tap.lab_enable_tools ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer open">Lab در پوشه‌ی جداگانه‌ی agent-team کار می‌کند. فعلاً ابزارها فقط فهرست‌کردن و خواندن فایل‌های همان پوشه‌اند؛ shell، نوشتن فایل و دسترسی به ریشه‌ی ریپو عمداً غیرفعال است.</div></div><div class="fld" style="margin-top:12px"><label>System Prompt برای Lab</label><textarea id="sLabPrompt" rows="4">${esc(tap.lab_system_prompt || '')}</textarea></div><button class="btn primary" style="margin-top:15px" onclick="ABSettingsPage.saveModel()">ذخیره اتصال</button></div></div>`;
    } else {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>نگهداری و پاکسازی انتخابی داده</h3></div>
        <p>داده‌های runtime در <code>.data/</code> هستند. حجم فعلی: <strong>${state.storage?.total_kib || 0} KiB</strong> · ${state.storage?.file_count || 0} فایل.</p>
        <div class="field-grid"><div class="fld"><label>حفظ داده‌های چند روز اخیر (۰ = همه‌ی بازه)</label><input id="cleanupDays" type="number" min="0" max="3650" value="${c.retention.days || 7}"></div></div>
        <div class="os-card" style="margin-top:14px">${[['telemetry','آمار توکن و هزینه'],['lab','چت‌های Lab'],['mirrors','تاریخچه‌ی آینه‌های غیرفعال']].map(([id,label])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}</div><label class="ui-switch"><input id="cleanup-${id}" type="checkbox" checked><span class="ui-slider"></span></label></div></div>`).join('')}</div>
        <div class="field-grid" style="margin-top:14px"><button class="btn" onclick="ABSettingsPage.previewCleanup()">پیش‌نمایش: چه چیزی پاک می‌شود؟</button><button class="btn danger" onclick="ABSettingsPage.runSelectedCleanup()">حذف موارد انتخابی</button></div>
        <div id="cleanupPreview" class="os-help-drawer open" style="margin-top:12px">انتخاب‌ها و بازه را مشخص کن، پیش‌نمایش بگیر و بعد حذف را تأیید کن.</div>
        <details style="margin-top:16px"><summary>فهرست فایل‌های داده</summary><pre class="acc-body">${esc((state.storage?.files || []).map(f => `${f.path} · ${f.bytes} B`).join('\n'))}</pre></details></div></div>`;
    }
  }
  return { render, saveTranslation, testConnection, saveUI, saveModel, clearData, previewCleanup, runSelectedCleanup, toggleHelp, syncConditional };
})();
