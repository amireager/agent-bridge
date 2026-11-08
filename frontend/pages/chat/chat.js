// Modular Chat Page — Pro Markdown, Dismissable EN, and Persian-Guardrail Composer
window.ABChatPage = (() => {
  const { esc, api } = window.ABUtils;
  const PERSIAN_SEQ_RE = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:\s+[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;

  let lastTranslatedDraft = '';
  let showMdPreviewInComposer = false;

  function ensureSkeleton(host) {
    if (host.querySelector('#chatRoot')) return;
    host.innerHTML = `
      <div id="chatRoot" class="chat-root">
        <div id="chatSubBar" class="chat-subbar"></div>
        <div id="chatFeed" class="chat-feed"></div>

        <div class="chat-composer">
          <!-- پنجره چتی پیش‌نمایش و ویرایش ترجمه انگلیسی قبل از ارسال -->
          <div id="trChatBubble" class="tr-chat-bubble">
            <div class="tr-bubble-head">
              <span><strong>پیش‌نمایش پرامپت انگلیسی ارسالی</strong> <span class="muted">(قابل ویرایش مستقیم قبل از ارسال)</span></span>
              <div style="display:flex;gap:6px;align-items:center;direction:ltr;">
                <span id="trMetaTag" class="mono muted" style="font-size:10.5px;"></span>
                <button class="btn ghost" onclick="ABChatPage.toggleComposerMd()">MD_PREVIEW</button>
                <button class="btn ghost" onclick="ABChatPage.copyOutgoing(this)">COPY_EN</button>
                <button class="btn ghost" onclick="ABChatPage.closePreview()">×</button>
              </div>
            </div>

            <textarea id="wireInput" class="tr-editor" placeholder="Translated English prompt (editable)..."></textarea>
            <div id="wireMdPreview" class="tr-md-preview"></div>

            <div id="staleNotice" class="stale-notice">
              <span>متن پیش‌نویس بالا تغییر کرده است؛ برای اعمال تغییرات روی ترجمه کلیک کنید:</span>
              <button class="btn ghost on" onclick="ABChatPage.translateDraft()">به‌روزرسانی ترجمه ↻</button>
            </div>

            <!-- نگهبان کاراکتر فارسی در متن خروجی -->
            <div id="persianGuard" class="persian-guard">
              <div id="persianGuardMsg"></div>
              <label class="guard-check-lbl">
                <input type="checkbox" id="allowPersianCheck" onchange="ABChatPage.validateOutgoing()" />
                <span>تایید می‌کنم عبارت فارسی بالا (مثلاً نام پوشه یا رشته خاص) عمداً بدون ترجمه ارسال شود</span>
              </label>
            </div>
          </div>

          <div id="sendErrBanner" style="display:none;color:var(--red);font-size:12px;direction:rtl;"></div>

          <div class="composer-bar">
            <button id="btnAbortChat" class="btn danger" style="display:none;" onclick="ABChatPage.abort()">STOP</button>
            <button id="btnSendFinal" class="btn primary" onclick="ABChatPage.sendFinal()" title="ارسال متن انگلیسی تاییدشده به عامل">۲. ارسال به عامل ↵</button>
            <button id="btnTranslateDraft" class="btn" onclick="ABChatPage.translateDraft()" title="ترجمه متن به انگلیسی و باز کردن پیش‌نمایش">۱. ترجمه پیش‌نمایش</button>
            <textarea id="composerRaw" class="composer-raw" placeholder="پیامت را به فارسی (یا ترکیبی با کد) بنویس → دکمه «۱. ترجمه پیش‌نمایش» را بزن → در صورت نیاز ویرایش کن و «۲. ارسال» را بزن..."></textarea>
          </div>
        </div>
      </div>
    `;

    const rawEl = document.getElementById('composerRaw');
    const wireEl = document.getElementById('wireInput');

    rawEl.addEventListener('input', () => {
      const bubble = document.getElementById('trChatBubble');
      if (bubble.classList.contains('open')) {
        const isStale = rawEl.value.trim() !== lastTranslatedDraft;
        document.getElementById('staleNotice').classList.toggle('show', isStale);
      }
    });

    rawEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const bubbleOpen = document.getElementById('trChatBubble').classList.contains('open');
        if (!bubbleOpen) translateDraft();
        else sendFinal();
      }
    });

    wireEl.addEventListener('input', () => {
      validateOutgoing();
      if (showMdPreviewInComposer) {
        document.getElementById('wireMdPreview').innerHTML = window.ABMarkdown.render(wireEl.value);
      }
    });
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
      msgEl.innerHTML = `⚠ <strong>ارسال متوقف شد — کاراکتر فارسی در متن انگلیسی دیده شد:</strong> ${quoted} — لطفاً آن را به انگلیسی اصلاح/ترجمه کنید، یا در صورت عمدی بودن (مثل نام پوشه فارسی) تیک زیر را بزنید:`;
      guardEl.classList.add('show');
      return !!chkEl.checked;
    } else {
      guardEl.classList.remove('show');
      if (chkEl) chkEl.checked = false;
      return true;
    }
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
    document.getElementById('trChatBubble').classList.remove('open');
    document.getElementById('staleNotice').classList.remove('show');
    document.getElementById('persianGuard').classList.remove('show');
  }

  function copyOutgoing(btn) {
    const txt = document.getElementById('wireInput')?.value || '';
    if (!txt) return;
    navigator.clipboard?.writeText(txt);
    const old = btn.textContent;
    btn.textContent = 'COPIED';
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
    wireEl.value = res.translation || raw;
    lastTranslatedDraft = raw;
    document.getElementById('staleNotice').classList.remove('show');
    document.getElementById('trMetaTag').textContent = `${res.engine} · ${res.elapsed_ms}ms`;

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

    const rawTxt = rawEl.value.trim();
    // Step 1 enforcement: user writes -> translates into preview first -> then sends!
    if (!bubble.classList.contains('open') || !wireEl.value.trim()) {
      if (!rawTxt) return;
      if (findPersianMatches(rawTxt).length > 0) {
        await translateDraft();
        return;
      }
      // Pure English typed directly in raw box -> mirror into preview and send if clean
      wireEl.value = rawTxt;
      lastTranslatedDraft = rawTxt;
      bubble.classList.add('open');
    }

    // If user added new text to Persian box after translating and forgot to re-translate, warn if Persian!
    if (rawTxt && rawTxt !== lastTranslatedDraft && findPersianMatches(rawTxt).length > 0 && !document.getElementById('allowPersianCheck').checked) {
      document.getElementById('staleNotice').classList.add('show');
      await translateDraft();
      return;
    }

    // Strict Persian Guardrail check on outgoing text
    const allowed = validateOutgoing();
    if (!allowed) {
      const g = document.getElementById('persianGuard');
      g.classList.remove('shake');
      void g.offsetWidth;
      g.classList.add('shake');
      return;
    }

    const outgoingEn = wireEl.value.trim();
    const allowFa = !!document.getElementById('allowPersianCheck')?.checked;
    const st = window.ABApp.getState();

    const res = await api('/api/prompt', {
      user_raw: rawTxt || outgoingEn,
      prompt_sent: outgoingEn,
      allow_persian: allowFa,
      source: 'web',
      agent_id: st?.active_agent
    });

    if (!res.ok) {
      errEl.textContent = `خطا در ارسال مستقیم: ${res.error} (می‌توانید با دکمه COPY_EN متن انگلیسی را کپی کنید)`;
      errEl.style.display = 'block';
      return;
    }

    rawEl.value = '';
    wireEl.value = '';
    lastTranslatedDraft = '';
    document.getElementById('allowPersianCheck').checked = false;
    closePreview();
  }

  async function toggleUiFlag(key) {
    const cur = window.ABApp.getState()?.config?.ui?.[key];
    await api('/api/config', { ui: { [key]: !cur } });
  }

  async function toggleTurnEn(turnId) {
    await api('/api/turn/toggle-en', { turn_id: turnId });
  }

  async function retranslate(turnId) {
    await api('/api/turn/translate', { turn_id: turnId });
  }

  async function abort() {
    await api('/api/abort', {});
  }

  function summarizeToolArgs(tl) {
    const a = tl.args || {};
    if (typeof a === 'string') return a.slice(0, 70);
    if (a.path) return a.path;
    if (a.command) return String(a.command).slice(0, 72);
    return JSON.stringify(a).slice(0, 68);
  }

  function formatToolBody(tl) {
    const a = tl.args || {};
    let head = typeof a === 'string' ? a : JSON.stringify(a, null, 2);
    if (tl.name === 'write' && a.content) {
      head = `// file: ${a.path || ''}\n${a.content}`;
    } else if (tl.name === 'edit' && (a.oldText || a.newText)) {
      head = `--- old\n${a.oldText || ''}\n+++ new\n${a.newText || ''}`;
    }
    return `${head}${tl.output ? `\n\n// output\n${tl.output}` : ''}`;
  }

  function render(host, state, forceFull = false) {
    if (forceFull) host.innerHTML = '';
    ensureSkeleton(host);

    const ui = state.config.ui || {};
    const showGlobalEn = ui.show_english_reply !== false;

    document.getElementById('chatSubBar').innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;">
        <span>tap_endpoint: <code>http://127.0.0.1:${state.bridge_port}/v1</code></span>
        <span>·</span>
        <span>cli_attach: <code>python3 cli.py</code></span>
      </div>
      <div style="display:flex;gap:5px;align-items:center;">
        <button class="btn ghost ${showGlobalEn ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_english_reply')" title="نمایش یا حذف متن انگلیسی پاسخ‌ها برای خلوت شدن صفحه">
          ${showGlobalEn ? 'EN: نمایش کنار فارسی' : 'EN: مخفی (خلوت)'}
        </button>
        <button class="btn ghost ${ui.show_think ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_think')">THINK</button>
        <button class="btn ghost ${ui.show_tools ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_tools')">TOOLS</button>
        <button class="btn ghost ${ui.show_inline_tokens ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_inline_tokens')">TOKENS</button>
      </div>
    `;

    const isBusy = state.session_state !== 'IDLE' && state.session_state !== 'ERROR';
    document.getElementById('btnAbortChat').style.display = isBusy ? 'inline-flex' : 'none';

    const feed = document.getElementById('chatFeed');
    const turns = state.active_session?.turns || [];
    if (!turns.length) {
      feed.innerHTML = `
        <div class="panel rtl" style="margin:auto;max-width:600px;">
          <div class="panel-head">
            <h3>درگاه شنود و ترجمه آماده است — <span class="mono">${esc(state.active_agent)}</span></h3>
          </div>
          <p class="fg-1" style="line-height:1.8;margin:0;">
            هر عاملی که به <code>http://127.0.0.1:${state.bridge_port}/v1</code> وصل شود، پیام‌هایش اینجا با رندر کامل <strong>Markdown</strong> و ترجمه فارسی نثر (بدون دست زدن به کدها) نمایش داده می‌شود؛ و از کادر پایین هم می‌توانی بدون نیاز به کپی-پیست، متن فارسی را ترجمه، بازبینی و ارسال کنی.
          </p>
        </div>`;
      return;
    }

    feed.innerHTML = turns.map((t, idx) => {
      const m = t.metrics || {};
      const totIn = (m.cached_in || 0) + (m.uncached_in || 0);
      const kvPct = totIn > 0 ? Math.round((m.cached_in / totIn) * 100) : 0;
      const modelTag = t.model ? ` · ${t.model}` : '';
      const tokStr = ui.show_inline_tokens
        ? `kv:${m.cached_in || 0}(${kvPct}%) · in:${m.uncached_in || 0} · out:${m.out_tok || 0} · ${m.tg_tps || 0}t/s`
        : `${t.elapsed_s || 0}s`;

      const wireAcc = (ui.show_wire_en && t.prompt_sent && t.prompt_sent !== t.user_raw) ? `
        <details class="trace-acc">
          <summary>
            <span>[SENT_EN] ${esc(t.prompt_sent.slice(0, 88))}${t.prompt_sent.length > 88 ? '...' : ''}</span>
            <span class="muted">prompt</span>
          </summary>
          <div class="acc-body">${esc(t.prompt_sent)}</div>
        </details>` : '';

      const thinkAcc = (ui.show_think && t.thinking) ? `
        <details class="trace-acc" ${t.status === 'streaming' && !t.reply_en ? 'open' : ''}>
          <summary>
            <span>[THINK] reasoning trace</span>
            <span class="acc-tag">${t.thinking.length} ch</span>
          </summary>
          <div class="acc-body">${esc(t.thinking)}</div>
        </details>` : '';

      const toolsAcc = ui.show_tools ? (t.tools || []).map(tl => {
        const cls = tl.status === 'running' ? 'run' : (tl.is_error ? 'err' : 'ok');
        const stTxt = tl.status === 'running' ? 'RUN' : (tl.is_error ? 'ERR' : 'OK');
        return `
          <details class="trace-acc" ${tl.status === 'running' ? 'open' : ''}>
            <summary>
              <span>[TOOL:${esc(tl.name)}] ${esc(summarizeToolArgs(tl))}</span>
              <span class="acc-tag ${cls}">${stTxt}</span>
            </summary>
            <div class="acc-body">${esc(formatToolBody(tl))}</div>
          </details>`;
      }).join('') : '';

      const showThisEn = showGlobalEn && !t.hide_en && !!t.reply_en;
      const faCard = t.reply_fa ? `
        <div class="reply-pane fa">
          <div class="pane-caption">
            <span>FA_TRANSLATION (${esc(t.tr_engine || 'online')}) — code untouched</span>
            <div style="display:flex;gap:5px;">
              ${(!showThisEn && t.reply_en) ? `<button class="btn ghost" style="padding:0 5px;font-size:10px;" onclick="ABChatPage.toggleTurnEn('${esc(t.id)}')">+ نمایش انگلیسی</button>` : ''}
              <button class="btn ghost" style="padding:0 5px;font-size:10px;" onclick="ABChatPage.retranslate('${esc(t.id)}')">ترجمه مجدد</button>
            </div>
          </div>
          ${window.ABMarkdown.render(t.reply_fa)}
        </div>` : '';

      const enCard = showThisEn ? `
        <div class="reply-pane en">
          <div class="pane-caption">
            <span>ORIGINAL_EN</span>
            <button class="btn ghost" style="padding:0 6px;font-size:10px;" onclick="ABChatPage.toggleTurnEn('${esc(t.id)}')" title="حذف متن انگلیسی این پیام برای خلوت شدن صفحه">× حذف انگلیسی</button>
          </div>
          ${window.ABMarkdown.render(t.reply_en)}
        </div>` : '';

      let outHtml = '';
      if (faCard && enCard) {
        outHtml = `<div class="reply-split">${faCard}${enCard}</div>`;
      } else {
        outHtml = `<div class="reply-single">${faCard || enCard || '<div class="mono muted">[در انتظار پاسخ مدل...]</div>'}</div>`;
      }

      const src = (t.source || 'web').toUpperCase();
      return `
        <section class="turn-block">
          <div class="turn-head">
            <span>#${String(idx + 1).padStart(2, '0')} · <span class="src-badge ${src !== 'WEB' ? 'cli' : ''}">${esc(src)}</span> · ${esc(t.agent)}${esc(modelTag)} · ${esc(t.ts)}</span>
            <span>${esc(tokStr)}</span>
          </div>
          <div class="turn-input-zone">${window.ABMarkdown.render(t.user_raw)}</div>
          <div class="trace-stack">
            ${wireAcc}
            ${thinkAcc}
            ${toolsAcc}
            ${outHtml}
          </div>
        </section>`;
    }).join('');
  }

  return {
    render, translateDraft, sendFinal, validateOutgoing,
    toggleComposerMd, closePreview, copyOutgoing,
    toggleUiFlag, toggleTurnEn, retranslate, abort
  };
})();
