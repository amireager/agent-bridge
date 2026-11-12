// Arena-Smooth Chat Page — Fixed Scroll, Paragraph-Interleaved Bilingual Flow & Token Savings
window.ABChatPage = (() => {
  const { esc, api } = window.ABUtils;
  const PERSIAN_SEQ_RE = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:\s+[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;

  let lastTranslatedDraft = '';
  let lastTranslationUsed = false;
  let showMdPreviewInComposer = false;
  let lastSessionId = null;
  let lastTurnCount = 0;
  let stickToBottom = true;
  let contextDetailsOpen = false;

  function getThinkMode(key, defaultMode = 'half') {
    try { return localStorage.getItem(`ab-think:${key}`) || defaultMode; } catch (_) { return defaultMode; }
  }
  function thinkModeControls(key, defaultMode = 'half') {
    const current = getThinkMode(key, defaultMode);
    return `<span class="think-modes"><button class="${current==='closed'?'selected':''}" onclick="ABChatPage.setThinkMode('${esc(key)}','closed',event)" title="بستن کامل">×</button><button class="${current==='half'?'selected':''}" onclick="ABChatPage.setThinkMode('${esc(key)}','half',event)" title="نمایش نیمه، شش خط">۶ خط</button><button class="${current==='full'?'selected':''}" onclick="ABChatPage.setThinkMode('${esc(key)}','full',event)" title="نمایش کامل">باز</button></span>`;
  }

  // Heuristic only: per-character ratios, not the active model's tokenizer.
  function estimateTextTokens(text) {
    const value = String(text || '');
    if (!value) return 0;
    const fa = (value.match(/[\u0600-\u06FF]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    const other = Math.max(0, value.length - fa - latin);
    return Math.max(1, Math.round(fa * 0.68 + latin * 0.25 + other * 0.25));
  }

  function estimateSavings(faText, enText) {
    const rawFaEst = estimateTextTokens(faText);
    const enEst = estimateTextTokens(enText);
    if (!rawFaEst) return null;
    const delta = rawFaEst - enEst;
    const saved = Math.max(0, delta);
    const pct = Math.round((saved / Math.max(1, rawFaEst)) * 100);
    return { rawFaEst, enEst, saved, delta, pct };
  }

  function ensureSkeleton(host) {
    if (host.querySelector('#chatRoot')) return;
    host.innerHTML = `
      <div id="chatRoot" class="chat-root">
        <div id="chatSubBar" class="chat-subbar"></div>
        <div id="chatContextPanel" class="chat-context-panel"></div>
        <div id="selectionTranslatePanel" class="selection-translate" hidden>
          <div class="selection-head"><strong>ترجمه‌ی متن انتخاب‌شده</strong><button class="mini-action" onclick="ABChatPage.closeSelectionTranslate()">×</button></div>
          <select id="selectionEngine" class="btn" aria-label="موتور ترجمهٔ متن انتخاب‌شده"></select>
          <small class="muted">فهرست شامل مسیرهای آنلاین و API آفلاین تنظیم‌شده است؛ فقط پس از زدن دکمه، متن به موتور انتخابی فرستاده می‌شود.</small>
          <div id="selectionSource" class="selection-source"></div>
          <div id="selectionResult" class="selection-result muted">موتور را انتخاب و ترجمه را اجرا کن.</div>
          <button class="btn primary" onclick="ABChatPage.translateSelection()">ترجمه / آزمایش</button>
        </div>

        <div id="chatFeed" class="chat-feed">
          <div id="chatFeedInner" class="chat-feed-inner"></div>
        </div>

        <button id="jumpBottomBtn" class="jump-bottom-btn" onclick="ABChatPage.scrollToBottom(true)">
          ↓ پرش به آخرین پیام
        </button>

        <div class="chat-composer-dock">
          <div class="chat-composer">
            <div id="trChatBubble" class="tr-chat-bubble">
              <div class="tr-bubble-head">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong>پیش‌نمایش انگلیسی ارسالی</strong>
                  <span id="trSavingsBadge" class="kv-pill warm" style="display:none;"></span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;direction:ltr;">
                  <span id="trMetaTag" class="mono muted" style="font-size:10.5px;"></span>
                  <button class="btn ghost" onclick="ABChatPage.toggleComposerMd()">MD</button>
                  <button class="btn ghost" onclick="ABChatPage.copyOutgoing(this)">Copy EN</button>
                  <button class="btn ghost" onclick="ABChatPage.closePreview()">×</button>
                </div>
              </div>

              <textarea id="wireInput" class="tr-editor" placeholder="Translated English prompt (editable)..."></textarea>
              <div id="wireMdPreview" class="tr-md-preview"></div>

              <div id="staleNotice" class="stale-notice">
                <span>متن فارسی تغییر کرد؛ برای به‌روزرسانی ترجمه کلیک کن:</span>
                <button class="btn ghost on" onclick="ABChatPage.translateDraft()">ترجمه مجدد ↻</button>
              </div>

              <div id="persianGuard" class="persian-guard">
                <div id="persianGuardMsg"></div>
                <label class="guard-check-lbl">
                  <input type="checkbox" id="allowPersianCheck" onchange="ABChatPage.validateOutgoing()" />
                  <span>تایید می‌کنم عبارت فارسی بالا عمداً بدون ترجمه ارسال شود</span>
                </label>
              </div>
            </div>

            <div id="sendErrBanner" style="display:none;color:var(--red);font-size:12.2px;direction:rtl;padding:2px 6px;"></div>

            <div class="composer-bar">
              <button id="btnAbortChat" class="btn danger" style="display:none;" onclick="ABChatPage.abort()">توقف</button>
              <button id="btnSendFinal" class="btn primary" onclick="ABChatPage.sendFinal()">ارسال ↵</button>
              <button id="btnTranslateDraft" class="btn" onclick="ABChatPage.translateDraft()">ترجمه پیش‌نمایش</button>
              <textarea id="composerRaw" class="composer-raw" rows="1" placeholder="پیامت را به فارسی (یا همراه با کد) بنویس...  (Ctrl+Enter = ترجمه / ارسال)"></textarea>
            </div>
          </div>
        </div>
      </div>
    `;

    const feed = document.getElementById('chatFeed');
    const jumpBtn = document.getElementById('jumpBottomBtn');
    feed.addEventListener('scroll', () => {
      const dist = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
      stickToBottom = dist < 95;
      jumpBtn.classList.toggle('show', dist > 220);
    });
    const openSelectionPanel = () => {
      const selected = String(window.getSelection?.().toString() || '').trim();
      if (selected.length < 2) return;
      const panel = document.getElementById('selectionTranslatePanel');
      const appState = window.ABApp.getState() || {};
      const tested = appState.tested_translators || [];
      const testedByMode = new Map(tested.map(item => [item.mode === 'online' ? 'builtin-online' : item.mode, item]));
      const options = [
        ['builtin-online', 'آنلاین · خودکار (Google / MyMemory)'],
        ['online-google', 'آنلاین · Google Chrome'],
        ['online-google-gtx', 'آنلاین · Google GTX'],
        ['online-mymemory', 'آنلاین · MyMemory'],
        ['offline', 'آفلاین · API محلی تنظیم‌شده']
      ];
      const configuredEngine = appState.config?.translation?.engine || 'builtin-online';
      const activeMode = configuredEngine === 'custom-offline' ? 'offline' : (options.some(([id]) => id === configuredEngine) ? configuredEngine : 'builtin-online');
      const engine = document.getElementById('selectionEngine');
      engine.innerHTML = options.map(([id, label]) => {
        const test = testedByMode.get(id);
        const status = test ? ` · آزموده ${Number(test.latency_ms || 0)}ms` : ' · آمادهٔ آزمون';
        return `<option value="${esc(id)}" ${id === activeMode ? 'selected' : ''}>${esc(label + status)}</option>`;
      }).join('');
      document.getElementById('selectionSource').textContent = selected.slice(0, 4000);
      document.getElementById('selectionResult').textContent = 'موتور را انتخاب و ترجمه را اجرا کن.';
      panel.hidden = false;
    };
    feed.addEventListener('mouseup', () => setTimeout(openSelectionPanel, 0));
    feed.addEventListener('keyup', openSelectionPanel);

    const rawEl = document.getElementById('composerRaw');
    const wireEl = document.getElementById('wireInput');

    rawEl.addEventListener('input', () => {
      lastTranslationUsed = false;
      rawEl.style.height = 'auto';
      rawEl.style.height = Math.min(150, rawEl.scrollHeight) + 'px';
      const bubble = document.getElementById('trChatBubble');
      if (bubble.classList.contains('open')) {
        const isStale = rawEl.value.trim() !== lastTranslatedDraft;
        document.getElementById('staleNotice').classList.toggle('show', isStale);
      }
    });

    rawEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const trOn = window.ABApp.getState()?.config?.translation?.enabled !== false;
        const bubbleOpen = document.getElementById('trChatBubble').classList.contains('open');
        if (trOn && !bubbleOpen && findPersianMatches(rawEl.value).length > 0) translateDraft();
        else sendFinal();
      }
    });

    wireEl.addEventListener('input', () => {
      validateOutgoing();
      updateSavingsPill(rawEl.value, wireEl.value);
      if (showMdPreviewInComposer) {
        document.getElementById('wireMdPreview').innerHTML = window.ABMarkdown.render(wireEl.value);
      }
    });
  }

  function scrollToBottom(smooth = false) {
    const feed = document.getElementById('chatFeed');
    if (!feed) return;
    stickToBottom = true;
    feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    document.getElementById('jumpBottomBtn')?.classList.remove('show');
  }

  function updateSavingsPill(faTxt, enTxt) {
    const pill = document.getElementById('trSavingsBadge');
    if (!pill) return;
    const sv = estimateSavings(faTxt, enTxt);
    if (sv && (sv.saved > 0 || sv.delta < 0)) {
      pill.style.display = 'inline-flex';
      pill.textContent = sv.delta > 0
        ? `ورودی کاربر: ~${sv.rawFaEst} → ~${sv.enEst} · کاهش تخمینی ~${sv.saved} توکن`
        : `ورودی کاربر: ~${sv.rawFaEst} → ~${sv.enEst} · افزایش تخمینی ~${Math.abs(sv.delta)} توکن`;
    } else {
      pill.style.display = 'none';
    }
  }

  function findPersianMatches(text) {
    return (String(text || '').match(PERSIAN_SEQ_RE) || []).slice(0, 4);
  }

  function validateOutgoing() {
    const wireTxt = document.getElementById('wireInput')?.value || '';
    const guardEl = document.getElementById('persianGuard');
    const msgEl = document.getElementById('persianGuardMsg');
    const chkEl = document.getElementById('allowPersianCheck');
    const matches = findPersianMatches(wireTxt);

    if (matches.length > 0) {
      const quoted = matches.map(m => `«${esc(m)}»`).join(' ، ');
      msgEl.innerHTML = `⚠ <strong>کاراکتر فارسی در متن خروجی دیده شد:</strong> ${quoted} — اصلاحش کن یا در صورت عمدی بودن تیک زیر را بزن:`;
      guardEl.classList.add('show');
      return !!chkEl.checked;
    }
    guardEl.classList.remove('show');
    if (chkEl) chkEl.checked = false;
    return true;
  }

  function toggleComposerMd() {
    showMdPreviewInComposer = !showMdPreviewInComposer;
    const mdEl = document.getElementById('wireMdPreview');
    mdEl.classList.toggle('open', showMdPreviewInComposer);
    if (showMdPreviewInComposer) {
      mdEl.innerHTML = window.ABMarkdown.render(document.getElementById('wireInput').value);
    }
  }

  function closePreview() {
    document.getElementById('trChatBubble')?.classList.remove('open');
    document.getElementById('staleNotice')?.classList.remove('show');
    document.getElementById('persianGuard')?.classList.remove('show');
  }

  function copyOutgoing(btn) {
    const txt = document.getElementById('wireInput')?.value || '';
    if (!txt) return;
    navigator.clipboard?.writeText(txt);
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  async function translateDraft() {
    const rawEl = document.getElementById('composerRaw');
    const wireEl = document.getElementById('wireInput');
    const raw = rawEl.value.trim();
    if (!raw) return;

    document.getElementById('sendErrBanner').style.display = 'none';
    document.getElementById('trChatBubble').classList.add('open');
    document.getElementById('trMetaTag').textContent = 'translating...';

    const res = await api('/api/translate', { text: raw, to: 'en' });
    if (res.error) {
      document.getElementById('trMetaTag').textContent = 'ERR';
      const errEl = document.getElementById('sendErrBanner');
      errEl.textContent = `خطای مترجم: ${res.error}`;
      errEl.style.display = 'block';
      return;
    }
    wireEl.value = res.translation || raw;
    lastTranslatedDraft = raw;
    lastTranslationUsed = true;
    document.getElementById('staleNotice').classList.remove('show');
    document.getElementById('trMetaTag').textContent = `${res.engine} · ${res.elapsed_ms}ms`;
    updateSavingsPill(raw, wireEl.value);

    if (showMdPreviewInComposer) {
      document.getElementById('wireMdPreview').innerHTML = window.ABMarkdown.render(wireEl.value);
    }
    validateOutgoing();
    wireEl.focus();
  }

  async function sendFinal() {
    const rawEl = document.getElementById('composerRaw');
    const wireEl = document.getElementById('wireInput');
    const bubble = document.getElementById('trChatBubble');
    const errEl = document.getElementById('sendErrBanner');
    errEl.style.display = 'none';

    const st = window.ABApp.getState();
    const trEnabled = st?.config?.translation?.enabled !== false;
    const rawTxt = rawEl.value.trim();

    if (!trEnabled) {
      // Pure Proxy Mode: send directly without translation!
      if (!rawTxt) return;
      const res = await api('/api/prompt', {
        user_raw: rawTxt,
        prompt_sent: rawTxt,
        allow_persian: true,
        translation_used: false,
        source: 'web',
        agent_id: st?.active_agent
      });
      if (!res.ok) {
        navigator.clipboard?.writeText(rawTxt);
        errEl.textContent = res.error;
        errEl.style.display = 'block';
        return;
      }
      rawEl.value = '';
      rawEl.style.height = 'auto';
      scrollToBottom(true);
      return;
    }

    if (!bubble.classList.contains('open') || !wireEl.value.trim()) {
      if (!rawTxt) return;
      if (findPersianMatches(rawTxt).length > 0) {
        await translateDraft();
        return;
      }
      wireEl.value = rawTxt;
      lastTranslatedDraft = rawTxt;
      lastTranslationUsed = false;
      bubble.classList.add('open');
    }

    if (rawTxt && rawTxt !== lastTranslatedDraft && findPersianMatches(rawTxt).length > 0 && !document.getElementById('allowPersianCheck').checked) {
      document.getElementById('staleNotice').classList.add('show');
      await translateDraft();
      return;
    }

    if (!validateOutgoing()) {
      const g = document.getElementById('persianGuard');
      g.classList.remove('shake');
      void g.offsetWidth;
      g.classList.add('shake');
      return;
    }

    const outgoingEn = wireEl.value.trim();
    const allowFa = !!document.getElementById('allowPersianCheck')?.checked;

    const res = await api('/api/prompt', {
      user_raw: rawTxt || outgoingEn,
      prompt_sent: outgoingEn,
      allow_persian: allowFa,
      translation_used: lastTranslationUsed,
      source: 'web',
      agent_id: st?.active_agent
    });

    if (!res.ok) {
      navigator.clipboard?.writeText(outgoingEn);
      errEl.textContent = res.error;
      errEl.style.display = 'block';
      return;
    }

    rawEl.value = '';
    rawEl.style.height = 'auto';
    wireEl.value = '';
    lastTranslatedDraft = '';
    lastTranslationUsed = false;
    if (document.getElementById('allowPersianCheck')) {
      document.getElementById('allowPersianCheck').checked = false;
    }
    closePreview();
    scrollToBottom(true);
  }

  async function setChatMode(mode) {
    await api('/api/config', { ui: { chat_mode: mode } });
  }

  async function toggleUiFlag(key) {
    const cur = window.ABApp.getState()?.config?.ui?.[key];
    await api('/api/config', { ui: { [key]: !cur } });
  }

  function setThinkMode(key, mode, ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (!['closed','half','full'].includes(mode)) return;
    try { localStorage.setItem(`ab-think:${key}`, mode); } catch (_) {}
    const details = ev?.target?.closest('details.think-drawer');
    if (details) {
      details.classList.remove('think-mode-closed','think-mode-half','think-mode-full');
      details.classList.add(`think-mode-${mode}`);
      details.open = mode !== 'closed';
    }
  }

  function closeSelectionTranslate() {
    document.getElementById('selectionTranslatePanel').hidden = true;
    window.getSelection?.().removeAllRanges();
  }

  async function translateSelection() {
    const text = document.getElementById('selectionSource').textContent || '';
    const engineMode = document.getElementById('selectionEngine').value;
    const out = document.getElementById('selectionResult');
    if (!engineMode) { out.textContent = 'ابتدا در Settings موتور را تست کن.'; return; }
    out.textContent = 'در حال ترجمه...';
    try {
      const res = await api('/api/translate', { text, to: 'auto', engine_mode: engineMode });
      out.innerHTML = res.error ? `<span class="term-error">${esc(res.error)}</span>` : window.ABMarkdown.render(res.translation || '');
    } catch (error) {
      out.innerHTML = `<span class="term-error">ترجمه ناموفق بود · ${esc(error.message || error)}</span>`;
    }
  }

  async function translatePrompt(turnId, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/turn/translate', { turn_id: turnId, scope: 'prompt' });
  }

  async function retranslate(turnId) {
    await api('/api/turn/translate', { turn_id: turnId, scope: 'reply' });
  }

  async function translateThink(turnId, stepIndex = -1, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/turn/translate', {
      turn_id: turnId,
      scope: stepIndex >= 0 ? 'step-think' : 'think',
      step_index: stepIndex
    });
  }

  async function abort() {
    await api('/api/abort', {});
  }

  function summarizeToolArgs(tl) {
    const a = tl.args || {};
    if (typeof a === 'string') return a.slice(0, 74);
    if (a.command) return `$ ${String(a.command).replace(/\\s+/g, ' ').slice(0, 74)}`;
    if (a.path) return a.path;
    return JSON.stringify(a).slice(0, 72);
  }

  function formatToolBody(tl) {
    const a = tl.args || {};
    let head = typeof a === 'string' ? a : JSON.stringify(a, null, 2);
    if (a.command) head = `$ ${a.command}`;
    else if (a.path && !a.content) head = `${tl.name || 'file'}  ${a.path}`;
    if (tl.name === 'write' && a.content) {
      head = `// file: ${a.path || ''}\n${a.content}`;
    } else if (tl.name === 'edit' && (a.oldText || a.newText)) {
      head = `--- old\n${a.oldText || ''}\n+++ new\n${a.newText || ''}`;
    }
    return `${head}${tl.output ? `\n\n// output\n${tl.output}` : ''}`;
  }

  function renderToolContent(tl, displayMode = 'terminal') {
    if (displayMode === 'json') {
      const args = tl.args || {};
      const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
      const raw = typeof tl.output === 'string' ? tl.output : JSON.stringify(tl.output ?? '', null, 2);
      let output;
      try { output = JSON.stringify(JSON.parse(raw), null, 2); } catch (_) { output = raw; }
      return `<div class="tool-readable-content"><details class="tool-args"><summary>ورودی ساخت‌یافتهٔ ابزار · ${esc(tl.name || 'tool')}</summary><pre>${esc(argsText || '')}</pre></details><pre class="tool-plain-body tool-json-output">${esc(output || 'خروجی ساخت‌یافته‌ای ندارد.')}</pre></div>`;
    }
    if (displayMode === 'plain') {
      const args = tl.args || {};
      const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
      const output = typeof tl.output === 'string' ? tl.output : JSON.stringify(tl.output ?? '', null, 2);
      return `<div class="tool-readable-content tool-plain-output"><details class="tool-args"><summary>ورودی ابزار · ${esc(tl.name || 'tool')}</summary><pre>${esc(argsText || '')}</pre></details><pre class="tool-plain-body">${esc(output || 'خروجی متنی ندارد.')}</pre></div>`;
    }
    if (displayMode === 'markdown') {
      const args = tl.args || {};
      const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
      const output = typeof tl.output === 'string' ? tl.output : JSON.stringify(tl.output ?? '', null, 2);
      return `<div class="tool-readable-content"><details class="tool-args"><summary>ورودی ابزار · ${esc(tl.name || 'tool')}</summary><pre>${esc(argsText || '')}</pre></details>${output ? `<div class="tool-markdown-output">${window.ABMarkdown.render(output)}</div>` : '<p class="muted">خروجی متنی ندارد.</p>'}</div>`;
    }
    const safe = esc(formatToolBody(tl));
    const highlighted = safe
      .replace(/(^|\s)(sudo|cd|ls|cat|grep|find|git|python3?|nix|curl|mkdir|rm|cp|mv|pytest|node)(?=\s|$)/gm, '$1<span class="term-command">$2</span>')
      .replace(/(--[a-zA-Z0-9_-]+)/g, '<span class="term-flag">$1</span>')
      .replace(/(https?:\/\/[^\s]+)/g, '<span class="term-url">$1</span>')
      .replace(/(\$HOME|~\/[\w./-]+|\/[\w./-]+)/g, '<span class="term-path">$1</span>');
    const rows = highlighted.split('\n').map((line, i) => `<div class="term-line"><span class="term-ln">${i + 1}</span><code>${line || ' '}</code></div>`).join('');
    return `<div class="terminal-view"><div class="terminal-chrome"><i></i><i></i><i></i><span>${esc(tl.name || 'tool')} · ${esc(tl.status || 'done')}</span></div><div class="terminal-content">${rows}</div></div>`;
  }

  function formatCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n).toLocaleString() : '—';
  }

  function renderContextPanel(state, turns) {
    const panel = document.getElementById('chatContextPanel');
    if (!panel) return;
    const latest = turns[turns.length - 1] || {};
    const metrics = latest.metrics || {};
    const context = latest.context_usage || {};
    const limit = Number(context.limit_tokens || 0);
    const used = Number(context.used_tokens || 0);
    const reported = context.reported === true && limit > 0 && used >= 0;
    const pct = reported ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
    const remaining = reported ? Math.max(0, limit - used) : 0;
    const totalInput = Number(metrics.uncached_in || 0) + Number(metrics.cached_in || 0);
    const output = Number(metrics.out_tok || 0);
    const inputRecorded = context.prompt_reported === true;
    const outputRecorded = context.output_reported === true;
    const routeMode = state.config?.models?.default_mode === 'online' ? 'آنلاین' : 'محلی';
    const modelName = latest.model || state.upstream?.detected_model || 'مدل انتخاب نشده';
    const stateLabel = state.session_state && state.session_state !== 'IDLE'
      ? (state.session_state === 'STREAMING' ? 'در حال پاسخ' : 'در حال اجرا')
      : (turns.length ? 'آماده' : 'آمادهٔ شروع');
    const statusClass = state.session_state && state.session_state !== 'IDLE' ? 'is-running' : 'is-idle';
    const percentLabel = reported ? `${pct}٪` : 'داده‌ای ثبت نشده';
    const usedLabel = reported ? `${formatCount(used)} / ${formatCount(limit)}` : 'پس از نخستین درخواست';
    const detailsWasOpen = panel.querySelector('.context-details')?.open ?? contextDetailsOpen;

    panel.innerHTML = `
      <section class="context-card" aria-label="مصرف زمینهٔ مدل">
        <div class="context-card-main">
          <div class="context-ident">
            <span class="context-icon" aria-hidden="true">◉</span>
            <div class="context-titles">
              <div class="context-title-row"><strong>زمینهٔ مدل</strong><span class="context-state ${statusClass}"><i></i>${esc(stateLabel)}</span></div>
              <div class="context-model-line"><span>${esc(modelName)}</span><span class="context-route">${routeMode}</span></div>
            </div>
          </div>
          <div class="context-meter-block">
            <div class="context-meter-labels"><span>${reported ? 'مصرف‌شدهٔ درخواست اخیر' : 'ظرفیت زمینه'}</span><strong>${usedLabel}</strong></div>
            <div class="context-meter" role="progressbar" aria-label="درصد مصرف زمینه" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
            <div class="context-meter-foot"><span>${reported ? `${percentLabel} مصرف` : 'شمارندهٔ دقیق پس از گزارش runtime نمایش داده می‌شود'}</span><span>${reported ? `${formatCount(remaining)} توکن برآوردی باقی‌مانده` : 'بدون تخمین ساختگی'}</span></div>
          </div>
        </div>
        <details class="context-details" ${detailsWasOpen ? 'open' : ''}>
          <summary><span>گزارش مصرف</span><span class="context-details-hint">${turns.length ? `نوبت ${turns.length}` : 'هنوز درخواستی نیست'}</span></summary>
          <div class="context-breakdown">
            <div><span>ورودی درخواست اخیر</span><strong>${inputRecorded ? `${formatCount(context.prompt_tokens)} توکن` : 'در دسترس نیست'}</strong></div>
            <div><span>ورودی cache‌شده · کل نوبت</span><strong>${formatCount(metrics.cached_in)} توکن</strong></div>
            <div><span>ورودی بدون cache · کل نوبت</span><strong>${formatCount(metrics.uncached_in)} توکن</strong></div>
            <div><span>خروجی درخواست اخیر</span><strong>${outputRecorded ? `${formatCount(context.output_tokens)} توکن` : 'در دسترس نیست'}</strong></div>
            <div><span>خروجی کل نوبت</span><strong>${output ? `${formatCount(output)} توکن` : 'در دسترس نیست'}</strong></div>
            <div><span>ظرفیت زمینه</span><strong>${limit ? `${formatCount(limit)} توکن` : 'از مدل گزارش نشده'}</strong></div>
            <div><span>باقی‌مانده</span><strong>${reported ? `~${formatCount(remaining)} توکن` : 'قابل محاسبه نیست'}</strong></div>
            <p>${reported ? 'مصرف بر پایهٔ شمارندهٔ واقعی مدل است؛ باقی‌مانده برای درخواست اخیر برآورد می‌شود و تضمین ظرفیت پاسخ بعدی نیست.' : 'Agent Bridge فقط شمارنده‌هایی را نشان می‌دهد که مدل یا runtime واقعاً گزارش کرده باشد؛ برآورد متنی با شمارندهٔ tokenizer یکی نیست.'}</p>
          </div>
        </details>
      </section>`;
    const details = panel.querySelector('.context-details');
    details?.addEventListener('toggle', () => { contextDetailsOpen = details.open; });
  }

  function useStarter(text) {
    const input = document.getElementById('composerRaw');
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function render(host, state, forceFull = false) {
    if (forceFull) host.innerHTML = '';
    ensureSkeleton(host);

    const ui = state.config.ui || {};
    const trEnabled = state.config.translation.enabled !== false;
    const chatMode = !trEnabled ? 'en_only' : (ui.chat_mode || 'interleaved');

    document.getElementById('btnTranslateDraft').style.display = trEnabled ? 'inline-flex' : 'none';

    const chatTurns = state.active_conversation?.turns || [];
    const isLabView = state.view_kind === 'lab';
    const currentModel = chatTurns.at(-1)?.model || state.upstream?.detected_model || 'مدل انتخاب نشده';
    const routeLabel = state.config?.models?.default_mode === 'online' ? 'آنلاین' : (state.upstream?.online ? 'مدل محلی' : 'مدل در دسترس نیست');
    const statusLabel = state.session_state && !['IDLE','ERROR'].includes(state.session_state) ? 'در حال اجرا' : 'آماده';
    document.getElementById('chatSubBar').innerHTML = `
      <div class="chat-heading-row">
        <div class="chat-heading-copy">
          <span class="chat-eyebrow">AGENT BRIDGE · CHAT</span>
          <h1>گفت‌وگو</h1>
          <p>ترجمهٔ قابل‌بازبینی و آزمایش مستقیم مدل؛ ابزارهای سیستمی در این گفتگو فعال نیستند.</p>
        </div>
        <div class="chat-heading-meta">
          <span class="chat-model-chip"><i class="model-status-dot ${state.upstream?.online ? 'online' : ''}"></i><span>${esc(currentModel)}</span><small>${routeLabel}</small></span>
          <span class="chat-live-status ${state.session_state && !['IDLE','ERROR'].includes(state.session_state) ? 'busy' : ''}"><i></i>${statusLabel}</span>
        </div>
      </div>
      <div class="chat-toolbar-row">
        <div class="chat-translation-state"><span class="translation-state-dot ${trEnabled ? 'enabled' : ''}"></span><span>${trEnabled ? 'ترجمهٔ ورودی فعال' : 'ترجمه خاموش'}</span><span class="toolbar-separator">·</span><span>${esc(routeLabel)}</span></div>
        <div class="chat-toolbar-actions">
          <button class="chat-translation-toggle ${trEnabled ? 'is-on' : ''}" type="button" onclick="ABApp.toggleProxyMode()">${trEnabled ? 'ترجمه روشن' : 'ترجمه خاموش'}</button>
          <details class="chat-display-menu"><summary>نمایش و ترجمه <span>⌄</span></summary><div class="chat-display-menu-popover">
            <strong>شیوهٔ نمایش پاسخ</strong>
            <div class="seg-group" title="متن اصلی و ترجمه را بدون جایگزینی متن کاربر نمایش می‌دهد">
              <button class="seg-btn ${chatMode === 'interleaved' ? 'on' : ''}" onclick="ABChatPage.setChatMode('interleaved')">همراه ترجمه</button>
              <button class="seg-btn ${chatMode === 'fa_only' ? 'on' : ''}" onclick="ABChatPage.setChatMode('fa_only')">فارسی</button>
              <button class="seg-btn ${chatMode === 'fa_after' ? 'on' : ''}" onclick="ABChatPage.setChatMode('fa_after')">اصل سپس ترجمه</button>
              <button class="seg-btn ${chatMode === 'side_by_side' ? 'on' : ''}" onclick="ABChatPage.setChatMode('side_by_side')">کنار هم</button>
              <button class="seg-btn ${chatMode === 'en_only' ? 'on' : ''}" onclick="ABChatPage.setChatMode('en_only')">اصل</button>
            </div>
            <div class="chat-display-toggles"><button class="btn ghost ${ui.show_think ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_think')">Think</button>${isLabView ? '' : `<button class="btn ghost ${ui.show_tools ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_tools')">رویدادهای ابزار</button>`}</div>
          </div></details>
          <span class="chat-conversation-count">${chatTurns.length ? `${chatTurns.length} نوبت` : 'گفتگوی تازه'}</span>
        </div>
      </div>
    `;

    const isBusy = state.session_state !== 'IDLE' && state.session_state !== 'ERROR';
    document.getElementById('btnAbortChat').style.display = isBusy ? 'inline-flex' : 'none';

    const feed = document.getElementById('chatFeed');
    const feedInner = document.getElementById('chatFeedInner');
    const sessId = `${state.view_kind || 'mirror'}:${state.view_id || ''}`;
    const turns = state.active_conversation?.turns || [];
    renderContextPanel(state, turns);

    // Capture open <details> IDs & scroll position BEFORE updating DOM
    const prevScrollTop = feed.scrollTop;
    const detailsState = new Map(
      [...feedInner.querySelectorAll('details[data-acc-id]')].map(d => [d.getAttribute('data-acc-id'), d.open])
    );
    const wasOpen = (id, defaultOpen = false) => detailsState.has(id) ? detailsState.get(id) : defaultOpen;

    if (!turns.length) {
      const isLab = state.view_kind === 'lab';
      feedInner.innerHTML = isLab ? `
        <section class="chat-welcome" aria-label="شروع گفت‌وگوی تازه">
          <div class="welcome-mark" aria-hidden="true"><span>AB</span><i></i></div>
          <span class="welcome-kicker">LOCAL-FIRST MODEL CHAT</span>
          <h2>یک گفت‌وگوی روشن،<br><em>بدون شلوغی اضافه.</em></h2>
          <p>به زبان خودت بنویس. متن اصلی حفظ می‌شود و پیش از ارسال می‌توانی ترجمهٔ انگلیسی را بازبینی کنی.</p>
          <div class="welcome-capabilities"><span>ترجمهٔ قابل‌بازبینی</span><span>پاسخ زنده</span><span>بدون دسترسی سیستمی</span></div>
          <div class="welcome-examples"><button type="button" onclick="ABChatPage.useStarter('این پاسخ را به زبان ساده توضیح بده.')"><span>ساده‌سازی</span><small>این پاسخ را به زبان ساده توضیح بده</small><b>↗</b></button><button type="button" onclick="ABChatPage.useStarter('این دو گزینه را با مزایا و محدودیت‌هایشان مقایسه کن.')"><span>مقایسه</span><small>این دو گزینه را با مزایا و محدودیت‌هایشان مقایسه کن</small><b>↗</b></button><button type="button" onclick="ABChatPage.useStarter('برای این موضوع یک توضیح کوتاه و دقیق بنویس.')"><span>پرسش</span><small>یک توضیح کوتاه و دقیق بخواه</small><b>↗</b></button></div>
        </section>` : `
        <section class="chat-welcome chat-welcome-mirror" aria-label="در انتظار نشست عامل">
          <div class="welcome-mark" aria-hidden="true"><span>AB</span><i></i></div>
          <span class="welcome-kicker">LIVE AGENT MIRROR</span>
          <h2>در انتظار رویدادهای نشست</h2>
          <p>این نما آینهٔ ترمینال‌های متصل است؛ برای گفت‌وگوی مستقیم، یک نشست Lab را از فهرست کناری انتخاب کن.</p>
          <div class="mirror-command"><span>اجرای عامل با آینهٔ مستقل</span><code>python3 cli.py --wrap pi</code></div>
        </section>`;
      lastSessionId = sessId;
      lastTurnCount = 0;
      return;
    }

    feedInner.innerHTML = turns.map((t, idx) => {
      const m = t.metrics || {};
      const totIn = (m.cached_in || 0) + (m.uncached_in || 0);
      const kvPct = totIn > 0 ? Math.round((m.cached_in / totIn) * 100) : 0;
      const kvState = t.kv_status || (kvPct >= 75 ? 'warm' : (kvPct >= 25 ? 'partial' : 'cold'));
      const kvLabel = kvState === 'flush' ? 'KV FLUSH!' : `KV ${kvPct}%`;

      const tokStr = ui.show_inline_tokens
        ? `in:${(m.uncached_in || 0).toLocaleString()} · kv:${(m.cached_in || 0).toLocaleString()} · out:${(m.out_tok || 0).toLocaleString()} · ${m.tg_tps || 0} t/s`
        : `${t.elapsed_s || 0}s`;

      const wireId = `${t.id}-wire`;
      const wireAcc = (ui.show_wire_en && t.prompt_sent && t.prompt_sent !== t.user_raw) ? `
        <details class="trace-acc" data-acc-id="${esc(wireId)}" ${wasOpen(wireId, true) ? 'open' : ''} style="margin-top:8px;">
          <summary>
            <span>Sent English Prompt</span>
            <span class="muted">${t.prompt_sent.length} chars</span>
          </summary>
          <div class="acc-body">${esc(t.prompt_sent)}</div>
        </details>` : '';

      const thinkId = `${t.id}-think`;
      const globalThinkMode = getThinkMode(thinkId, ui.think_default_mode || 'half');
      const thinkAcc = (ui.show_think && t.thinking) ? `
        <details class="think-drawer think-mode-${globalThinkMode}" data-acc-id="${esc(thinkId)}" ${globalThinkMode !== 'closed' ? 'open' : ''}>
          <summary><span>تفکر مدل · Think · ${t.thinking.length} chars</span>${thinkModeControls(thinkId, ui.think_default_mode || 'half')}</summary>
          <div class="think-body">${window.ABMarkdown.renderBlocks(t.think_blocks || [], t.thinking, t.thinking_fa || '', chatMode)}<button class="btn ghost think-translate-btn" onclick="ABChatPage.translateThink('${esc(t.id)}',-1,event)">${t.thinking_fa ? 'ترجمه‌ی مجدد تفکر' : 'ترجمه‌ی تفکر'}</button></div>
        </details>` : '';

      const toolsAcc = (!isLabView && ui.show_tools) ? (t.tools || []).map((tl, tIdx) => {
        const cls = tl.status === 'running' ? 'run' : (tl.is_error ? 'err' : 'ok');
        const stTxt = tl.status === 'running' ? 'RUN' : (tl.is_error ? 'ERR' : 'OK');
        const detId = `${t.id}-tool-${tIdx}`;
        const isOpen = wasOpen(detId, tl.status === 'running');
        const toolName = String(tl.name || 'tool');
        const kind = /shell|bash|terminal|exec/i.test(toolName) ? 'shell' : (/read|list|search/i.test(toolName) ? 'read' : (/edit|write|patch/i.test(toolName) ? 'edit' : 'other'));
        return `
          <details class="tool-pill kind-${kind}" data-acc-id="${esc(detId)}" ${isOpen ? 'open' : ''}>
            <summary><span class="tool-badge">${esc(toolName)}</span><span class="tool-cmd-preview">${esc(summarizeToolArgs(tl))}</span><span class="tiny-tag">${stTxt}</span></summary>
            <div class="tool-render">${renderToolContent(tl, ui.tool_output_mode || 'terminal')}</div>
          </details>`;
      }).join('') : '';

      const stepTimeline = (Array.isArray(t.steps) && t.steps.length) ? t.steps.map((step, sIdx) => {
        const stepThinkId = `${t.id}-step-${sIdx}-think`;
        const stepThinkMode = getThinkMode(stepThinkId, ui.think_default_mode || 'half');
        const stageId = `${t.id}-stage-${sIdx}`;
        const stepTools = (!isLabView && ui.show_tools) ? (step.tools || []).map((tool, tIdx) => {
          const nm = String(tool.name || 'tool');
          const kind = /shell|bash|terminal|exec/i.test(nm) ? 'shell' : (/read|list|search/i.test(nm) ? 'read' : (/edit|write|patch/i.test(nm) ? 'edit' : 'other'));
          const toolId = `${t.id}-step-${sIdx}-tool-${tIdx}`;
          return `<details class="tool-pill kind-${kind}" data-acc-id="${esc(toolId)}"><summary><span class="tool-badge">${esc(nm)}</span><span class="tool-cmd-preview">${esc(summarizeToolArgs(tool))}</span><span class="tiny-tag">${esc(tool.status || 'done')}</span></summary><div class="tool-render">${renderToolContent(tool, ui.tool_output_mode || 'terminal')}</div></details>`;
        }).join('') : '';
        const reasoning = ui.show_think && step.thinking ? `<details class="think-drawer think-mode-${stepThinkMode}" data-acc-id="${esc(stepThinkId)}" ${stepThinkMode !== 'closed' ? 'open' : ''}><summary><span>تفکر · مرحله ${sIdx + 1} · ${step.thinking.length} chars</span>${thinkModeControls(stepThinkId, ui.think_default_mode || 'half')}</summary><div class="think-body md-body">${window.ABMarkdown.render(step.thinking)}${step.thinking_fa ? `<div class="think-translation">${window.ABMarkdown.render(step.thinking_fa)}</div>` : ''}<button class="btn ghost think-translate-btn" onclick="ABChatPage.translateThink('${esc(t.id)}',${sIdx},event)">${step.thinking_fa ? 'ترجمه دوباره' : 'ترجمه‌ی این مرحله'}</button></div></details>` : '';
        return `<details class="agent-step" data-acc-id="${esc(stageId)}" ${wasOpen(stageId, true) ? 'open' : ''}><summary class="step-label">مرحله ${sIdx + 1} · ${esc(step.status || 'در حال اجرا')} · تفکر و ابزارهای این دور</summary><div class="step-content">${reasoning}${stepTools}</div></details>`;
      }).join('') : '';

      const bodyContent = (t.reply_en || (t.blocks && t.blocks.length))
        ? window.ABMarkdown.renderBlocks(t.blocks, t.reply_en, t.reply_fa, chatMode)
        : (t.tools?.length && isLabView
          ? '<div class="mono muted">در این نشست قدیمی رویداد ابزار ثبت شده؛ ابزارهای سیستم در گفت‌وگوی فعلی غیرفعال‌اند.</div>'
          : (t.tools?.length ? '' : '<div class="mono muted">[در حال دریافت پاسخ مدل...]</div>'));

      const src = (t.source || 'web').toUpperCase();
      const inputEst = t.token_estimates || {};
      const inputSourceTokens = Number(inputEst.input_source_tokens ?? estimateTextTokens(t.user_raw));
      const inputSentTokens = Number(inputEst.input_sent_tokens ?? estimateTextTokens(t.prompt_sent || t.user_raw));
      const inputDelta = Number(inputEst.input_delta_tokens ?? (inputSourceTokens - inputSentTokens));
      const inputDeltaLabel = inputDelta > 0 ? `صرفه‌جویی ~${inputDelta}` : inputDelta < 0 ? `افزایش ~${Math.abs(inputDelta)}` : 'بدون اختلاف تخمینی';
      const savedPill = t.user_raw
        ? `<span title="برآورد نویسه‌ای، نه شمارندهٔ tokenizer مدل">ورودی کاربر: ~${inputSourceTokens} → ~${inputSentTokens} · ${inputDeltaLabel} tok</span>`
        : `<span>${esc(t.ts)}</span>`;
      const outputTextEstimate = Number(inputEst.model_output_text_tokens ?? estimateTextTokens(t.reply_en));
      const outputPersianEstimate = Number(inputEst.persian_display_tokens ?? estimateTextTokens(t.reply_fa));

      return `
        <article class="turn-card">
          ${t.user_raw ? `
            <div class="user-bubble-row">
              <details class="prompt-fold" data-acc-id="${esc(t.id)}-prompt" ${wasOpen(`${t.id}-prompt`, true) ? 'open' : ''}>
                <summary><span>پرامپت شما · ${String(t.user_raw || '').length} نویسه</span><span>${esc(src)} · باز/بسته</span></summary>
                <div class="user-bubble">
                  ${window.ABMarkdown.render(t.user_raw)}
                  <button class="btn ghost prompt-translate-btn" onclick="ABChatPage.translatePrompt('${esc(t.id)}',event)">${t.prompt_translation ? 'ترجمه‌ی ورودی دوباره' : 'ترجمه‌ی همین پرامپت'}</button>
                  ${t.prompt_translation ? `<div class="prompt-translation">${window.ABMarkdown.render(t.prompt_translation)}</div>` : ''}
                  <div class="user-bubble-meta">
                    <span>#${String(idx + 1).padStart(2, '0')} · <span class="src-badge ${src !== 'WEB' ? 'cli' : ''}">${esc(src)}</span></span>
                    ${savedPill}
                  </div>
                  ${wireAcc}
                </div>
              </details>
            </div>` : ''}

          <details class="assistant-fold" data-acc-id="${esc(t.id)}-message" ${wasOpen(`${t.id}-message`, true) ? 'open' : ''}>
            <summary class="assistant-fold-head"><span>پاسخ ${esc(t.model || t.agent || 'مدل')} · ${esc(tokStr)}</span><span class="kv-pill ${esc(kvState)}">${esc(kvLabel)} · باز/بسته</span></summary>
            <div class="assistant-stream">
              <div class="turn-meta-bar"><strong>${esc(t.agent)}</strong><span>${esc(t.model || '')}</span></div>
              <small class="muted" title="تعداد actual از گزارش مدل؛ دو عدد دیگر تخمین نویسه‌ای هستند و صورتحساب نیستند.">پاسخ مدل: ${Number(m.out_tok || 0) ? `${Number(m.out_tok).toLocaleString()} توکن ثبت‌شده` : 'تعداد ثبت‌نشده'} · متن انگلیسی ~${outputTextEstimate.toLocaleString()} · نمایش فارسی ${t.reply_fa ? `~${outputPersianEstimate.toLocaleString()}` : 'ترجمه نشده'} تخمینی</small>
              ${stepTimeline || `${thinkAcc}${toolsAcc}`}
              ${bodyContent}
              ${t.reply_en ? `<div class="turn-foot-actions"><span>engine: ${esc(t.tr_engine || (trEnabled ? 'online' : 'proxy-only'))}</span><button class="btn ghost" onclick="ABChatPage.retranslate('${esc(t.id)}')">ترجمه مجدد ↻</button></div>` : ''}
            </div>
          </details>
        </article>`;
    }).join('');

    // Preserve user scroll position unless at bottom or switched session / added new turn
    const sessionChanged = sessId !== lastSessionId;
    const turnAdded = turns.length > lastTurnCount;
    lastSessionId = sessId;
    lastTurnCount = turns.length;

    if (sessionChanged || turnAdded || stickToBottom) {
      requestAnimationFrame(() => scrollToBottom(turnAdded && !sessionChanged));
    } else {
      feed.scrollTop = prevScrollTop;
    }
  }

  return {
    render, renderContextPanel, useStarter, translateDraft, sendFinal, validateOutgoing,
    toggleComposerMd, closePreview, copyOutgoing,
    setChatMode, toggleUiFlag, retranslate, translatePrompt, translateThink, setThinkMode, translateSelection, closeSelectionTranslate, abort, scrollToBottom
  };
})();
