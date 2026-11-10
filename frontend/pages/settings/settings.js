// Lean OS-style settings: conditional Online Proxy / user-owned Offline endpoint, local-only model connection.
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;
  const $ = id => document.getElementById(id);
  const cfg = () => window.ABApp.getState().config;
  let modelAccountsCache = [];
  let uiPreviewActive = false;
  let cleanupTab = 'history';
  let cleanupUi = { query: '', kind: 'all', sort: 'recent', days: null, scopes: { telemetry: true, lab: true, mirrors: true, xray: false } };
  let cleanupState = null;
  let cleanupPreviewData = null;
  let cleanupPreviewKey = '';
  let pendingHistoryDelete = null;
  let translationTestNotice = '';
  let translationTestOk = false;
  let cleanupNotice = '';
  let historyNotice = '';
  const PREVIEW_IMAGE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAIAAAC3LQuFAAACDElEQVR42u3Q20qUYRTG8ec+OugWPO3QOyiUZMJQjCJRisIoFAclSQrD3WFbw/ZUVqRlYbmhss3JqKPO3plRL6M+ecMGnXd94xq+9cHLgt8wBwPr/c+Do7diioBjt2OKgLo7MUVA/d0lRcDxe0uKgIb7y4qAyNiyIuDEgxVFQOP4ikv+5Ib3q+YgTj6MO6PsOgb7Jpoexd1ArGPwzqL58aobfAfinUXLk1U3+A7EO4tTT9fc4DsQ7yxOP1tzg+9AvLM483zdDb4D8c7i7It1N/gOxDuL1pcJZxDrsG+i7VXCJWXXqeYg2icSioBzr5OKgPNvkoqAC29TioCL71KKgI7JtCLg0lRaEXD5fUYRcOVDRhHQOZ1VBHR9zIboSGu0VLgxZfPQ/SkXlj3reEKMseUhOpMLxf51jLB6bG3o+bwhz7aOEUqSLQ+9Xzbk0QOFkmRrw9XZvCR6ml3CVUQh+ubykiocSLiKyMO1+bykCgfyCIfZ8tC/UBBT+TqGZJstD9e/FsQcdCDJNlsebnwryjjoOh6xNiIPA9+LAhjrGDJ5RCFuLm4Gjb2ORyCPLoT3GfyxGZxq1jECzfON3Blo6OdWcA7XRnbxBgo0z2NeKe0sTYX5Gvm1FYQ9r7I3CijPFlma+m+g0d/bDMRf8n61PcybiVdIIwr/D3SoplYRdCAdSAfSgXQgHUgHctZfi0XGmvcO0XcAAAAASUVORK5CYII=';
  const UI_DEFAULTS = { theme: 'openwebui-dark', font_scale: 'large', sidebar_side: 'left', show_think: true, think_default_mode: 'half', box_style: 'outlined', think_style: 'violet', tool_style: 'cards', translation_style: 'accent', markdown_style: 'reader', chat_mode: 'interleaved', paragraph_spacing: 'comfortable', image_mode: 'click', image_size: 'large', code_wrap: 'scroll', code_theme: 'midnight', show_code_lines: false, tool_output_mode: 'terminal', translate_thinking: false, show_tools: true, show_inline_tokens: true, show_shadow_cost: true, recent_requests_limit: 10, xray_limit: 40 };

  function renderDisplayPreview() {
    const markdownHost = $('uiMarkdownPreview');
    if (markdownHost && window.ABMarkdown) {
      const blocks = [
        { type: 'prose', en: '## The original paragraph stays intact.\nA second line shows readable paragraph flow.', fa: '## پاراگراف اصلی دست‌نخورده می‌ماند.\nخط دوم جریان خواندن را نشان می‌دهد.' },
        { type: 'prose', en: '| Route | State |\n|:--|--:|\n| Local | Ready |', fa: '| مسیر | وضعیت |\n|:--|--:|\n| محلی | آماده |' },
        { type: 'code', raw: '```js\nconst answer = 42;\n```' }
      ];
      markdownHost.innerHTML = window.ABMarkdown.renderBlocks(blocks, 'The original paragraph stays intact.\n\nA second paragraph demonstrates spacing and alignment.', 'پاراگراف اصلی دست‌نخورده می‌ماند.\n\nپاراگراف دوم فاصله و چیدمان را نشان می‌دهد.', $('sChatMode')?.value || UI_DEFAULTS.chat_mode);
    }
    const thinkHost = $('uiThinkPreview');
    if (thinkHost) {
      const mode = $('sThinkDefault')?.value || UI_DEFAULTS.think_default_mode;
      thinkHost.open = mode !== 'closed';
      thinkHost.dataset.mode = mode;
      thinkHost.hidden = !$('sThink')?.checked;
      const translation = $('uiThinkTranslation');
      if (translation) translation.hidden = !$('sTranslateThink')?.checked;
    }
    const toolHost = $('uiToolPreview');
    if (toolHost) {
      toolHost.hidden = !$('sTools')?.checked;
      const outputMode = $('sToolOutputMode')?.value || UI_DEFAULTS.tool_output_mode;
      const head = '<summary><span class="tool-badge">shell</span><span class="tool-cmd-preview">$ check --status</span><span class="tiny-tag">done</span></summary>';
      toolHost.innerHTML = outputMode === 'markdown'
        ? `<details class="tool-pill kind-shell" open>${head}<div class="tool-readable-content"><details class="tool-args" open><summary>ورودی ابزار</summary><pre>{"command":"check --status"}</pre></details><div class="tool-markdown-output">${window.ABMarkdown?.render(`Service is ready.\n\n- First check\n- Second check\n\n![نمونهٔ امن محلی](${PREVIEW_IMAGE_URL})`) || 'Service is ready.'}</div></div></details>`
        : outputMode === 'plain'
          ? `<details class="tool-pill kind-shell" open>${head}<div class="tool-readable-content tool-plain-output"><p>Service is ready.</p><p>• First check passed</p><p>• Second check passed</p></div></details>`
          : outputMode === 'json'
            ? `<details class="tool-pill kind-shell" open>${head}<div class="tool-readable-content"><details class="tool-args" open><summary>ورودی ساخت‌یافتهٔ ابزار</summary><pre>{"command": "check --status"}</pre></details><pre class="tool-plain-body">{"status": "ready", "checks": 2}</pre></div></details>`
            : `<details class="tool-pill kind-shell" open>${head}<div class="tool-render"><div class="terminal-view"><div class="terminal-chrome"><i></i><i></i><i></i><span>نمونه خروجی</span></div><div class="terminal-content"><div class="term-line"><span class="term-ln">1</span><code>service ready ✓</code></div></div></div></div></details>`;
    }
    const meta = $('uiPreviewMeta');
    if (meta) meta.innerHTML = [ $('sTokens')?.checked ? '<span class="ui-meta-chip">↗ 1.2k tokens</span>' : '', $('sCost')?.checked ? '<span class="ui-meta-chip">◈ $0.004</span>' : '' ].join('');
    const imageHost = $('uiImagePreview');
    if (imageHost) {
      const mode = $('sImageMode')?.value || UI_DEFAULTS.image_mode;
      imageHost.className = `ui-image-preview image-mode-${mode} image-size-${$('sImageSize')?.value || UI_DEFAULTS.image_size}`;
      imageHost.hidden = false;
      imageHost.innerHTML = mode === 'off' ? '<span>▧ تصاویر Markdown پنهان هستند.</span>' : mode === 'placeholder' ? '<span class="md-image-placeholder"><b>▧</b><span>تصویر بدون بارگذاری · جای‌نگهدار</span></span>' : `<button type="button" class="image-swatch" aria-label="نمونهٔ محلی تصویر؛ بدون اتصال شبکه" ${mode === 'hover' ? 'onmouseenter' : 'onclick'}="this.classList.toggle('revealed')"></button><span>${mode === 'inline' ? 'تصویر درون‌خطی · نمونهٔ محلی، بدون شبکه' : mode === 'hover' ? 'بارگذاری با مکث روی تصویر · شبکه فقط با انتخاب تو' : 'تصویر با اقدام کاربر · برای نمایش نمونه کلیک کن'}</span>`;
    }
  }

  function applyPreset(name) {
    const presets = {
      aurora: { theme: 'forest-dark', box_style: 'glass', think_style: 'focus', tool_style: 'cards', translation_style: 'accent', markdown_style: 'reader', paragraph_spacing: 'comfortable', code_theme: 'neon' },
      studio: { theme: 'zed-dark', box_style: 'raised', think_style: 'outline', tool_style: 'outlined', translation_style: 'outline', markdown_style: 'editorial', paragraph_spacing: 'airy', code_theme: 'graphite' },
      focus: { theme: 'mocha-dark', box_style: 'flat', think_style: 'minimal', tool_style: 'minimal', translation_style: 'minimal', markdown_style: 'compact', paragraph_spacing: 'compact', code_theme: 'midnight' },
      paper: { theme: 'paper-light', box_style: 'soft', think_style: 'amber', tool_style: 'cards', translation_style: 'soft', markdown_style: 'editorial', paragraph_spacing: 'spacious', code_theme: 'paper' },
      terminal: { theme: 'nord-dark', box_style: 'outlined', think_style: 'focus', tool_style: 'timeline', translation_style: 'contrast', markdown_style: 'technical', paragraph_spacing: 'snug', code_theme: 'neon', code_wrap: 'scroll', tool_output_mode: 'terminal' }
    };
    const preset = presets[name];
    if (!preset) return;
    const controls = { theme:'sTheme', box_style:'sBoxStyle', think_style:'sThinkStyle', tool_style:'sToolStyle', translation_style:'sTranslationStyle', markdown_style:'sMarkdownStyle', paragraph_spacing:'sParagraphSpacing', code_theme:'sCodeTheme', code_wrap:'sCodeWrap', tool_output_mode:'sToolOutputMode' };
    Object.entries(preset).forEach(([key, value]) => { const el = $(controls[key]); if (el) el.value = value; });
    previewUI();
    document.querySelectorAll('.ui-preset').forEach(btn => btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(`'${name}'`)));
  }

  function previewUI() {
    document.querySelectorAll('.ui-preset.active').forEach(btn => btn.classList.remove('active'));
    const theme = $('sTheme')?.value || UI_DEFAULTS.theme;
    const font = $('sFont')?.value || UI_DEFAULTS.font_scale;
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-font', font);
    document.documentElement.setAttribute('data-box-style', $('sBoxStyle')?.value || UI_DEFAULTS.box_style);
    document.documentElement.setAttribute('data-think-style', $('sThinkStyle')?.value || UI_DEFAULTS.think_style);
    document.documentElement.setAttribute('data-tool-style', $('sToolStyle')?.value || UI_DEFAULTS.tool_style);
    document.documentElement.setAttribute('data-translation-style', $('sTranslationStyle')?.value || UI_DEFAULTS.translation_style);
    document.documentElement.setAttribute('data-markdown-style', $('sMarkdownStyle')?.value || UI_DEFAULTS.markdown_style);
    document.documentElement.setAttribute('data-image-size', $('sImageSize')?.value || UI_DEFAULTS.image_size);
    document.documentElement.setAttribute('data-paragraph-spacing', $('sParagraphSpacing')?.value || UI_DEFAULTS.paragraph_spacing);
    document.documentElement.setAttribute('data-image-mode', $('sImageMode')?.value || UI_DEFAULTS.image_mode);
    document.documentElement.setAttribute('data-code-wrap', $('sCodeWrap')?.value || UI_DEFAULTS.code_wrap);
    document.documentElement.setAttribute('data-code-theme', $('sCodeTheme')?.value || UI_DEFAULTS.code_theme);
    document.documentElement.setAttribute('data-code-lines', $('sCodeLines')?.checked ? 'on' : 'off');
    document.documentElement.setAttribute('data-tool-output', $('sToolOutputMode')?.value || UI_DEFAULTS.tool_output_mode);
    const shell = document.getElementById('shellRoot');
    if (shell) shell.classList.toggle('sidebar-right', ($('sSide')?.value || UI_DEFAULTS.sidebar_side) === 'right');
    renderDisplayPreview();
    uiPreviewActive = true;
    const label = $('uiPreviewStatus');
    if (label) label.textContent = 'پیش‌نمایش زنده است؛ برای ثبت، ذخیره را بزن. با لغو یا خروج از این صفحه، تغییرات برمی‌گردند.';
  }

  function fillUIForm(ui) {
    $('sTheme').value = ui.theme || UI_DEFAULTS.theme;
    $('sFont').value = ui.font_scale || UI_DEFAULTS.font_scale;
    $('sSide').value = ui.sidebar_side || UI_DEFAULTS.sidebar_side;
    $('sThink').checked = ui.show_think ?? UI_DEFAULTS.show_think;
    $('sThinkDefault').value = ui.think_default_mode || UI_DEFAULTS.think_default_mode;
    $('sBoxStyle').value = ui.box_style || UI_DEFAULTS.box_style;
    $('sThinkStyle').value = ui.think_style || UI_DEFAULTS.think_style;
    $('sToolStyle').value = ui.tool_style || UI_DEFAULTS.tool_style;
    $('sTranslationStyle').value = ui.translation_style || UI_DEFAULTS.translation_style;
    $('sMarkdownStyle').value = ui.markdown_style || UI_DEFAULTS.markdown_style;
    $('sImageSize').value = ui.image_size || UI_DEFAULTS.image_size;
    $('sChatMode').value = ui.chat_mode || UI_DEFAULTS.chat_mode;
    $('sParagraphSpacing').value = ui.paragraph_spacing || UI_DEFAULTS.paragraph_spacing;
    $('sImageMode').value = ui.image_mode || UI_DEFAULTS.image_mode;
    $('sCodeWrap').value = ui.code_wrap || UI_DEFAULTS.code_wrap;
    $('sCodeTheme').value = ui.code_theme || UI_DEFAULTS.code_theme;
    $('sCodeLines').checked = ui.show_code_lines ?? UI_DEFAULTS.show_code_lines;
    $('sToolOutputMode').value = ui.tool_output_mode || UI_DEFAULTS.tool_output_mode;
    $('sTranslateThink').checked = ui.translate_thinking ?? UI_DEFAULTS.translate_thinking;
    $('sTools').checked = ui.show_tools ?? UI_DEFAULTS.show_tools;
    $('sTokens').checked = ui.show_inline_tokens ?? UI_DEFAULTS.show_inline_tokens;
    $('sCost').checked = ui.show_shadow_cost ?? UI_DEFAULTS.show_shadow_cost;
    $('sRecentLimit').value = ui.recent_requests_limit || UI_DEFAULTS.recent_requests_limit;
    $('sXrayLimit').value = ui.xray_limit || UI_DEFAULTS.xray_limit;
  }

  function cancelUIPreview() {
    document.querySelectorAll('.ui-preset.active').forEach(btn => btn.classList.remove('active'));
    const ui = window.ABApp.getState()?.config?.ui || {};
    document.documentElement.setAttribute('data-theme', ui.theme || UI_DEFAULTS.theme);
    document.documentElement.setAttribute('data-font', ui.font_scale || UI_DEFAULTS.font_scale);
    document.getElementById('shellRoot')?.classList.toggle('sidebar-right', (ui.sidebar_side || UI_DEFAULTS.sidebar_side) === 'right');
    document.documentElement.setAttribute('data-box-style', ui.box_style || UI_DEFAULTS.box_style);
    document.documentElement.setAttribute('data-think-style', ui.think_style || UI_DEFAULTS.think_style);
    document.documentElement.setAttribute('data-tool-style', ui.tool_style || UI_DEFAULTS.tool_style);
    document.documentElement.setAttribute('data-translation-style', ui.translation_style || UI_DEFAULTS.translation_style);
    document.documentElement.setAttribute('data-markdown-style', ui.markdown_style || UI_DEFAULTS.markdown_style);
    document.documentElement.setAttribute('data-image-size', ui.image_size || UI_DEFAULTS.image_size);
    document.documentElement.setAttribute('data-paragraph-spacing', ui.paragraph_spacing || UI_DEFAULTS.paragraph_spacing);
    document.documentElement.setAttribute('data-image-mode', ui.image_mode || UI_DEFAULTS.image_mode);
    document.documentElement.setAttribute('data-code-wrap', ui.code_wrap || UI_DEFAULTS.code_wrap);
    document.documentElement.setAttribute('data-code-theme', ui.code_theme || UI_DEFAULTS.code_theme);
    document.documentElement.setAttribute('data-code-lines', (ui.show_code_lines ?? UI_DEFAULTS.show_code_lines) ? 'on' : 'off');
    document.documentElement.setAttribute('data-tool-output', ui.tool_output_mode || UI_DEFAULTS.tool_output_mode);
    fillUIForm(ui);
    renderDisplayPreview();
    uiPreviewActive = false;
    const status = $('uiPreviewStatus');
    if (status) { status.textContent = 'پیش‌نمایش لغو شد؛ تنظیمات ذخیره‌شده برگشت.'; status.style.color = 'var(--fg-2)'; }
  }

  function resetUIToDefaults() {
    $('sTheme').value = UI_DEFAULTS.theme;
    $('sFont').value = UI_DEFAULTS.font_scale;
    $('sSide').value = UI_DEFAULTS.sidebar_side;
    $('sThink').checked = UI_DEFAULTS.show_think;
    $('sThinkDefault').value = UI_DEFAULTS.think_default_mode;
    $('sBoxStyle').value = UI_DEFAULTS.box_style;
    $('sThinkStyle').value = UI_DEFAULTS.think_style;
    $('sToolStyle').value = UI_DEFAULTS.tool_style;
    $('sTranslationStyle').value = UI_DEFAULTS.translation_style;
    $('sMarkdownStyle').value = UI_DEFAULTS.markdown_style;
    $('sImageSize').value = UI_DEFAULTS.image_size;
    $('sChatMode').value = UI_DEFAULTS.chat_mode;
    $('sParagraphSpacing').value = UI_DEFAULTS.paragraph_spacing;
    $('sImageMode').value = UI_DEFAULTS.image_mode;
    $('sCodeWrap').value = UI_DEFAULTS.code_wrap;
    $('sCodeTheme').value = UI_DEFAULTS.code_theme;
    $('sCodeLines').checked = UI_DEFAULTS.show_code_lines;
    $('sToolOutputMode').value = UI_DEFAULTS.tool_output_mode;
    $('sTranslateThink').checked = UI_DEFAULTS.translate_thinking;
    $('sTools').checked = UI_DEFAULTS.show_tools;
    $('sTokens').checked = UI_DEFAULTS.show_inline_tokens;
    $('sCost').checked = UI_DEFAULTS.show_shadow_cost;
    $('sRecentLimit').value = UI_DEFAULTS.recent_requests_limit;
    $('sXrayLimit').value = UI_DEFAULTS.xray_limit;
    previewUI();
    const status = $('uiPreviewStatus');
    if (status) status.textContent = 'مقادیر پیش‌فرض این بخش بارگذاری شد؛ برای ثبت، ذخیره را بزن.';
  }

  function translationMode() { return $('sMode')?.value || 'online'; }
  function captureTranslationDraft() {
    const mode = $('sMode')?.value;
    if (!mode) return null;
    return {
      enabled: $('sEnabled')?.checked !== false,
      engine: mode === 'online' ? ($('sEngine')?.value || 'builtin-online') : 'custom-offline',
      proxy: $('sProxy')?.value?.trim() || '',
      offline_protocol: $('sProtocol')?.value || 'openai',
      offline_url: $('sOfflineUrl')?.value?.trim() || 'http://127.0.0.1:18095',
      offline_model: $('sOfflineModel')?.value?.trim() || 'local-translator'
    };
  }
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
    translationTestNotice = message;
    translationTestOk = !!ok;
    const out = $('sTestResult');
    if (!out) return;
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
    const online = ($('sSampleMode')?.value || translationMode()) === 'online';
    $('sMode').value = online ? 'online' : 'offline';
    syncConditional();
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
      $('sSampleMeta').textContent = res.error ? `آزمون ${online ? 'آنلاین' : 'آفلاین'} ناموفق بود.` : `مسیر ${online ? 'آنلاین' : 'آفلاین'} · موتور: ${res.engine || 'نامشخص'} · ${res.elapsed_ms || 0} ms`;
    } catch (e) {
      output.textContent = `خطا در ترجمه · ${e.message}`;
      $('sSampleMeta').textContent = `آزمون ${online ? 'آنلاین' : 'آفلاین'} ناموفق بود.`;
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
    const think_default_mode = $('sThinkDefault').value;
    const box_style = $('sBoxStyle').value;
    const think_style = $('sThinkStyle').value;
    const tool_style = $('sToolStyle').value;
    const translation_style = $('sTranslationStyle').value;
    const markdown_style = $('sMarkdownStyle').value;
    const image_size = $('sImageSize').value;
    const chat_mode = $('sChatMode').value;
    const paragraph_spacing = $('sParagraphSpacing').value;
    const image_mode = $('sImageMode').value;
    const code_wrap = $('sCodeWrap').value;
    const code_theme = $('sCodeTheme').value;
    const show_code_lines = $('sCodeLines').checked;
    const tool_output_mode = $('sToolOutputMode').value;
    const translate_thinking = $('sTranslateThink').checked;
    const show_tools = $('sTools').checked;
    const show_inline_tokens = $('sTokens').checked;
    const show_shadow_cost = $('sCost').checked;
    const recent_requests_limit = Math.max(1, Math.min(100, Number($('sRecentLimit').value || 10)));
    const xray_limit = Math.max(1, Math.min(200, Number($('sXrayLimit').value || 40)));
    try {
      await api('/api/config', { ui: { theme, font_scale, sidebar_side, show_think, think_default_mode, box_style, think_style, tool_style, translation_style, markdown_style, image_size, chat_mode, paragraph_spacing, image_mode, code_wrap, code_theme, show_code_lines, tool_output_mode, translate_thinking, show_tools, show_inline_tokens, show_shadow_cost, recent_requests_limit, xray_limit } });
      uiPreviewActive = false;
      const status = $('uiPreviewStatus');
      if (status) { status.textContent = 'تنظیمات کاربری ذخیره شد.'; status.style.color = 'var(--phosphor)'; }
    } catch (e) {
      const status = $('uiPreviewStatus');
      if (status) { status.textContent = `ذخیره ناموفق · ${e.message}`; status.style.color = 'var(--red)'; }
    }
  }

  async function testModelConnection() {
    const out = $('modelTestResult'); out.textContent = 'در حال خواندن فهرست مدل‌های محلی…';
    try {
      const result = await api('/api/models/local');
      if (result.error) throw new Error(result.error);
      const selector = $('sLocalModel');
      const previous = selector.value || cfg().models?.default_model || '';
      selector.innerHTML = result.models.length
        ? result.models.map(m => `<option value="${esc(m.id)}">${esc(m.name || m.id)} · ${esc(m.id)} · ${esc(m.status || 'available')}</option>`).join('')
        : '<option value="">سرور مدلی گزارش نکرد</option>';
      if (result.models.some(m => m.id === previous)) selector.value = previous;
      out.textContent = result.models.length ? `${result.models.length} مدل پیدا شد · ${result.models.map(m => m.id).join('، ')}` : 'اتصال برقرار است ولی مدلی در /v1/models پیدا نشد.';
      out.style.color = result.models.length ? 'var(--phosphor)' : 'var(--red)';
    } catch (e) { out.textContent = `اتصال/کشف مدل ناموفق · ${e.message}`; out.style.color = 'var(--red)'; }
  }

  async function testSelectedModel(mode) {
    const online = mode === 'online';
    const output = $(online ? 'onlineModelTest' : 'modelTestResult');
    output.textContent = 'در حال اجرای درخواست واقعی کوتاه…';
    try {
      const result = await api('/api/models/test', { mode, account_id: $('sOnlineAccount')?.value, model: online ? $('sOnlineModel').value : $('sLocalModel').value });
      output.textContent = result.ok ? `تست موفق · ${result.model} · ${result.elapsed_ms} ms\n${result.sample}` : `تست ناموفق · ${result.error}`;
      output.style.color = result.ok ? 'var(--phosphor)' : 'var(--red)';
    } catch (e) { output.textContent = `تست ناموفق · ${e.message}`; output.style.color = 'var(--red)'; }
  }

  async function saveModel() {
    await api('/api/config', { tap: {
      upstream_url: $('sUpstream').value.trim(),
      lab_enable_tools: $('sLabTools').checked,
      lab_system_prompt: $('sLabPrompt').value
    }, models: {
      default_mode: $('sDefaultMode').value,
      default_model: $('sLocalModel').value,
      online_fallback: $('sOnlineFallback').checked,
      active_account_id: $('sOnlineAccount').value,
      online_model: $('sOnlineModel').value
    }});
    $('modelSaveStatus').textContent = 'اتصال و انتخاب پیش‌فرض ذخیره شد.';
  }

  async function refreshProviderAccounts() {
    const result = await api('/api/models/providers');
    const providerSelect = $('sProvider');
    if (providerSelect) providerSelect.innerHTML = Object.entries(result.providers).map(([id,p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join('');
    modelAccountsCache = result.accounts || [];
    const accountSelect = $('sOnlineAccount');
    if (accountSelect) {
      accountSelect.innerHTML = (result.accounts || []).filter(a => a.enabled).map(a => `<option value="${esc(a.id)}">${esc(a.label)} · ${esc(result.providers[a.provider]?.name || a.provider)}</option>`).join('') || '<option value="">حسابی اضافه نشده</option>';
      if (cfg().models?.active_account_id) accountSelect.value = cfg().models.active_account_id;
    }
    const list = $('modelAccountsList');
    if (list) list.innerHTML = result.locked ? '<p class="muted">خزانه قفل است؛ برای دیدن/تغییر حساب‌ها بازش کن.</p>' : (result.accounts || []).map(a => `<div class="model-account-row"><span>${esc(a.label)} · ${esc(result.providers[a.provider]?.name || a.provider)} ${a.has_key ? '· کلید ذخیره است' : '· بدون کلید'}</span><button class="btn ghost" onclick="ABSettingsPage.editModelAccount('${esc(a.id)}')">ویرایش</button><button class="btn ghost" onclick="ABSettingsPage.deleteModelAccount('${esc(a.id)}')">حذف</button></div>`).join('') || '<p class="muted">حسابی ذخیره نشده است.</p>';
    const enc = $('sEncryptAccounts');
    if (enc) { enc.checked = result.encryption_enabled; enc.disabled = result.locked; }
    const lock = $('modelVaultStatus');
    if (lock) lock.textContent = result.locked ? 'خزانهٔ کلیدها قفل است؛ برای این اجرا رمز اصلی را وارد کن.' : result.encryption_enabled ? 'خزانه باز است؛ کلیدها فقط تا پایان این اجرا در حافظه هستند.' : 'رمزگذاری خاموش است؛ کلیدها فقط در .data با دسترسی محدود ذخیره می‌شوند.';
  }

  function applyProviderDefaults() {
    const provider = ABApp.getState()?.model_providers?.[$('sProvider').value] || {};
    $('sAccountBaseUrl').value = provider.base_url || '';
    $('sAccountModelsUrl').value = provider.models_url || '';
    const link = $('modelProviderDocs');
    if (link) { link.href = provider.docs || '#'; link.hidden = !provider.docs; }
  }

  function editModelAccount(id) {
    const account = modelAccountsCache.find(item => item.id === id);
    if (!account) return;
    $('sAccountId').value = account.id;
    $('sProvider').value = account.provider;
    applyProviderDefaults();
    $('sAccountLabel').value = account.label || '';
    $('sAccountBaseUrl').value = account.base_url || '';
    $('sAccountModelsUrl').value = account.models_url || '';
    $('sAccountKey').value = '';
    $('sAccountProxy').value = '';
    $('modelAccountSaveStatus').textContent = account.has_key ? 'ویرایش حساب؛ کلید خالی بماند تا کلید ذخیره‌شده حفظ شود.' : 'ویرایش حساب بدون کلید.';
  }

  async function saveModelAccount() {
    const provider = $('sProvider').value;
    const p = cfg().models?.providers?.[provider] || {};
    const account = { id: $('sAccountId').value, provider, label: $('sAccountLabel').value.trim() || $('sProvider').selectedOptions[0].text, base_url: $('sAccountBaseUrl').value.trim() || p.base_url || '', models_url: $('sAccountModelsUrl').value.trim(), api_key: $('sAccountKey').value, proxy: $('sAccountProxy').value.trim() };
    const res = await api('/api/models/account/save', { account });
    $('sAccountKey').value = '';
    $('sAccountId').value = '';
    $('modelAccountSaveStatus').textContent = res.locked ? 'خزانه قفل است.' : 'حساب ذخیره شد؛ کلید از صفحه پاک شد.';
    await refreshProviderAccounts();
    if (res.saved?.id) $('sOnlineAccount').value = res.saved.id;
  }

  async function testOnlineAccount() {
    const out = $('modelAccountSaveStatus');
    out.textContent = 'در حال بررسی API key و دریافت فهرست مدل‌ها…';
    out.style.color = 'var(--muted)';
    const account = {
      id: $('sAccountId').value,
      provider: $('sProvider').value,
      label: $('sAccountLabel').value.trim(),
      base_url: $('sAccountBaseUrl').value.trim(),
      models_url: $('sAccountModelsUrl').value.trim(),
      api_key: $('sAccountKey').value,
      proxy: $('sAccountProxy').value.trim()
    };
    try {
      const result = await api('/api/models/connection-test', { account });
      if (!result.ok) throw new Error(`${result.error}${result.hint ? ` — ${result.hint}` : ''}`);
      const selector = $('sOnlineModel');
      const previous = cfg().models?.online_model || selector.value;
      selector.innerHTML = result.models.map(m => `<option value="${esc(m.id)}">${m.free === true ? 'رایگان · ' : ''}${esc(m.name)} · ${esc(m.id)}${m.context_length ? ` · ${m.context_length} ctx` : ''}</option>`).join('') || '<option value="">اتصال برقرار شد؛ فهرست مدل خالی است</option>';
      if (result.models.some(m => m.id === previous)) selector.value = previous;
      out.textContent = `اتصال موفق · ${result.count} مدل دریافت شد. مدل‌های رایگان OpenCode ممکن است فقط داخل خود OpenCode قابل استفاده باشند.`;
      out.style.color = 'var(--phosphor)';
    } catch (e) {
      out.textContent = `اتصال ناموفق · ${e.message}`;
      out.style.color = 'var(--red)';
    }
  }

  async function discoverOnlineModels() {
    const accountId = $('sOnlineAccount').value;
    const out = $('onlineModelTest'); out.textContent = 'در حال دریافت فهرست زنده…';
    try {
      const result = await api(`/api/models/catalog?account_id=${encodeURIComponent(accountId)}`);
      if (result.error) throw new Error(result.error);
      const currentModel = cfg().models?.online_model || $('sOnlineModel').value;
      $('sOnlineModel').innerHTML = result.models.map(m => `<option value="${esc(m.id)}">${m.free === true ? 'رایگان · ' : ''}${esc(m.name)} · ${esc(m.id)}${m.context_length ? ` · ${m.context_length} ctx` : ''}</option>`).join('') || '<option value="">مدلی در catalog نیست</option>';
      if (result.models.some(m => m.id === currentModel)) $('sOnlineModel').value = currentModel;
      out.textContent = `${result.models.length} مدل از حساب دریافت شد. انتخاب را ذخیره کن تا مدل پیش‌فرض شود.`;
      out.style.color = result.models.length ? 'var(--phosphor)' : 'var(--red)';
    } catch (e) { out.textContent = `گرفتن فهرست ناموفق · ${e.message}`; out.style.color = 'var(--red)'; }
  }

  async function deleteModelAccount(id) {
    if (!confirm('این حساب و کلید ذخیره‌شده‌اش حذف شود؟')) return;
    await api('/api/models/account/delete', { id });
    await refreshProviderAccounts();
  }

  async function changeModelEncryption() {
    const enable = $('sEncryptAccounts').checked;
    const passphrase = prompt(enable ? 'رمز اصلی برای رمزگذاری کلیدها را وارد کن:' : 'برای برداشتن رمزگذاری، رمز فعلی را وارد کن:');
    if (passphrase === null) { $('sEncryptAccounts').checked = !enable; return; }
    const confirmPass = enable ? prompt('رمز اصلی را دوباره وارد کن:') : passphrase;
    if (confirmPass === null) { $('sEncryptAccounts').checked = !enable; return; }
    try {
      await api('/api/models/encryption', { enabled: enable, passphrase, confirm: confirmPass });
      await refreshProviderAccounts();
    } catch (e) {
      alert(`تغییر رمزگذاری انجام نشد: ${e.message}`);
      $('sEncryptAccounts').checked = !enable;
    }
  }

  function selectedCleanupScopes() {
    return ['telemetry', 'lab', 'mirrors', 'xray'].filter(scope => cleanupUi.scopes[scope]);
  }

  function cleanupDaysValue() {
    const raw = $('cleanupDays')?.value ?? cleanupUi.days ?? 7;
    if (String(raw).trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(3650, Math.floor(value))) : null;
  }

  function cleanupKey(days = cleanupDaysValue(), scopes = selectedCleanupScopes()) {
    return JSON.stringify({ days, scopes: [...scopes].sort() });
  }

  function invalidateCleanupPreview() {
    cleanupPreviewData = null;
    cleanupPreviewKey = '';
    const result = $('cleanupPreview');
    if (result) { result.hidden = true; result.innerHTML = ''; }
    const dialog = $('cleanupConfirmDialog');
    if (dialog) dialog.hidden = true;
    cleanupNotice = 'انتخاب تغییر کرد؛ برای دیدن موارد دقیق، پیش‌نمایش تازه بگیر.';
    const status = $('cleanupStatus');
    if (status) status.textContent = cleanupNotice;
  }

  function setCleanupRange(days) {
    cleanupUi.days = Math.max(0, Math.min(3650, Number(days) || 0));
    const input = $('cleanupDays');
    if (input) input.value = cleanupUi.days;
    const hint = $('cleanupRangeHint');
    if (hint) hint.textContent = cleanupUi.days === 0 ? 'تمام تاریخچهٔ دسته‌های انتخاب‌شده · X-Ray جداگانه' : `${cleanupUi.days} روز · بازه روی X-Ray اعمال نمی‌شود`;
    invalidateCleanupPreview();
    document.querySelectorAll('[data-cleanup-days]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.cleanupDays) === cleanupUi.days));
  }

  function setCleanupDays(value) {
    if (String(value).trim() === '') {
      cleanupUi.days = null;
      const hint = $('cleanupRangeHint');
      if (hint) hint.textContent = 'برای پیش‌نمایش، عدد روز را وارد کن.';
      invalidateCleanupPreview();
      document.querySelectorAll('[data-cleanup-days]').forEach(btn => btn.classList.remove('active'));
      return;
    }
    cleanupUi.days = Math.max(0, Math.min(3650, Number(value) || 0));
    const hint = $('cleanupRangeHint');
    if (hint) hint.textContent = cleanupUi.days === 0 ? 'تمام تاریخچهٔ دسته‌های انتخاب‌شده · X-Ray جداگانه' : `${cleanupUi.days} روز · بازه روی X-Ray اعمال نمی‌شود`;
    invalidateCleanupPreview();
    document.querySelectorAll('[data-cleanup-days]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.cleanupDays) === cleanupUi.days));
  }

  function setCleanupScope(scope, enabled) {
    if (!(scope in cleanupUi.scopes)) return;
    cleanupUi.scopes[scope] = !!enabled;
    invalidateCleanupPreview();
  }

  function switchCleanupTab(tab) {
    if (!['history', 'cleanup'].includes(tab)) return;
    cleanupTab = tab;
    const root = $('cleanupRoot');
    if (!root) return;
    root.querySelectorAll('[data-cleanup-pane]').forEach(pane => { pane.hidden = pane.dataset.cleanupPane !== tab; });
    root.querySelectorAll('[data-cleanup-tab]').forEach(button => button.classList.toggle('active', button.dataset.cleanupTab === tab));
  }

  function formatHistoryDate(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return 'زمان نامشخص';
    try { return new Date(value * 1000).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (_) { return 'زمان نامشخص'; }
  }

  function formatStorageBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1048576).toFixed(2)} MiB`;
  }

  function historyRecords() {
    const state = cleanupState || {};
    const storedFiles = state.storage?.files || [];
    const fileSize = path => Number(storedFiles.find(file => file.path === path)?.bytes || 0);
    const safeMirrorId = id => String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '-') || 'agent';
    const labItem = (item, archived) => ({ kind: 'lab', id: item.id, title: item.title || item.id, turns: item.turn_count || 0, updated: item.updated_at, bytes: item.bytes || fileSize(`sessions/lab/${item.id}.json`), archived, live: !archived });
    const labs = (state.lab_sessions || []).map(item => labItem(item, false));
    const archivedLabs = (state.lab_history || []).map(item => labItem(item, true));
    const mirrorItem = item => ({ kind: 'mirror', id: item.agent_id, title: item.title || item.agent_id, turns: item.turn_count || 0, updated: item.updated_at, bytes: item.bytes || fileSize(`mirrors/${safeMirrorId(item.agent_id)}.json`), live: !!item.pty_live, ptyLive: !!item.pty_live, archived: !!item.archived });
    const offline = (state.mirror_history || []).map(mirrorItem);
    const live = (state.mirrors || []).map(mirrorItem);
    return [...labs, ...archivedLabs, ...offline, ...live];
  }

  function renderHistoryResults() {
    const host = $('historyResults');
    if (!host) return;
    const query = String(cleanupUi.query || '').trim().toLocaleLowerCase();
    let records = historyRecords().filter(item => {
      const typeOk = cleanupUi.kind === 'all' || (cleanupUi.kind === 'lab' && item.kind === 'lab') || (cleanupUi.kind === 'mirror' && item.kind === 'mirror') || (cleanupUi.kind === 'live' && item.live);
      const queryOk = !query || `${item.title} ${item.id} ${item.kind}`.toLocaleLowerCase().includes(query);
      return typeOk && queryOk;
    });
    records.sort((a, b) => cleanupUi.sort === 'oldest' ? (a.updated || 0) - (b.updated || 0) : cleanupUi.sort === 'turns' ? b.turns - a.turns : cleanupUi.sort === 'size' ? b.bytes - a.bytes : (b.updated || 0) - (a.updated || 0));
    if (!records.length) {
      host.innerHTML = '<div class="cleanup-empty"><span>⌕</span><strong>چیزی پیدا نشد</strong><small>عبارت جست‌وجو یا فیلتر نوع تاریخچه را تغییر بده.</small></div>';
    } else {
      host.innerHTML = records.map(item => {
        const type = item.kind === 'lab' ? (item.archived ? 'آزمایش Lab · تاریخچه' : 'آزمایش Lab · باز') : item.ptyLive ? 'ترمینال زنده' : 'تاریخچهٔ ترمینال';
        const badge = item.kind === 'lab'
          ? `<span class="history-state lab">${item.archived ? 'LAB · بایگانی' : 'LAB · باز'}</span>`
          : item.ptyLive ? '<span class="history-state live">PTY زنده · محافظت‌شده</span>' : '<span class="history-state offline">ذخیره‌شده</span>';
        const openLabel = item.archived ? 'بازگردانی' : 'بازکردن';
        const openAction = `<button type="button" class="btn ghost" data-history-action="open" data-kind="${item.kind}" data-id="${esc(item.id)}">${openLabel}</button>`;
        const archiveAction = (item.kind === 'lab' && !item.archived) || (item.kind === 'mirror' && item.ptyLive && !item.archived)
          ? `<button type="button" class="btn ghost" data-history-action="archive" data-kind="${item.kind}" data-id="${esc(item.id)}">انتقال به تاریخچه</button>` : '';
        const deleteAction = item.ptyLive ? '' : `<button type="button" class="btn ghost danger" data-history-action="delete" data-kind="${item.kind}" data-id="${esc(item.id)}" data-title="${esc(item.title)}">حذف</button>`;
        return `<article class="history-card ${item.live ? 'is-live' : ''}"><div class="history-card-main"><div class="history-card-title">${badge}<strong>${esc(item.title)}</strong><small>${esc(type)}</small></div><div class="history-card-meta"><span>◷ ${formatHistoryDate(item.updated)}</span><span>↻ ${Number(item.turns)} دور</span><span>▤ ${formatStorageBytes(item.bytes)}</span></div></div><div class="history-card-actions">${openAction}${archiveAction}${deleteAction}</div></article>`;
      }).join('');
    }
    const count = $('historyResultCount');
    if (count) count.textContent = `${records.length} مورد`;
    const status = $('historyStatus');
    if (status) status.textContent = historyNotice;
  }

  function filterHistory() {
    cleanupUi.query = $('historySearch')?.value || '';
    cleanupUi.kind = $('historyKind')?.value || 'all';
    cleanupUi.sort = $('historySort')?.value || 'recent';
    renderHistoryResults();
  }

  function bindHistoryActions(root) {
    if (!root || root.dataset?.historyActionsBound || !root.addEventListener) return;
    root.dataset.historyActionsBound = 'true';
    root.addEventListener('click', async event => {
      const button = event.target?.closest?.('[data-history-action]');
      if (!button || !root.contains(button)) return;
      const { historyAction: action, kind, id, title } = button.dataset;
      if (action === 'open') {
        if (kind === 'lab') window.ABApp.selectLab(id);
        else window.ABApp.selectMirror(id);
      } else if (action === 'archive') {
        button.disabled = true;
        try {
          const endpoint = kind === 'lab' ? '/api/lab/archive' : '/api/mirror/archive';
          const result = await api(endpoint, kind === 'lab' ? { session_id: id } : { agent_id: id });
          if (!result.ok) throw new Error('انتقال به تاریخچه انجام نشد.');
          if (kind === 'lab') {
            const item = (cleanupState.lab_sessions || []).find(entry => entry.id === id);
            cleanupState.lab_sessions = (cleanupState.lab_sessions || []).filter(entry => entry.id !== id);
            if (item) cleanupState.lab_history = [...(cleanupState.lab_history || []), { ...item, archived: true }];
          } else {
            const item = (cleanupState.mirrors || []).find(entry => entry.agent_id === id);
            cleanupState.mirrors = (cleanupState.mirrors || []).filter(entry => entry.agent_id !== id);
            if (item) cleanupState.mirror_history = [...(cleanupState.mirror_history || []), { ...item, archived: true }];
          }
          historyNotice = 'به تاریخچه منتقل شد؛ داده‌ها حفظ شدند.';
          renderHistoryResults();
        } catch (error) {
          historyNotice = `انتقال انجام نشد · ${error.message}`;
          renderHistoryResults();
        }
      } else if (action === 'delete') {
        pendingHistoryDelete = { kind, id, title: title || id };
        const message = $('historyDeleteMessage');
        if (message) message.textContent = `«${pendingHistoryDelete.title}» حذف شود؟ این کار نشست و پیام‌های ذخیره‌شدهٔ همین مورد را پاک می‌کند.`;
        const dialog = $('historyDeleteDialog');
        if (dialog) dialog.hidden = false;
      }
    });
  }

  function cancelHistoryDelete() {
    pendingHistoryDelete = null;
    const dialog = $('historyDeleteDialog');
    if (dialog) dialog.hidden = true;
  }

  async function confirmHistoryDelete() {
    if (!pendingHistoryDelete) return;
    const item = pendingHistoryDelete;
    const button = $('confirmHistoryDeleteButton');
    if (button) button.disabled = true;
    try {
      const result = item.kind === 'lab'
        ? await api('/api/lab/delete', { session_id: item.id })
        : await api('/api/mirror/delete', { agent_id: item.id });
      if (!result.ok) throw new Error('مورد پیدا نشد یا ترمینال هنوز فعال است؛ حذف انجام نشد.');
      historyNotice = 'تاریخچه حذف شد.';
      if (item.kind === 'lab') {
        cleanupState.lab_sessions = (cleanupState.lab_sessions || []).filter(entry => entry.id !== item.id);
        cleanupState.lab_history = (cleanupState.lab_history || []).filter(entry => entry.id !== item.id);
      } else {
        cleanupState.mirror_history = (cleanupState.mirror_history || []).filter(entry => entry.agent_id !== item.id);
        cleanupState.mirrors = (cleanupState.mirrors || []).filter(entry => entry.agent_id !== item.id);
      }
      pendingHistoryDelete = null;
      const dialog = $('historyDeleteDialog');
      if (dialog) dialog.hidden = true;
      renderHistoryResults();
    } catch (error) {
      historyNotice = `حذف انجام نشد · ${error.message}`;
      const message = $('historyDeleteMessage');
      if (message) message.textContent = historyNotice;
      const status = $('historyStatus');
      if (status) status.textContent = historyNotice;
      const dialog = $('historyDeleteDialog');
      if (dialog) dialog.hidden = false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function cleanupPreviewMarkup(preview) {
    const categories = preview.categories || {};
    const labels = { telemetry: 'آمار درخواست‌ها', xray: 'قاب‌های X-Ray', lab: 'نشست‌های Lab', mirrors: 'تاریخچهٔ ترمینال' };
    const rows = ['telemetry', 'xray', 'lab', 'mirrors'].filter(key => preview.scopes.includes(key)).map(key => {
      const item = categories[key] || { items: 0 };
      const details = key === 'xray' ? 'تمام قاب‌های فعلی حافظه' : key === 'telemetry' ? 'رکوردهای قدیمی‌تر از بازه' : `${(preview.files || []).filter(file => file.scope === key).length} فایل`;
      return `<div class="cleanup-preview-row"><span>${labels[key]}</span><strong>${Number(item.items || 0).toLocaleString('fa-IR')} ${item.unit || 'مورد'}</strong><small>${details}${item.bytes != null ? ` · ${formatStorageBytes(item.bytes)}` : ''}</small></div>`;
    }).join('');
    const paths = (preview.files || []).length
      ? `<details class="cleanup-target-list"><summary>دیدن فایل‌های هدف · ${preview.files.length}</summary><ul>${preview.files.map(file => `<li><span>${esc(file.title || file.id || file.path)}</span><small>${esc(file.path)} · ${formatStorageBytes(file.bytes)}</small></li>`).join('')}</ul></details>`
      : '';
    const warning = preview.scopes.includes('xray') && preview.xray_frames
      ? '<p class="cleanup-warning">X-Ray موقتی است؛ انتخابش همهٔ قاب‌های فعلی را پاک می‌کند و بازهٔ روزها روی آن اعمال نمی‌شود.</p>' : '';
    const scopeCount = Number(preview.total_items || 0);
    const dateSummary = preview.scopes.some(scope => scope !== 'xray') ? (preview.days === 0 ? 'تمام تاریخچهٔ دسته‌های انتخاب‌شده' : `قدیمی‌تر از ${preview.days} روز`) : 'تمام قاب‌های فعلی حافظه';
    return `<div class="cleanup-preview-head"><div><span class="cleanup-preview-icon">⌕</span><div><strong>پیش‌نمایش آماده است</strong><small>${dateSummary} · ${scopeCount.toLocaleString('fa-IR')} مورد در صف بررسی</small></div></div><span class="cleanup-size-tag">فایل‌ها · ${formatStorageBytes(preview.bytes)}</span></div><div class="cleanup-preview-rows">${rows || '<p class="muted">دسته‌ای برای پاکسازی انتخاب نشده.</p>'}</div>${paths}${warning}<button class="btn danger cleanup-review-button" type="button" onclick="ABSettingsPage.runSelectedCleanup()" ${scopeCount ? '' : 'disabled'}>ادامه و بررسی حذف ${scopeCount.toLocaleString('fa-IR')} مورد</button>`;
  }

  async function previewCleanup() {
    const scopes = selectedCleanupScopes();
    if (!scopes.length) { cleanupNotice = 'برای پیش‌نمایش، حداقل یک دسته را انتخاب کن.'; const s = $('cleanupStatus'); if (s) s.textContent = cleanupNotice; return null; }
    const days = cleanupDaysValue();
    if (days === null) { cleanupNotice = 'تعداد روز معتبر وارد کن یا یکی از بازه‌های آماده را انتخاب کن.'; const invalidStatus = $('cleanupStatus'); if (invalidStatus) invalidStatus.textContent = cleanupNotice; return null; }
    cleanupUi.days = days;
    cleanupNotice = 'در حال محاسبهٔ موارد منطبق…';
    const status = $('cleanupStatus');
    if (status) status.textContent = cleanupNotice;
    const requestKey = cleanupKey(days, scopes);
    try {
      const result = await api('/api/cleanup/preview', { days, scopes });
      if (requestKey !== cleanupKey()) return null;
      if (!result.categories) {
        const files = result.files || [];
        result.categories = {
          telemetry: { items: Number(result.telemetry_requests || 0), unit: 'درخواست', bytes: null },
          xray: { items: Number(result.xray_frames || 0), unit: 'قاب', bytes: null },
          lab: { items: files.filter(file => file.scope === 'lab').length, unit: 'نشست', bytes: files.filter(file => file.scope === 'lab').reduce((sum, file) => sum + Number(file.bytes || 0), 0) },
          mirrors: { items: files.filter(file => file.scope === 'mirrors').length, unit: 'تاریخچه', bytes: files.filter(file => file.scope === 'mirrors').reduce((sum, file) => sum + Number(file.bytes || 0), 0) }
        };
      }
      if (result.total_items == null) result.total_items = Number(result.telemetry_requests || 0) + Number(result.xray_frames || 0) + Number(result.file_count || (result.files || []).length);
      cleanupPreviewData = result;
      cleanupPreviewKey = cleanupKey(days, scopes);
      const host = $('cleanupPreview');
      if (host) { host.innerHTML = cleanupPreviewMarkup(result); host.hidden = false; }
      const dialog = $('cleanupConfirmDialog');
      if (dialog) dialog.hidden = true;
      cleanupNotice = result.total_items ? 'پیش‌نمایش کامل است؛ تا تأیید نهایی هیچ داده‌ای حذف نمی‌شود.' : 'موردی با این بازه و دسته‌ها پیدا نشد؛ چیزی حذف نخواهد شد.';
      if (status) status.textContent = cleanupNotice;
      return result;
    } catch (error) {
      cleanupNotice = `پیش‌نمایش ناموفق · ${error.message}`;
      if (status) status.textContent = cleanupNotice;
      return null;
    }
  }

  async function runSelectedCleanup() {
    const days = cleanupDaysValue();
    const scopes = selectedCleanupScopes();
    if (!cleanupPreviewData || cleanupPreviewKey !== cleanupKey(days, scopes)) {
      const preview = await previewCleanup();
      if (!preview) return;
    }
    if (!cleanupPreviewData?.total_items) return;
    const summary = $('cleanupConfirmSummary');
    if (summary) summary.textContent = `حذف ${Number(cleanupPreviewData.total_items).toLocaleString('fa-IR')} مورد از ${cleanupPreviewData.scopes.map(scope => ({ telemetry:'آمار', xray:'X-Ray', lab:'Lab', mirrors:'ترمینال' })[scope]).join('، ')}. فایل تنظیمات، حساب‌ها و کلیدهای مدل در این عملیات دست‌نخورده می‌مانند.`;
    const caution = $('cleanupConfirmCaution');
    if (caution) caution.textContent = cleanupPreviewData.scopes.includes('xray')
      ? 'این عملیات قابل‌بازگشت نیست؛ X-Ray همهٔ قاب‌های موقت فعلی را پاک می‌کند.'
      : 'این عملیات قابل‌بازگشت نیست؛ فقط موارد همین پیش‌نمایش حذف می‌شوند.';
    const dialog = $('cleanupConfirmDialog');
    if (dialog) dialog.hidden = false;
  }

  function cancelCleanupRun() {
    const dialog = $('cleanupConfirmDialog');
    if (dialog) dialog.hidden = true;
  }

  async function confirmCleanupRun() {
    const days = cleanupDaysValue();
    const scopes = selectedCleanupScopes();
    if (!cleanupPreviewData || cleanupPreviewKey !== cleanupKey(days, scopes)) {
      cancelCleanupRun();
      await previewCleanup();
      return;
    }
    const button = $('cleanupConfirmButton');
    if (button) button.disabled = true;
    cleanupNotice = 'پاکسازی در حال اجراست…';
    const status = $('cleanupStatus');
    if (status) status.textContent = cleanupNotice;
    try {
      const result = await api('/api/cleanup/run', { days, scopes });
      const parts = result.deleted_by_scope || {
        telemetry: Number(result.deleted_requests || 0),
        xray: Number(result.deleted_xray_frames || 0),
        lab: Number(result.deleted_lab_sessions || 0),
        mirrors: Math.max(0, Number(result.deleted_files || 0) - Number(result.deleted_lab_sessions || 0))
      };
      cleanupNotice = `پاکسازی انجام شد · آمار ${Number(parts.telemetry || 0).toLocaleString('fa-IR')} · X-Ray ${Number(parts.xray || 0).toLocaleString('fa-IR')} · Lab ${Number(parts.lab || 0).toLocaleString('fa-IR')} · ترمینال ${Number(parts.mirrors || 0).toLocaleString('fa-IR')} · آزادشده ${formatStorageBytes(result.freed_bytes)}.`;
      cleanupPreviewData = null;
      cleanupPreviewKey = '';
      const previewHost = $('cleanupPreview');
      if (previewHost) previewHost.hidden = true;
      cancelCleanupRun();
      if (status) status.textContent = cleanupNotice;
    } catch (error) {
      cleanupNotice = `پاکسازی انجام نشد · ${error.message}`;
      if (status) status.textContent = cleanupNotice;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveRetention() {
    const days = Math.max(0, Math.min(3650, Number($('retentionDays')?.value || 0)));
    const enabled = !!$('retentionAuto')?.checked && days > 0;
    const status = $('retentionStatus');
    if (status) status.textContent = 'در حال ذخیره…';
    try {
      await api('/api/config', { retention: { days, auto_prune_on_boot: enabled } });
      if (status) status.textContent = enabled ? `نگهداری خودکار ذخیره شد · ${days === 0 ? 'حذف خودکار خاموش' : `نگه‌داشتن ${days} روز`}. از شروع بعدی برنامه اعمال می‌شود.` : 'نگهداری خودکار خاموش شد؛ پاکسازی دستی مستقل باقی می‌ماند.';
    } catch (error) { if (status) status.textContent = `ذخیره ناموفق · ${error.message}`; }
  }

  function renderCleanupPage(host, state, config) {
    cleanupState = state;
    if (cleanupUi.days === null) cleanupUi.days = Math.max(0, Number(config.retention?.days) || 7);
    const activeMirrors = [...(state.mirrors || []), ...(state.mirror_history || [])].filter(item => item.pty_live).length;
    const historyCount = (state.mirror_history || []).length;
    const labCount = (state.lab_sessions || []).length + (state.lab_history || []).length;
    const totalHistoryRecords = labCount + historyCount + (state.mirrors || []).length;
    const storageMiB = Number(state.storage?.total_kib || 0) / 1024;
    host.innerHTML = `<div id="cleanupRoot" class="panel-wrap cleanup-page rtl">
      <header class="cleanup-hero"><div><span class="cleanup-eyebrow">DATA CARE · .DATA/</span><h2>تاریخچه و پاکسازی</h2><p>تاریخچه را پیدا و مرور کن؛ پاکسازی هم فقط بعد از پیش‌نمایش و تأیید انجام می‌شود.</p></div><div class="cleanup-storage"><span>فضای داده</span><strong>${storageMiB.toFixed(1)} <small>MiB</small></strong><small>${Number(state.storage?.file_count || 0).toLocaleString('fa-IR')} فایل در .data/</small></div></header>
      <nav class="cleanup-tabs" aria-label="مدیریت تاریخچه و داده"><button type="button" data-cleanup-tab="history" class="${cleanupTab === 'history' ? 'active' : ''}" onclick="ABSettingsPage.switchCleanupTab('history')">⌕ تاریخچه <span>${totalHistoryRecords}</span></button><button type="button" data-cleanup-tab="cleanup" class="${cleanupTab === 'cleanup' ? 'active' : ''}" onclick="ABSettingsPage.switchCleanupTab('cleanup')">⌫ پاکسازی</button></nav>
      <section class="cleanup-pane" data-cleanup-pane="history" ${cleanupTab === 'history' ? '' : 'hidden'}>
        <div class="cleanup-stats"><div><span>آزمایش‌های Lab</span><strong>${labCount}</strong></div><div><span>تاریخچهٔ ترمینال</span><strong>${historyCount}</strong></div><div><span>ترمینال زنده · محافظت‌شده</span><strong>${activeMirrors}</strong></div></div>
        <div class="history-toolbar"><div class="history-search"><span>⌕</span><input id="historySearch" type="search" placeholder="جست‌وجو بر اساس عنوان یا شناسه…" value="${esc(cleanupUi.query)}" oninput="ABSettingsPage.filterHistory()"></div><select id="historyKind" aria-label="نوع تاریخچه" onchange="ABSettingsPage.filterHistory()"><option value="all" ${cleanupUi.kind === 'all' ? 'selected' : ''}>همهٔ موارد</option><option value="lab" ${cleanupUi.kind === 'lab' ? 'selected' : ''}>Lab</option><option value="mirror" ${cleanupUi.kind === 'mirror' ? 'selected' : ''}>ترمینال‌های ذخیره‌شده</option><option value="live" ${cleanupUi.kind === 'live' ? 'selected' : ''}>ترمینال‌های زنده</option></select><select id="historySort" aria-label="مرتب‌سازی" onchange="ABSettingsPage.filterHistory()"><option value="recent" ${cleanupUi.sort === 'recent' ? 'selected' : ''}>تازه‌ترین</option><option value="oldest" ${cleanupUi.sort === 'oldest' ? 'selected' : ''}>قدیمی‌ترین</option><option value="turns" ${cleanupUi.sort === 'turns' ? 'selected' : ''}>بیشترین دور</option><option value="size" ${cleanupUi.sort === 'size' ? 'selected' : ''}>بزرگ‌ترین</option></select></div>
        <div class="history-list-head"><strong>موارد ذخیره‌شده</strong><span id="historyResultCount"></span></div><div id="historyResults" class="history-results"></div><div id="historyStatus" class="cleanup-status" role="status">${esc(historyNotice)}</div>
      </section>
      <section class="cleanup-pane" data-cleanup-pane="cleanup" ${cleanupTab === 'cleanup' ? '' : 'hidden'}>
        <section class="retention-card"><div class="retention-card-copy"><span class="cleanup-section-kicker">AUTOMATIC RETENTION</span><h3>نگهداری خودکار هنگام شروع برنامه</h3><p>این تنظیم فقط سیاست اجرای بعدی را ذخیره می‌کند؛ با زدن ذخیره چیزی همان لحظه پاک نمی‌شود.</p></div><div class="retention-control"><label class="ui-switch"><input id="retentionAuto" type="checkbox" ${config.retention?.auto_prune_on_boot !== false && Number(config.retention?.days ?? 7) > 0 ? 'checked' : ''}><span class="ui-slider"></span></label><span>فعال</span></div><div class="retention-days"><label for="retentionDays">مدت نگهداری</label><div><input id="retentionDays" type="number" min="0" max="3650" value="${Number(config.retention?.days ?? 7)}"><span>روز</span></div><small>۰ یعنی پاکسازی خودکار خاموش؛ نشست‌ها و آمار قدیمی‌تر از این مدت در شروع بعدی حذف می‌شوند.</small></div><div class="retention-actions"><button class="btn" type="button" onclick="ABSettingsPage.saveRetention()">ذخیرهٔ سیاست نگهداری</button><span id="retentionStatus" class="muted" role="status"></span></div></section>
        <section class="manual-cleanup-card"><div class="manual-cleanup-head"><div><span class="cleanup-section-kicker">MANUAL CLEANUP</span><h3>پاکسازی دستیِ انتخابی</h3><p>انتخاب دسته و بازه؛ اول پیش‌نمایش می‌گیری، بعد جداگانه حذف را تأیید می‌کنی.</p></div><span class="safe-badge">تنظیمات و کلیدها محفوظ‌اند</span></div>
          <div class="cleanup-range"><div><strong>حذف موارد قدیمی‌تر از</strong><small id="cleanupRangeHint">${cleanupUi.days === 0 ? 'تمام تاریخچهٔ دسته‌های انتخاب‌شده' : `${cleanupUi.days} روز`} · بازه روی X-Ray اعمال نمی‌شود</small></div><div class="cleanup-range-picks">${[[1,'۲۴ ساعت'],[7,'۷ روز'],[30,'۳۰ روز'],[90,'۹۰ روز'],[0,'همه']].map(([days,label]) => `<button type="button" data-cleanup-days="${days}" class="${cleanupUi.days === days ? 'active' : ''}" onclick="ABSettingsPage.setCleanupRange(${days})">${label}</button>`).join('')}<label class="cleanup-custom-days"><input id="cleanupDays" type="number" min="0" max="3650" value="${cleanupUi.days}" oninput="ABSettingsPage.setCleanupDays(this.value)" aria-label="روز دلخواه"><span>روز دلخواه</span></label></div></div>
          <div class="cleanup-scope-grid">${[
            ['telemetry','آمار درخواست‌ها','رکوردهای توکن، زمان و هزینه؛ متن گفتگو حذف نمی‌شود.','chart'],
            ['lab','نشست‌های Lab','نشست‌ها و پیام‌های ذخیره‌شدهٔ Lab در بازهٔ انتخابی.','lab'],
            ['mirrors','تاریخچهٔ ترمینال','فقط آینه‌های غیرفعال؛ کانال زنده محافظت می‌شود.','mirror'],
            ['xray','قاب‌های X-Ray','حافظهٔ موقت همین اجرای برنامه؛ با انتخاب این مورد همهٔ قاب‌ها پاک می‌شوند.','xray']
          ].map(([id,title,description,icon]) => `<label class="cleanup-scope-card ${id === 'xray' ? 'is-volatile' : ''}"><input type="checkbox" data-cleanup-scope="${id}" ${cleanupUi.scopes[id] ? 'checked' : ''} onchange="ABSettingsPage.setCleanupScope('${id}',this.checked)"><span class="cleanup-scope-icon ${icon}">${id === 'telemetry' ? '↗' : id === 'lab' ? '⚡' : id === 'mirrors' ? '⌘' : '◉'}</span><span class="cleanup-scope-text"><strong>${title}</strong><small>${description}</small></span><span class="cleanup-scope-check">✓</span></label>`).join('')}</div>
          <div class="cleanup-actions"><button class="btn primary" type="button" onclick="ABSettingsPage.previewCleanup()">پیش‌نمایش موارد منطبق</button><span id="cleanupStatus" class="cleanup-status" role="status">${esc(cleanupNotice || 'هنوز چیزی حذف نشده؛ برای شروع پیش‌نمایش بگیر.')}</span></div>
          <div id="cleanupPreview" class="cleanup-preview-card" ${cleanupPreviewData && cleanupPreviewKey === cleanupKey(cleanupUi.days, selectedCleanupScopes()) ? '' : 'hidden'}>${cleanupPreviewData ? cleanupPreviewMarkup(cleanupPreviewData) : ''}</div>
        </section>
      </section>
      <div id="historyDeleteDialog" class="cleanup-modal" hidden role="dialog" aria-modal="true" aria-labelledby="historyDeleteTitle"><div class="cleanup-modal-card"><span class="cleanup-modal-icon">!</span><h3 id="historyDeleteTitle">حذف این تاریخچه؟</h3><p id="historyDeleteMessage"></p><div class="cleanup-modal-actions"><button class="btn ghost" type="button" onclick="ABSettingsPage.cancelHistoryDelete()">انصراف</button><button id="confirmHistoryDeleteButton" class="btn danger" type="button" onclick="ABSettingsPage.confirmHistoryDelete()">حذف همین مورد</button></div></div></div>
      <div id="cleanupConfirmDialog" class="cleanup-modal" hidden role="dialog" aria-modal="true" aria-labelledby="cleanupConfirmTitle"><div class="cleanup-modal-card"><span class="cleanup-modal-icon">!</span><h3 id="cleanupConfirmTitle">تأیید پاکسازی</h3><p id="cleanupConfirmSummary"></p><small id="cleanupConfirmCaution">این عملیات قابل‌بازگشت نیست.</small><div class="cleanup-modal-actions"><button class="btn ghost" type="button" onclick="ABSettingsPage.cancelCleanupRun()">برگشت و بازبینی</button><button id="cleanupConfirmButton" class="btn danger" type="button" onclick="ABSettingsPage.confirmCleanupRun()">بله، موارد پیش‌نمایش‌شده حذف شوند</button></div></div></div>
    </div>`;
    bindHistoryActions(host);
    renderHistoryResults();
  }

  function toggleHelp(id) { $(id).classList.toggle('open'); }
  function syncConditional() {
    const online = translationMode() === 'online';
    $('onlineFields').hidden = !online;
    $('offlineFields').hidden = online;
    $('sProxy').disabled = !online;
    $('sEngine').disabled = !online;
    const sampleMode = $('sSampleMode');
    if (sampleMode) sampleMode.value = online ? 'online' : 'offline';
  }
  function setSampleTranslationMode() {
    const sampleMode = $('sSampleMode')?.value || 'online';
    $('sMode').value = sampleMode;
    syncConditional();
  }

  function render(host, state, route) {
    if (route !== 'set-translate') translationTestNotice = '';
    const c = state.config;
    const draft = route === 'set-translate' ? captureTranslationDraft() : null;
    const sampleModeDraft = route === 'set-translate' ? $('sSampleMode')?.value : null;
    const tr = { ...c.translation, ...(draft || {}) };
    const ui = c.ui, tap = c.tap;
    if (route === 'set-translate') {
      const online = tr.engine !== 'custom-offline';
      const selectedSampleMode = sampleModeDraft || (online ? 'online' : 'offline');
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
            <div class="translator-sample-head"><div><h3>آزمون ترجمه</h3><p>برای نمونه، حالت آنلاین یا آفلاین را همین‌جا انتخاب کن؛ تنظیمات همان حالت در بالا باز می‌شود.</p></div><div class="translator-sample-controls"><div class="fld"><label for="sSampleMode">حالت آزمون</label><select id="sSampleMode" onchange="ABSettingsPage.setSampleTranslationMode()"><option value="online" ${selectedSampleMode === 'online' ? 'selected' : ''}>آنلاین</option><option value="offline" ${selectedSampleMode === 'offline' ? 'selected' : ''}>آفلاین</option></select></div><div class="fld"><label for="sSampleTarget">ترجمه به</label><select id="sSampleTarget"><option value="en">English</option><option value="fa">فارسی</option></select></div></div></div>
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
      if (translationTestNotice) setTranslationStatus(translationTestNotice, translationTestOk);
    } else if (route === 'set-hud') {
      host.innerHTML = `<div class="panel-wrap ui-settings">
        <div class="panel rtl">
          <div class="panel-head"><div><h3>تم و تنظیمات کاربری</h3><p class="muted">تم و ظاهر مستقل باکس‌ها، Think و ابزارها را زنده پیش‌نمایش کن؛ تا وقتی ذخیره نزنی فقط پیش‌نمایش موقت است.</p></div></div>
          <div class="field-grid">
            <div class="fld"><label for="sTheme">تم رنگی</label><select id="sTheme" onchange="ABSettingsPage.previewUI()"><option value="openwebui-dark">Open WebUI · Slate</option><option value="mocha-dark">Catppuccin Mocha</option><option value="zed-dark">Zed Dark</option><option value="lobechat-dark">LobeChat Glass</option><option value="nord-dark">Nord</option><option value="forest-dark">Forest</option><option value="paper-light">Paper Light</option></select></div>
            <div class="fld"><label for="sFont">اندازهٔ نوشته</label><select id="sFont" onchange="ABSettingsPage.previewUI()"><option value="compact">فشرده · 13px</option><option value="normal">معمولی · 14px</option><option value="large">خوانا · 15.5px</option><option value="xlarge">درشت · 17px</option><option value="xxlarge">خیلی درشت · 19px</option></select></div>
            <div class="fld"><label for="sSide">جایگاه سایدبار</label><select id="sSide" onchange="ABSettingsPage.previewUI()"><option value="left">چپ</option><option value="right">راست</option></select></div>
          </div>
          <h4 class="ui-style-heading">حالت مستقل اجزای گفتگو</h4>
          <div class="field-grid ui-style-picks">
            <div class="fld"><label for="sBoxStyle">باکس‌ها و کارت‌های عمومی</label><select id="sBoxStyle" onchange="ABSettingsPage.previewUI()"><option value="outlined">قاب ظریف</option><option value="soft">نرم و برجسته</option><option value="flat">تخت و مینیمال</option><option value="glass">شیشه‌ای · شفاف</option><option value="raised">برجسته · عمق‌دار</option></select></div>
            <div class="fld"><label for="sThinkStyle">ظاهر Think</label><select id="sThinkStyle" onchange="ABSettingsPage.previewUI()"><option value="violet">بنفش کلاسیک</option><option value="focus">Focus · هالهٔ ملایم</option><option value="minimal">مینیمال</option><option value="outline">خط دور رنگی</option><option value="amber">کهربایی · گرم</option></select></div>
            <div class="fld"><label for="sToolStyle">نمایش ابزارها</label><select id="sToolStyle" onchange="ABSettingsPage.previewUI()"><option value="cards">کارت رنگی</option><option value="compact">کارت فشرده</option><option value="minimal">ردیف مینیمال</option><option value="outlined">خطی و شفاف</option><option value="timeline">خط زمانی</option></select></div>
          </div>
        </div>
        <div class="panel rtl">
          <div class="panel-head"><div><h3>نمایش گفتگو</h3><p class="muted">این گزینه‌ها فقط نمایش رابط را تغییر می‌دهند، نه رفتار مدل را.</p></div></div>
          <div class="fld"><label for="sThinkDefault">حالت پیش‌فرض Think برای پیام‌های تازه</label><select id="sThinkDefault" onchange="ABSettingsPage.previewUI()"><option value="closed">بسته</option><option value="half">نیمه‌باز · ۶ خط</option><option value="full">باز کامل</option></select><small>انتخاب دستی هر پیام حفظ می‌شود؛ این مقدار فقط پیش‌فرض پیام‌هایی است که هنوز انتخاب شخصی ندارند.</small></div>
          <h4 class="ui-style-heading">Markdown، ترجمه و رسانه</h4>
          <div class="field-grid ui-content-picks">
            <div class="fld"><label for="sTranslationStyle">پوستهٔ ترجمه</label><select id="sTranslationStyle" onchange="ABSettingsPage.previewUI()"><option value="accent">زمردی · برجسته</option><option value="soft">پس‌زمینهٔ نرم</option><option value="outline">قاب فیروزه‌ای</option><option value="underline">خط زیر رنگی</option><option value="minimal">بی‌قاب و ساده</option><option value="contrast">کنتراست بالا</option></select></div>
            <div class="fld"><label for="sMarkdownStyle">سبک خواندن Markdown</label><select id="sMarkdownStyle" onchange="ABSettingsPage.previewUI()"><option value="reader">Reader · خوانا</option><option value="compact">فشرده</option><option value="editorial">تحریریه‌ای</option><option value="contrast">کنتراست بالا</option><option value="technical">فنی · تک‌فاصله</option></select></div>
            <div class="fld"><label for="sChatMode">چیدمان ترجمهٔ پاسخ</label><select id="sChatMode" onchange="ABSettingsPage.previewUI()"><option value="interleaved">زیرهم · اصلی و ترجمهٔ هر پاراگراف</option><option value="side_by_side">کنارهم · صفحهٔ عریض</option><option value="fa_after">اصل، سپس ترجمه</option><option value="fa_only">فقط فارسی</option><option value="en_only">فقط زبان اصلی</option></select></div>
            <div class="fld"><label for="sParagraphSpacing">فاصلهٔ پاراگراف‌ها</label><select id="sParagraphSpacing" onchange="ABSettingsPage.previewUI()"><option value="snug">خیلی فشرده</option><option value="compact">فشرده</option><option value="comfortable">خوانا · پیش‌فرض</option><option value="airy">باز و فاصله‌دار</option><option value="spacious">خیلی باز</option></select></div>
            <div class="fld"><label for="sImageMode">تصاویر Markdown</label><select id="sImageMode" onchange="ABSettingsPage.previewUI()"><option value="off">پنهان</option><option value="placeholder">جای‌نگهدار · بدون شبکه</option><option value="click">بارگذاری با کلیک · امن‌تر</option><option value="hover">بارگذاری با مکث</option><option value="inline">نمایش خودکار · شبکه</option></select></div>
            <div class="fld"><label for="sImageSize">اندازهٔ تصویرها</label><select id="sImageSize" onchange="ABSettingsPage.previewUI()"><option value="small">ریز · 360px</option><option value="medium">متوسط · 560px</option><option value="large">بزرگ · 760px</option><option value="wide">عریض · 100%</option><option value="viewport">قد صفحه</option></select></div>
            <div class="fld"><label for="sCodeWrap">کدهای بلند</label><select id="sCodeWrap" onchange="ABSettingsPage.previewUI()"><option value="scroll">اسکرول افقی</option><option value="wrap">شکستن خط</option><option value="break">شکستن واژه‌های بلند</option><option value="clip">برش در قاب · بدون اسکرول</option></select></div>
            <div class="fld"><label for="sCodeTheme">قالب کد</label><select id="sCodeTheme" onchange="ABSettingsPage.previewUI()"><option value="midnight">Midnight · تیره</option><option value="surface">هم‌رنگ پوسته</option><option value="graphite">گرافیتی</option><option value="paper">کاغذ روشن</option><option value="neon">نئون · پررنگ</option></select></div>
            <div class="fld"><label for="sToolOutputMode">محتوای ابزارها</label><select id="sToolOutputMode" onchange="ABSettingsPage.previewUI()"><option value="terminal">ترمینال رنگی</option><option value="markdown">Markdown خوانا</option><option value="plain">متن ساده</option><option value="json">JSON ساخت‌یافته</option></select></div>
            <div class="fld"><label class="ui-check-row"><input id="sCodeLines" type="checkbox" onchange="ABSettingsPage.previewUI()"> نمایش شمارهٔ خط کد</label></div>
          </div>
          <div class="os-card" style="margin-top:14px">${[['sThink','نمایش Think',ui.show_think],['sTranslateThink','ترجمه Think',ui.translate_thinking],['sTools','نمایش ابزارها',ui.show_tools],['sTokens','نمایش آمار توکن',ui.show_inline_tokens],['sCost','نمایش هزینه سایه‌ای',ui.show_shadow_cost]].map(([id,label,val])=>`<div class="os-row"><div class="os-row-top"><div class="os-title-wrap">${label}<button class="help-pill" onclick="ABSettingsPage.toggleHelp('help-${id}')">؟ توضیح</button></div><label class="ui-switch"><input id="${id}" type="checkbox" onchange="ABSettingsPage.previewUI()" ${val ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer" id="help-${id}">این گزینه فقط نحوه نمایش/ترجمه در رابط را کنترل می‌کند و موتور مدل را تغییر نمی‌دهد.</div></div>`).join('')}</div>
          <div class="field-grid" style="margin-top:16px"><div class="fld"><label for="sRecentLimit">تعداد درخواست‌های اخیر در Usage</label><input id="sRecentLimit" type="number" min="1" max="100" value="${ui.recent_requests_limit || 10}"></div><div class="fld"><label for="sXrayLimit">سقف قاب‌های X-Ray در حافظه</label><input id="sXrayLimit" type="number" min="1" max="200" value="${ui.xray_limit || 40}"></div></div>
          <div class="ui-presets"><div><strong>یک حال‌وهوای آماده انتخاب کن</strong><small>همهٔ گزینه‌ها بعدش همچنان قابل تغییرند</small></div><div class="ui-preset-buttons"><button type="button" class="ui-preset" onclick="ABSettingsPage.applyPreset('aurora')"><b>✦</b> شفق قطبی</button><button type="button" class="ui-preset" onclick="ABSettingsPage.applyPreset('studio')"><b>▤</b> استودیو</button><button type="button" class="ui-preset" onclick="ABSettingsPage.applyPreset('focus')"><b>◉</b> تمرکز</button><button type="button" class="ui-preset" onclick="ABSettingsPage.applyPreset('paper')"><b>☼</b> کاغذی</button><button type="button" class="ui-preset" onclick="ABSettingsPage.applyPreset('terminal')"><b>⌘</b> ترمینال</button></div></div>
          <div class="ui-theme-preview" aria-live="polite"><div class="ui-preview-top"><span class="ui-preview-dot"></span><strong>پیش‌نمایش زندهٔ همهٔ انتخاب‌ها</strong><small>نمونهٔ واقعی Markdown، ترجمه، تصویر، Think و ابزار</small></div><div class="ui-preview-gallery"><section class="ui-preview-content"><h4>پاسخ، ترجمه، جدول و کد</h4><div id="uiMarkdownPreview" class="ui-markdown-preview"></div><div id="uiImagePreview" class="ui-image-preview"></div></section><section class="ui-preview-elements"><h4>Think و خروجی ابزار</h4><details id="uiThinkPreview" class="ui-preview-think" open><summary>✦ Think · پیش‌نمایش</summary><div class="ui-preview-think-body"><p>مقایسهٔ داده‌ها و بررسی نتیجه…</p><p>شرط وضعیت سرویس برقرار است.</p><p>ساختار پاسخ را بدون تغییر کد نگه می‌دارم.</p><p>محتوای ابزار در نمونهٔ کنار نمایش داده می‌شود.</p><p>خوانایی و فاصله‌ها از تنظیم انتخابی پیروی می‌کنند.</p><p>آمادهٔ پاسخ نهایی هستم.</p><p id="uiThinkTranslation" class="md-body para-fa" dir="rtl" hidden>ترجمهٔ نمایشی Think · این خط فقط در پیش‌نمایش نمونه است.</p></div></details><div id="uiToolPreview"></div><div id="uiPreviewMeta" class="ui-preview-meta"></div></section></div><div id="uiPreviewStatus" class="muted" role="status">تغییرها زنده دیده می‌شوند و تا ذخیره‌سازی موقت‌اند.</div></div>
          <div class="ui-settings-actions"><button class="btn" type="button" onclick="ABSettingsPage.resetUIToDefaults()">بازگردانی پیش‌فرض‌های این بخش</button><button class="btn ghost" type="button" onclick="ABSettingsPage.cancelUIPreview()">لغو تغییرات پیش‌نمایش</button><button class="btn primary" type="button" onclick="ABSettingsPage.saveUI()">ذخیره تنظیمات کاربری</button></div>
        </div>
      </div>`;
      fillUIForm(ui);
      uiPreviewActive = false;
      renderDisplayPreview();
    } else if (route === 'set-tap') {
      const models = c.models || {};
      const vault = state.model_vault || { locked: false, encryption_enabled: false, accounts: [] };
      const localDefault = models.default_mode === 'local';
      host.innerHTML = `<div class="panel-wrap model-settings">
        <div class="panel rtl"><div class="panel-head"><div><h3>اتصال مدل و پیش‌فرض Agent</h3><p class="muted">لوکال پیش‌فرض است. اتصال آنلاین یا fallback فقط با انتخاب و تأیید خودت فعال می‌شود.</p></div></div>
          <div class="fld"><label for="sDefaultMode">منبع پیش‌فرض Agent</label><select id="sDefaultMode"><option value="local" ${localDefault ? 'selected' : ''}>لوکال · llama.cpp / llama-server</option><option value="online" ${!localDefault ? 'selected' : ''}>آنلاین · حساب انتخاب‌شده</option></select></div>
          <div class="os-row" style="margin-top:12px"><div class="os-row-top"><div class="os-title-wrap">اگر مدل لوکال در دسترس نبود، اجازهٔ ارسال درخواست به حساب آنلاین را بده</div><label class="ui-switch"><input id="sOnlineFallback" type="checkbox" ${models.online_fallback ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer open">در fallback، متن درخواست و تاریخچه به سرویس بیرونی می‌رود. تا وقتی این گزینه خاموش است هیچ fallback ابری انجام نمی‌شود.</div></div>
          <div class="model-save-row"><button class="btn primary" onclick="ABSettingsPage.saveModel()">ذخیره پیش‌فرض‌ها</button><span id="modelSaveStatus" class="muted"></span></div>
        </div>
        <div class="models-two-cards">
          <section class="panel rtl">
            <div class="panel-head"><div><h3>مدل لوکال · مسیر اصلی</h3><p>برای llama.cpp یک پورت را وارد کن. سرور تک‌مدلی معمولاً فقط مدل فعال خود را در فهرست می‌دهد؛ router می‌تواند چند شناسه را پشت همان پورت ارائه کند.</p></div></div>
            <div class="fld"><label for="sUpstream">Base URL مدل محلی</label><input id="sUpstream" value="${esc(tap.upstream_url)}" placeholder="http://127.0.0.1:8080"></div>
            <div class="field-grid" style="margin-top:10px"><div class="fld"><label>مدل پیش‌فرض لوکال</label><select id="sLocalModel"><option value="${esc(models.default_model || '')}">${esc(models.default_model || 'ابتدا فهرست مدل‌ها را بخوان')}</option></select></div><div class="fld" style="justify-content:end"><button class="btn" onclick="ABSettingsPage.testModelConnection()">بررسی اتصال و فهرست مدل‌ها</button></div></div>
            <button class="btn" type="button" onclick="ABSettingsPage.testSelectedModel('local')">تست تولید با مدل لوکال انتخاب‌شده</button><div id="modelTestResult" class="mono" role="status" style="margin-top:10px"></div>
            <details class="model-help"><summary>راهنمای llama.cpp و چندمدلی پشت یک پورت</summary><div class="os-help-drawer open">اگر llama-server را با یک فایل مدل و <code>-m</code> اجرا کنی، فهرست <code>/v1/models</code> معمولاً همان مدل فعال را برمی‌گرداند. چند مدل روی یک پورت فقط وقتی ممکن است که router/preset در خود llama.cpp یا یک تجمیع‌گر مثل llama-swap آن‌ها را سرو کند؛ دو فرایند مستقل نمی‌توانند یک پورت را هم‌زمان bind کنند. Bridge فقط فهرست را می‌خواند؛ مدل را دانلود یا بارگذاری نمی‌کند.<pre><code>curl http://127.0.0.1:8080/v1/models</code></pre>برای اجرای محلی نمونهٔ MiniCPM مطابق تنظیم خودت: <code>ai-serve ~/models/minicpm5-2b-heretic-q5_k_m.gguf -fa on -ctk q8_0 -ctv q4_0 -c 98304 -ub 256</code>. مقدار <code>-np 3</code> استفاده نمی‌شود.</div></details>
          </section>
          <section class="panel rtl">
            <div class="panel-head"><div><h3>حساب‌های API آنلاین</h3><p>OpenCode Zen، OpenRouter، Groq، Gemini، NVIDIA NIM یا aggregator سازگار با OpenAI. مدل‌ها زنده از endpoint هر حساب خوانده می‌شوند؛ فهرست رایگان/سهمیه تضمین دائمی نیست.</p></div></div>
            <div class="field-grid"><div class="fld"><label for="sOnlineAccount">حساب پیش‌فرض آنلاین</label><select id="sOnlineAccount">${vault.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id === models.active_account_id ? 'selected' : ''}>${esc(a.label)} · ${esc(state.model_providers?.[a.provider]?.name || a.provider)}</option>`).join('') || '<option value="">حسابی تعریف نشده</option>'}</select></div><div class="fld"><label for="sOnlineModel">مدل آنلاین پیش‌فرض</label><select id="sOnlineModel"><option value="${esc(models.online_model || '')}">${esc(models.online_model || 'فهرست را از حساب بخوان')}</option></select></div></div>
            <div class="model-settings-actions"><button class="btn" onclick="ABSettingsPage.discoverOnlineModels()">دریافت فهرست مدل‌های حساب</button><button class="btn" onclick="ABSettingsPage.testSelectedModel('online')">تست تولید با مدل آنلاین انتخاب‌شده</button><button class="btn" onclick="ABSettingsPage.saveModel()">ثبت مدل انتخاب‌شده به‌عنوان پیش‌فرض</button></div><div id="onlineModelTest" class="muted" role="status"></div>
            <div class="fld" style="margin-top:14px"><label for="sProvider">افزودن / به‌روزرسانی حساب</label><select id="sProvider" onchange="ABSettingsPage.applyProviderDefaults()">${Object.entries(state.model_providers || {}).map(([id,p])=>`<option value="${esc(id)}">${esc(p.name)} · ${esc(p.free_note || '')}</option>`).join('')}</select><a id="modelProviderDocs" class="model-provider-docs" target="_blank" rel="noopener noreferrer">راهنمای رسمی provider</a></div>
            <div class="model-account-form"><input id="sAccountId" type="hidden" value=""><div class="field-grid"><div class="fld"><label for="sAccountLabel">نام دلخواه حساب</label><input id="sAccountLabel" placeholder="مثلاً Groq شخصی"></div><div class="fld"><label for="sAccountKey">API key تازه</label><input id="sAccountKey" type="password" autocomplete="new-password" placeholder="برای ویرایش خالی بگذار تا کلید قبلی حفظ شود"></div></div>
              <div class="field-grid"><div class="fld"><label for="sAccountBaseUrl">Base URL</label><input id="sAccountBaseUrl" placeholder="https://.../v1"></div><div class="fld"><label for="sAccountModelsUrl">Models URL (اختیاری)</label><input id="sAccountModelsUrl" placeholder="خودکار از Base URL گرفته می‌شود"></div><div class="fld"><label for="sAccountProxy">پروکسی این حساب (اختیاری)</label><input id="sAccountProxy" placeholder="http://127.0.0.1:8080"></div></div>
              <div class="model-settings-actions"><button class="btn" type="button" onclick="ABSettingsPage.testOnlineAccount()">تست API key و دریافت مدل‌ها</button><button class="btn" onclick="ABSettingsPage.saveModelAccount()">ذخیرهٔ حساب</button></div><div id="modelAccountSaveStatus" class="muted" role="status"></div><div class="os-help-drawer open">برای OpenCode: کلید را از Console و workspace درست بساز؛ باید دسترسی فهرست مدل‌ها داشته باشد و برای generation نیز Models Request داشته باشد. کلیدهای معمولاً با <code>oc_sk_</code> شروع می‌شوند. مدل‌های Free فقط داخل OpenCode قابل فراخوانی‌اند؛ در Bridge حتی با کلید معتبر ممکن است تست تولید HTTP 403 بدهد. برای Bridge از مدل پولی pay-as-you-go یا Go استفاده کن و قبل از استفاده اعتبار/بودجه را بررسی کن.</div></div>
            <div id="modelAccountsList" class="model-accounts-list">${vault.locked ? 'خزانه قفل است.' : vault.accounts.map(a=>`<div class="model-account-row"><span>${esc(a.label)} · ${esc(state.model_providers?.[a.provider]?.name || a.provider)} ${a.has_key ? '· کلید ذخیره است' : '· بدون کلید'}</span><button class="btn ghost" onclick="ABSettingsPage.editModelAccount('${esc(a.id)}')">ویرایش</button><button class="btn ghost" onclick="ABSettingsPage.deleteModelAccount('${esc(a.id)}')">حذف</button></div>`).join('') || '<p class="muted">حسابی ذخیره نشده است.</p>'}</div>
            <div class="os-row" style="margin-top:12px"><div class="os-row-top"><div class="os-title-wrap">رمزگذاری کلیدهای حساب‌ها با رمز اصلی</div><label class="ui-switch"><input id="sEncryptAccounts" type="checkbox" ${vault.encryption_enabled ? 'checked' : ''} ${vault.locked ? 'disabled' : ''} onchange="ABSettingsPage.changeModelEncryption()"><span class="ui-slider"></span></label></div><div id="modelVaultStatus" class="os-help-drawer open">${vault.locked ? 'خزانه قفل است.' : vault.encryption_enabled ? 'رمزگذاری فعال؛ کلیدها هنگام هر شروع برنامه قفل می‌شوند.' : 'خاموش: کلیدها در .data/model_accounts.json با دسترسی فایل محدود ذخیره می‌شوند. اگر رمزگذاری را روشن کنی، رمز را فراموش نکن؛ بدون آن بازیابی کلیدها ممکن نیست.'}</div></div>
          </section>
        </div>
        <div class="panel rtl"><div class="panel-head"><h3>ابزارهای فقط‌خواندنی Lab</h3></div><div class="os-row"><div class="os-row-top"><div class="os-title-wrap">فعال‌کردن ابزارهای فقط‌خواندنی agent-team</div><label class="ui-switch"><input id="sLabTools" type="checkbox" ${tap.lab_enable_tools ? 'checked' : ''}><span class="ui-slider"></span></label></div><div class="os-help-drawer open">Lab در پوشهٔ جداگانهٔ agent-team می‌ماند؛ shell و نوشتن فایل غیرفعال است.</div></div><div class="fld" style="margin-top:12px"><label>System Prompt برای Lab</label><textarea id="sLabPrompt" rows="4">${esc(tap.lab_system_prompt || '')}</textarea></div></div>
      </div>`;
      refreshProviderAccounts().catch(e => { const out = $('modelAccountSaveStatus'); if (out) out.textContent = e.message; });
      if (models.default_model) testModelConnection();
      if (models.default_mode === 'online' && models.active_account_id) $('sOnlineAccount').value = models.active_account_id;
      applyProviderDefaults();
    } else if (route === 'set-retention') {
      renderCleanupPage(host, state, c);
    }
  }
  return { render, applyPreset, saveTranslation, testConnection, translateSettingsSample, addGlossaryRow, saveGlossary, saveUI, previewUI, cancelUIPreview, resetUIToDefaults, saveModel, testModelConnection, refreshProviderAccounts, applyProviderDefaults, saveModelAccount, editModelAccount, testOnlineAccount, discoverOnlineModels, deleteModelAccount, changeModelEncryption, previewCleanup, runSelectedCleanup, confirmCleanupRun, cancelCleanupRun, saveRetention, switchCleanupTab, setCleanupRange, setCleanupDays, setCleanupScope, filterHistory, cancelHistoryDelete, confirmHistoryDelete, toggleHelp, syncConditional, setSampleTranslationMode };
})();
