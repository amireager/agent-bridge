// Lean OS-style settings: conditional Online Proxy / user-owned Offline endpoint, local-only model connection.
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;
  const $ = id => document.getElementById(id);
  const cfg = () => window.ABApp.getState().config;

  function translationMode() { return $('sMode')?.value || 'online'; }
  function selectedTranslationEngine() {
    return translationMode() === 'online' ? ($('sEngine')?.value || 'builtin-online') : 'custom-offline';
  }
  function currentTranslationConfig() {
    const online = translationMode() === 'online';
    return {
      engine: selectedTranslationEngine(),
      proxy: online ? $('sProxy').value.trim() : '',
      offline_protocol: $('sProtocol').value,
      offline_url: $('sOfflineUrl').value.trim(),
      offline_model: $('sOfflineModel').value.trim()
    };
  }

  async function saveTranslation() {
    try {
      await api('/api/config', { translation: {
        enabled: $('sEnabled').checked,
        ...currentTranslationConfig()
      }});
      setTranslationStatus('تنظیمات ذخیره شد.', true);
    } catch (e) { setTranslationStatus(`ذخیره ناموفق · ${e.message}`, false); }
  }

  function setTranslationStatus(message, ok) {
    const out = $('sTestResult');
    out.textContent = message;
    out.style.color = ok ? 'var(--phosphor)' : 'var(--red)';
  }

  async function testConnection() {
    setTranslationStatus('در حال آزمودن اتصال و اجرای نمونه…', true);
    try {
      const res = await api('/api/translate/ping', currentTranslationConfig());
      setTranslationStatus(res.ok
        ? `اتصال و ترجمه موفق · ${res.latency_ms} ms · ${res.engine}\nنمونه: ${res.sample || 'پاسخ دریافت شد'}`
        : `آزمون ناموفق · ${res.error || 'پاسخی دریافت نشد'}`, !!res.ok);
    } catch (e) { setTranslationStatus(`خطا در آزمون اتصال · ${e.message}`, false); }
  }

  async function translateSettingsSample() {
    const source = $('sSampleInput').value.trim();
    if (!source) { $('sSampleOutput').textContent = 'ابتدا متن نمونه را وارد کن.'; return; }
    const output = $('sSampleOutput');
    output.textContent = 'در حال ترجمه…';
    const online = translationMode() === 'online';
    try {
      const res = await api('/api/translate', {
        text: source,
        to: $('sSampleTarget').value,
        engine_mode: online ? $('sEngine').value : 'offline',
        ...currentTranslationConfig()
      });
      output.innerHTML = res.error
        ? `<span class="translator-error">${esc(res.error)}</span>`
        : window.ABMarkdown.render(res.translation || 'ترجمه‌ای برنگشت.');
      $('sSampleMeta').textContent = res.error ? 'آزمون ترجمه ناموفق بود.' : `موتور: ${res.engine || 'نامشخص'} · ${res.elapsed_ms || 0} ms`;
    } catch (e) {
      output.textContent = `خطا در ترجمه · ${e.message}`;
      $('sSampleMeta').textContent = 'آزمون ترجمه ناموفق بود.';
    }
  }

  function addGlossaryRow(fa = '', en = '') {
    const list = $('glossaryRows');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'translator-glossary-row';
    row.innerHTML = `<input data-glossary-fa aria-label="اصطلاح فارسی" placeholder="اصطلاح فارسی" value="${esc(fa)}"><span aria-hidden="true">↔</span><input data-glossary-en aria-label="معادل انگلیسی" placeholder="معادل انگلیسی" value="${esc(en)}"><button class="btn ghost" type="button" aria-label="حذف اصطلاح" title="حذف" onclick="this.closest('.translator-glossary-row').remove()">×</button>`;
    list.appendChild(row);
  }

  async function saveGlossary() {
    const glossary = [...$('glossaryRows').querySelectorAll('.translator-glossary-row')]
      .map(row => ({ fa: row.querySelector('[data-glossary-fa]').value.trim(), en: row.querySelector('[data-glossary-en]').value.trim() }))
      .filter(item => item.fa && item.en);
    const status = $('glossaryStatus');
    try {
      await api('/api/glossary', { glossary });
      status.textContent = `واژه‌نامه ذخیره شد · ${glossary.length} جفت اصطلاح`;
      status.style.color = 'var(--phosphor)';
    } catch (e) {
      status.textContent = `ذخیره ناموفق · ${e.message}`;
      status.style.color = 'var(--red)';
    }
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

  async function testModelConnection() {
    const out = $('modelTestResult'); out.textContent = 'در حال بررسی upstream محلی…';
    const t0 = performance.now();
    try {
      const result = await api('/api/state');
      const ms = Math.round(performance.now() - t0);
      const up = result.upstream || {};
      out.textContent = up.online ? `متصل · ${up.detected_model} · context ${up.server_ctx || '?'} · ${ms}ms` : `وصل نیست · ${result.config.tap.upstream_url} · ${ms}ms`;
      out.style.color = up.online ? 'var(--phosphor)' : 'var(--red)';
    } catch (e) { out.textContent = `خطا: ${e.message}`; out.style.color = 'var(--red)'; }
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
    $('cleanupPreview').innerHTML = `<strong>پیش‌نمایش حذف</strong><br>آمار درخواست‌ها: ${result.telemetry_requests}<br>قاب‌های X-Ray: ${result.xray_frames || 0}<br>فایل/سشن‌های هدف: ${result.file_count}<br>حجم قابل‌آزادسازی تقریبی: ${(result.bytes/1048576).toFixed(2)} MiB<br><small>${result.files.map(x=>esc(x.path)).join('<br>')}</small>`;
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
    const online = translationMode() === 'online';
    $('onlineFields').hidden = !online;
    $('offlineFields').hidden = online;
    $('sProxy').disabled = !online;
    $('sEngine').disabled = !online;
  }

  function render(host, state, route) {
    const c = state.config, tr = c.translation, ui = c.ui, tap = c.tap;
    if (route === 'set-translate') {
      const online = tr.engine !== 'custom-offline';
      const engines = [
        ['builtin-online', 'آنلاین خودکار · Google و MyMemory به‌عنوان مسیرهای جایگزین'],
        ['online-google', 'Google · Chrome endpoint'],
        ['online-google-gtx', 'Google · GTX endpoint'],
        ['online-mymemory', 'MyMemory']
      ];
      const glossary = Array.isArray(state.glossary) ? state.glossary : [];
      host.innerHTML = `<div class="panel-wrap translator-settings">
        <section class="panel rtl">
          <div class="panel-head"><div><h3>مترجم و اتصال‌ها</h3><p class="muted">موتور ترجمه فقط برای متن‌های Bridge استفاده می‌شود؛ کد و بلوک‌های کد دست‌نخورده می‌مانند.</p></div></div>
          <div class="os-row"><div class="os-row-top"><div class="os-title-wrap">ترجمه خودکار روشن باشد</div><label class="ui-switch"><input id="sEnabled" type="checkbox" ${tr.enabled !== false ? 'checked' : ''} onchange="ABSettingsPage.saveTranslation()"><span class="ui-slider"></span></label></div><div class="os-help-drawer open">اگر خاموش باشد، متن بدون ترجمه از Bridge عبور می‌کند.</div></div>

          <div class="fld translator-mode-field"><label for="sMode">نوع اتصال</label><select id="sMode" onchange="ABSettingsPage.syncConditional()"><option value="online" ${online ? 'selected' : ''}>آنلاین</option><option value="offline" ${!online ? 'selected' : ''}>آفلاین · API دلخواه</option></select><small>ابتدا نوع اتصال را انتخاب کن؛ تنظیمات همان حالت در پنل پایین نمایش داده می‌شود.</small></div>

          <div id="onlineFields" class="os-card translator-engine-panel" ${!online ? 'hidden' : ''}>
            <div class="os-card-head"><div><h3>موتور آنلاین</h3><p>یک موتور مشخص کن یا حالت خودکار را برای امتحان مسیرهای جایگزین انتخاب کن.</p></div></div>
            <div class="fld"><label for="sEngine">موتور ترجمه</label><select id="sEngine">${engines.map(([id,label]) => `<option value="${id}" ${tr.engine === id || (id === 'builtin-online' && !engines.some(([candidate]) => candidate === tr.engine)) ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
            <div class="fld translator-proxy-field"><label for="sProxy">پروکسی (اختیاری)</label><input id="sProxy" value="${esc(tr.proxy || '')}" placeholder="http://127.0.0.1:8080"><small>خالی بگذار تا اتصال مستقیم استفاده شود.</small></div>
            <button class="btn" type="button" onclick="ABSettingsPage.testConnection()">تست موتور آنلاین</button>
          </div>

          <div id="offlineFields" class="os-card translator-engine-panel" ${online ? 'hidden' : ''}>
            <div class="os-card-head"><div><h3>اتصال موتور آفلاین</h3><p>Bridge به یک API محلی یا شبکهٔ خصوصی وصل می‌شود؛ خودش مدل یا کلید API نصب و ذخیره نمی‌کند.</p></div></div>
            <div class="field-grid"><div class="fld"><label for="sProtocol">قرارداد API</label><select id="sProtocol"><option value="openai" ${(tr.offline_protocol || 'openai') === 'openai' ? 'selected' : ''}>OpenAI-compatible · Chat Completions</option><option value="rest" ${tr.offline_protocol === 'rest' ? 'selected' : ''}>REST ساده · /translate</option></select></div><div class="fld"><label for="sOfflineUrl">URL پایه</label><input id="sOfflineUrl" value="${esc(tr.offline_url || 'http://127.0.0.1:18095')}" placeholder="http://127.0.0.1:18095"></div><div class="fld"><label for="sOfflineModel">نام مدل (OpenAI-compatible)</label><input id="sOfflineModel" value="${esc(tr.offline_model || 'local-translator')}" placeholder="نام مدل"></div></div>
            <details class="translator-api-guide"><summary>راهنمای اتصال و نمونهٔ اجرا</summary><div class="translator-guide-body">
              <h4>OpenAI-compatible</h4><p>برای سروری که مسیر Chat Completions را پیاده کرده (مثل سرویس محلی خودت)، URL پایه را وارد کن؛ Bridge درخواست را به <code>/v1/chat/completions</code> می‌فرستد. مسیر درخواست باید متن ترجمه را در پیام user دریافت کند و ترجمه را در <code>choices[0].message.content</code> برگرداند.</p>
              <pre><code>POST /v1/chat/completions
Content-Type: application/json

{"model":"local-translator","messages":[{"role":"user","content":"Translate to Persian: Hello"}],"temperature":0.1}</code></pre>
              <h4>REST ساده</h4><p>برای API کوچک اختصاصی، endpoint برابر <code>POST /translate</code> است و پاسخ باید JSON با کلید <code>translation</code> داشته باشد.</p>
              <pre><code>curl http://127.0.0.1:18095/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello","from":"en","to":"fa"}'

# response
{"translation":"سلام"}</code></pre>
              <p class="muted">آدرس loopback را برای مدل روی همان دستگاه نگه دار. API key در تنظیمات این Bridge پشتیبانی یا ذخیره نمی‌شود.</p>
            </div></details>
            <button class="btn" type="button" onclick="ABSettingsPage.testConnection()">تست API آفلاین</button>
          </div>

          <div id="sTestResult" class="translator-test-status" role="status" aria-live="polite"></div>
          <div class="translator-sample-wrap">
            <div class="translator-sample-head"><div><h3>آزمون ترجمه</h3><p>متن نمونه را ترجمه کن و ورودی و خروجی را کنار هم بررسی کن.</p></div><div class="fld"><label for="sSampleTarget">ترجمه به</label><select id="sSampleTarget"><option value="en">English</option><option value="fa">فارسی</option></select></div></div>
            <div class="translator-pair"><div class="translator-sample-pane"><label for="sSampleInput">متن ورودی</label><textarea id="sSampleInput" dir="rtl" rows="6">لطفاً وضعیت سرویس را بررسی کن؛ اگر فایل پیکربندی وجود ندارد، آن را نساز و فقط مسیر دقیق فایل موردنیاز را گزارش بده.</textarea></div><div class="translator-sample-pane"><label>ترجمهٔ خروجی</label><div id="sSampleOutput" class="translator-sample-output" dir="auto">خروجی ترجمه اینجا نمایش داده می‌شود.</div></div></div>
            <div class="translator-sample-actions"><span id="sSampleMeta" class="muted">نمونهٔ فارسی → انگلیسی · مسیرها و کد را هم می‌توانی امتحان کنی.</span><button class="btn primary" type="button" onclick="ABSettingsPage.translateSettingsSample()">ترجمهٔ نمونه</button></div>
          </div>
          <div class="translator-save-row"><button class="btn primary" type="button" onclick="ABSettingsPage.saveTranslation()">ذخیره تنظیمات مترجم</button></div>
        </section>

        <section class="panel rtl translator-glossary-panel">
          <div class="panel-head"><div><h3>واژه‌نامهٔ ترجمه</h3><p class="muted">برای ثابت ماندن معادل اصطلاحات پرتکرار فنی.</p></div></div>
          <div class="os-help-drawer open">وقتی پرامپت فارسی به انگلیسی ترجمه می‌شود، واژه‌نامه کمک می‌کند یک اصطلاح خاص همیشه با معادل انتخابی تو بیاید؛ مثلاً «حافظهٔ نهان» → <code>cache</code>. این کار برای نام محصول، اصطلاح داخلی یا عبارتی که مترجم معمولاً اشتباه می‌گیرد مفید است. واژه‌نامه جایگزین کد و backtick نیست و پاسخ مدل را خودکار تغییر نمی‌دهد.</div>
          <div id="glossaryRows" class="translator-glossary-rows">${glossary.map(item => `<div class="translator-glossary-row"><input data-glossary-fa aria-label="اصطلاح فارسی" placeholder="اصطلاح فارسی" value="${esc(item.fa || '')}"><span aria-hidden="true">↔</span><input data-glossary-en aria-label="معادل انگلیسی" placeholder="معادل انگلیسی" value="${esc(item.en || '')}"><button class="btn ghost" type="button" aria-label="حذف اصطلاح" title="حذف" onclick="this.closest('.translator-glossary-row').remove()">×</button></div>`).join('')}</div>
          <div class="translator-glossary-actions"><button class="btn" type="button" onclick="ABSettingsPage.addGlossaryRow()">افزودن واژه</button><button class="btn primary" type="button" onclick="ABSettingsPage.saveGlossary()">ذخیره واژه‌نامه</button></div><div id="glossaryStatus" class="muted" role="status"></div>
        </section>
      </div>`;
    } else if (route === 'set-hud') {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>ظاهر و نمایش</h3></div>
        <div class="field-grid"><div class="fld"><label>تم سبک</label><select id="sTheme"><option value="openwebui-dark">Open WebUI · Slate</option><option value="mocha-dark">Catppuccin Mocha</option><option value="zed-dark">Zed Dark</option><option value="lobechat-dark">LobeChat Glass</option><option value="nord-dark">Nord</option><option value="forest-dark">Forest</option><option value="paper-light">Paper Light</option></select></div><div class="fld"><label>اندازه فونت</label><select id="sFont"><option value="compact">فشرده · 13px</option><option value="normal">معمولی · 14px</option><option value="large">خوانا · 15.5px</option><option value="xlarge">درشت · 17px</option><option value="xxlarge">خیلی درشت · 19px</option></select></div><div class="fld"><label>جایگاه سایدبار</label><select id="sSide"><option value="left">چپ</option><option value="right">راست</option></select></div></div>
        <div class="os-card" style="margin-top:18px">${[['sThink','نمایش Think',ui.show_think],['sTranslateThink','ترجمه Think',ui.translate_thinking],['sTools','نمایش ابزارها',ui.show_tools],['sTokens','نمایش آمار توکن',ui.show_inline_tokens],['sCost','نمایش هزینه سایه‌ای',ui.show_shadow_cost]].map(([id,label,val])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}<button class="help-pill" onclick="ABSettingsPage.toggleHelp('help-${id}')">؟ توضیح</button></div><label class="ui-switch"><input id="${id}" type="checkbox" ${val ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer" id="help-${id}">این گزینه فقط نحوه نمایش/ترجمه در رابط را کنترل می‌کند و موتور مدل را تغییر نمی‌دهد.</div></div>`).join('')}</div><div class="field-grid" style="margin-top:16px"><div class="fld"><label>تعداد درخواست‌های اخیر در Usage</label><input id="sRecentLimit" type="number" min="1" max="100" value="${ui.recent_requests_limit || 10}"></div><div class="fld"><label>سقف قاب‌های X-Ray در حافظه</label><input id="sXrayLimit" type="number" min="1" max="200" value="${ui.xray_limit || 40}"></div></div><button class="btn primary" style="margin-top:16px" onclick="ABSettingsPage.saveUI()">ذخیره</button></div></div>`;
      $('sTheme').value = ui.theme || 'openwebui-dark'; $('sFont').value = ui.font_scale || 'large'; $('sSide').value = ui.sidebar_side || 'left';
    } else if (route === 'set-tap') {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>مدل محلی و چت آزمایشی</h3></div><div class="fld"><label>llama-server upstream محلی</label><input id="sUpstream" value="${esc(tap.upstream_url)}" placeholder="http://127.0.0.1:8080"></div><div class="fld" style="margin-top:12px"><label>Workspace ایزوله‌ی Lab</label><input value="agent-team/ (فقط همین پوشه)" readonly></div><div class="os-row"><div class="os-row-top"><div class="os-title-wrap">فعال‌کردن ابزارهای فقط‌خواندنی agent-team</div><label class="ui-switch"><input id="sLabTools" type="checkbox" ${tap.lab_enable_tools ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer open">Lab در پوشه‌ی جداگانه‌ی agent-team کار می‌کند. فعلاً ابزارها فقط فهرست‌کردن و خواندن فایل‌های همان پوشه‌اند؛ shell، نوشتن فایل و دسترسی به ریشه‌ی ریپو عمداً غیرفعال است.</div></div><div class="fld" style="margin-top:12px"><label>System Prompt برای Lab</label><textarea id="sLabPrompt" rows="4">${esc(tap.lab_system_prompt || '')}</textarea></div><div class="field-grid" style="margin-top:15px"><button class="btn" onclick="ABSettingsPage.testModelConnection()">تست اتصال مدل محلی</button><button class="btn primary" onclick="ABSettingsPage.saveModel()">ذخیره اتصال</button></div><div id="modelTestResult" class="mono" style="margin-top:10px"></div></div></div>`;
    } else {
      host.innerHTML = `<div class="panel-wrap"><div class="panel rtl"><div class="panel-head"><h3>نگهداری و پاکسازی انتخابی داده</h3></div>
        <p>داده‌های runtime در <code>.data/</code> هستند. حجم فعلی: <strong>${state.storage?.total_kib || 0} KiB</strong> · ${state.storage?.file_count || 0} فایل.</p>
        <div class="field-grid"><div class="fld"><label>حفظ داده‌های چند روز اخیر (۰ = همه‌ی بازه)</label><input id="cleanupDays" type="number" min="0" max="3650" value="${c.retention.days || 7}"></div></div>
        <div class="os-card" style="margin-top:14px">${[['telemetry','آمار توکن و هزینه'],['xray','بسته‌های X-Ray در حافظه'],['lab','چت‌های Lab'],['mirrors','تاریخچه‌ی آینه‌های غیرفعال']].map(([id,label])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}</div><label class="ui-switch"><input id="cleanup-${id}" type="checkbox" checked><span class="ui-slider"></span></label></div></div>`).join('')}</div>
        <div class="field-grid" style="margin-top:14px"><button class="btn" onclick="ABSettingsPage.previewCleanup()">پیش‌نمایش: چه چیزی پاک می‌شود؟</button><button class="btn danger" onclick="ABSettingsPage.runSelectedCleanup()">حذف موارد انتخابی</button></div>
        <div id="cleanupPreview" class="os-help-drawer open" style="margin-top:12px">انتخاب‌ها و بازه را مشخص کن، پیش‌نمایش بگیر و بعد حذف را تأیید کن.</div>
        <details style="margin-top:16px"><summary>فهرست فایل‌های داده</summary><pre class="acc-body">${esc((state.storage?.files || []).map(f => `${f.path} · ${f.bytes} B`).join('\n'))}</pre></details></div></div>`;
    }
  }
  return { render, saveTranslation, testConnection, translateSettingsSample, addGlossaryRow, saveGlossary, saveUI, saveModel, testModelConnection, clearData, previewCleanup, runSelectedCleanup, toggleHelp, syncConditional };
})();
