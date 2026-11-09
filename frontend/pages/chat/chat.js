// Arena-Smooth Chat Page — Fixed Scroll, Paragraph-Interleaved Bilingual Flow & Token Savings
window.ABChatPage = (() => {
  const { esc, api } = window.ABUtils;
  const PERSIAN_SEQ_RE = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:\s+[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;

  let lastTranslatedDraft = '';
  let showMdPreviewInComposer = false;
  let lastSessionId = null;
  let lastTurnCount = 0;
  let stickToBottom = true;

  // O(1) Zero-CPU Multiplication Estimate: Persian ~0.68 tok/char vs English ~0.25 tok/char
  function estimateSavings(faText, enText) {
    const faChars = (String(faText || '').match(/[\u0600-\u06FF]/g) || []).length;
    if (faChars < 4) return null;
    const rawFaEst = Math.max(1, Math.round(faChars * 0.68 + (String(faText).length - faChars) * 0.25));
    const enEst = Math.max(1, Math.round(String(enText || '').length * 0.25));
    const saved = Math.max(0, rawFaEst - enEst);
    const pct = Math.round((saved / Math.max(1, rawFaEst)) * 100);
    return { rawFaEst, enEst, saved, pct };
  }

  function ensureSkeleton(host) {
    if (host.querySelector('#chatRoot')) return;
    host.innerHTML = `
      <div id="chatRoot" class="chat-root">
        <div id="chatSubBar" class="chat-subbar"></div>

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

    const rawEl = document.getElementById('composerRaw');
    const wireEl = document.getElementById('wireInput');

    rawEl.addEventListener('input', () => {
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
    if (sv && sv.saved > 0) {
      pill.style.display = 'inline-flex';
      pill.textContent = `⚡ ~${sv.saved} tok saved (-${sv.pct}% vs FA)`;
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

  async function retranslate(turnId) {
    await api('/api/turn/translate', { turn_id: turnId });
  }

  async function abort() {
    await api('/api/abort', {});
  }

  function summarizeToolArgs(tl) {
    const a = tl.args || {};
    if (typeof a === 'string') return a.slice(0, 74);
    if (a.path) return a.path;
    if (a.command) return String(a.command).slice(0, 76);
    return JSON.stringify(a).slice(0, 72);
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
    const trEnabled = state.config.translation.enabled !== false;
    const chatMode = !trEnabled ? 'en_only' : (ui.chat_mode || 'interleaved');

    document.getElementById('btnTranslateDraft').style.display = trEnabled ? 'inline-flex' : 'none';

    document.getElementById('chatSubBar').innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <span>Proxy: <code>http://127.0.0.1:${state.bridge_port}/v1</code></span>
        <span>·</span>
        <span>TTY Wrap: <code>python3 cli.py --wrap pi</code></span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="seg-group" title="حالت نمایش متن و ترجمه (کدها همیشه فقط یک‌بار و دست‌نخورده نمایش داده می‌شوند)">
          <button class="seg-btn ${chatMode === 'interleaved' ? 'on' : ''}" onclick="ABChatPage.setChatMode('interleaved')">زیرِ هم (EN + FA)</button>
          <button class="seg-btn ${chatMode === 'fa_only' ? 'on' : ''}" onclick="ABChatPage.setChatMode('fa_only')">تمام‌صفحه فارسی</button>
          <button class="seg-btn ${chatMode === 'en_only' ? 'on' : ''}" onclick="ABChatPage.setChatMode('en_only')">فقط انگلیسی</button>
        </div>
        <button class="btn ghost ${ui.show_think ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_think')">Think</button>
        <button class="btn ghost ${ui.show_tools ? 'on' : ''}" onclick="ABChatPage.toggleUiFlag('show_tools')">Tools</button>
      </div>
    `;

    const isBusy = state.session_state !== 'IDLE' && state.session_state !== 'ERROR';
    document.getElementById('btnAbortChat').style.display = isBusy ? 'inline-flex' : 'none';

    const feed = document.getElementById('chatFeed');
    const feedInner = document.getElementById('chatFeedInner');
    const sessId = state.active_session?.id || '';
    const turns = state.active_session?.turns || [];

    // Capture open <details> IDs & scroll position BEFORE updating DOM
    const prevScrollTop = feed.scrollTop;
    const openDetailsIds = new Set(
      [...feedInner.querySelectorAll('details[data-acc-id][open]')].map(d => d.getAttribute('data-acc-id'))
    );

    if (!turns.length) {
      feedInner.innerHTML = `
        <div class="panel rtl" style="margin:36px auto;max-width:680px;">
          <div class="panel-head">
            <h3>آماده شنود، شکار کش KV و ترجمه پاراگرافی — <span class="mono">${esc(state.active_agent)}</span></h3>
          </div>
          <p class="fg-1" style="line-height:1.9;margin:0 0 12px;">
            ۱. اگر در ترمینال عادی یا سندباکس، عاملت (مثل <code>pi</code>) به <code>http://127.0.0.1:${state.bridge_port}/v1</code> وصل باشد، تمام پاسخ‌ها، ابزارها و آمار دقیق کش <strong>به‌صورت زنده اینجا استخراج می‌شوند</strong> و کدها فقط یک‌بار بدون تکرار نمایش داده می‌شوند.
          </p>
          <p class="fg-1" style="line-height:1.9;margin:0;">
            ۲. اگر می‌خواهی محیط تعاملی واقعی <code>pi</code> در ترمینال باز بماند <strong>و</strong> دکمه «ارسال» همین صفحه هم مستقیم داخلش تایپ شود، در ترمینال سندباکس بزن:
            <code>python3 cli.py --wrap pi</code>
          </p>
        </div>`;
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
        <details class="trace-acc" data-acc-id="${esc(wireId)}" ${openDetailsIds.has(wireId) ? 'open' : ''} style="margin-top:8px;">
          <summary>
            <span>Sent English Prompt</span>
            <span class="muted">${t.prompt_sent.length} chars</span>
          </summary>
          <div class="acc-body">${esc(t.prompt_sent)}</div>
        </details>` : '';

      const thinkId = `${t.id}-think`;
      const autoOpenThink = (t.status === 'streaming' && !t.reply_en) || openDetailsIds.has(thinkId);
      const thinkAcc = (ui.show_think && t.thinking) ? `
        <details class="trace-acc" data-acc-id="${esc(thinkId)}" ${autoOpenThink ? 'open' : ''}>
          <summary>
            <span>Reasoning / Think</span>
            <span class="acc-tag">${t.thinking.length} ch</span>
          </summary>
          <div class="acc-body">${esc(t.thinking)}</div>
        </details>` : '';

      const toolsAcc = ui.show_tools ? (t.tools || []).map((tl, tIdx) => {
        const cls = tl.status === 'running' ? 'run' : (tl.is_error ? 'err' : 'ok');
        const stTxt = tl.status === 'running' ? 'RUN' : (tl.is_error ? 'ERR' : 'OK');
        const detId = `${t.id}-tool-${tIdx}`;
        const isOpen = tl.status === 'running' || openDetailsIds.has(detId);
        return `
          <details class="trace-acc" data-acc-id="${esc(detId)}" ${isOpen ? 'open' : ''}>
            <summary>
              <span>Tool · <strong>${esc(tl.name)}</strong> · <span class="muted">${esc(summarizeToolArgs(tl))}</span></span>
              <span class="acc-tag ${cls}">${stTxt}</span>
            </summary>
            <div class="acc-body">${esc(formatToolBody(tl))}</div>
          </details>`;
      }).join('') : '';

      const bodyContent = (t.reply_en || (t.blocks && t.blocks.length))
        ? window.ABMarkdown.renderBlocks(t.blocks, t.reply_en, t.reply_fa, chatMode)
        : (t.tools?.length ? '' : '<div class="mono muted">[در حال دریافت پاسخ مدل...]</div>');

      const src = (t.source || 'web').toUpperCase();
      const savedPill = (t.saved_fa_tokens > 0)
        ? `<span style="color:var(--phosphor)">⚡ ~${t.saved_fa_tokens} tok saved</span>`
        : `<span>${esc(t.ts)}</span>`;

      return `
        <article class="turn-card">
          ${t.user_raw ? `
            <div class="user-bubble-row">
              <div class="user-bubble">
                ${window.ABMarkdown.render(t.user_raw)}
                <div class="user-bubble-meta">
                  <span>#${String(idx + 1).padStart(2, '0')} · <span class="src-badge ${src !== 'WEB' ? 'cli' : ''}">${esc(src)}</span></span>
                  ${savedPill}
                </div>
                ${wireAcc}
              </div>
            </div>` : ''}

          <div class="assistant-card">
            <div class="turn-head">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="color:var(--fg-0)">${esc(t.agent)}</strong>
                ${t.model ? `<span>· ${esc(t.model)}</span>` : ''}
                <span class="kv-pill ${esc(kvState)}">${esc(kvLabel)}</span>
              </div>
              <span>${esc(tokStr)}</span>
            </div>

            <div class="assistant-body">
              ${thinkAcc}
              ${toolsAcc}
              ${bodyContent}
              ${t.reply_en ? `
                <div class="turn-foot-actions">
                  <span>engine: ${esc(t.tr_engine || (trEnabled ? 'online' : 'proxy-only'))}</span>
                  <div style="display:flex;gap:6px;">
                    <button class="btn ghost" style="padding:2px 8px;font-size:10.5px;" onclick="ABChatPage.retranslate('${esc(t.id)}')">ترجمه مجدد این پاسخ ↻</button>
                  </div>
                </div>` : ''}
            </div>
          </div>
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
    render, translateDraft, sendFinal, validateOutgoing,
    toggleComposerMd, closePreview, copyOutgoing,
    setChatMode, toggleUiFlag, retranslate, abort, scrollToBottom
  };
})();
