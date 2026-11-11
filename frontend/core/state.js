// Central State Store — Dual Sidebar (Live Terminal Mirrors + Direct Model/Tool Lab), Theme & Font Scale
window.ABApp = (() => {
  const { ICONS, esc, api } = window.ABUtils;

  let state = null;
  let baseState = null;
  let route = 'home';
  const liveWireTurns = new Map();
  const openBranches = {
    mirrors: false,
    history: false,
    lab: false,
    usage: false,
    settings: false
  };

  function getState() { return state; }
  function getRoute() { return route; }

  function navigate(nextRoute) {
    if (route === 'set-hud' && nextRoute !== 'set-hud') window.ABSettingsPage?.cancelUIPreview?.();
    route = nextRoute;
    renderTree();
    renderMainPage(true);
  }

  function toggleBranch(key) {
    openBranches[key] = !openBranches[key];
    renderTree();
  }

  async function selectMirror(agentId) {
    await api('/api/view/select', { kind: 'mirror', id: agentId });
    route = 'chat';
    renderTree();
  }

  async function selectLab(sessionId) {
    await api('/api/view/select', { kind: 'lab', id: sessionId });
    route = 'chat';
    renderTree();
  }

  async function createLabSession(ev) {
    if (ev) ev.stopPropagation();
    const title = prompt('نام این چت Lab را وارد کن:', `تست مدل ${new Date().toLocaleString()}`);
    if (title === null) return;
    openBranches.lab = true;
    await api('/api/lab/new', { title: title.trim() || 'تست مدل جدید' });
    route = 'chat';
  }

  async function renameLabSession(sessionId, ev) {
    if (ev) ev.stopPropagation();
    const current = state?.lab_sessions?.find(x => x.id === sessionId)?.title || '';
    const title = prompt('نام جدید چت Lab:', current);
    if (title && title.trim()) await api('/api/lab/rename', { session_id: sessionId, title: title.trim() });
  }

  async function archiveMirror(agentId, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/mirror/archive', { agent_id: agentId });
  }

  async function deleteMirror(agentId, ev) {
    if (ev) ev.stopPropagation();
    if (!confirm(`حذف تاریخچه‌ی کانال آفلاین «${agentId}»؟`)) return;
    await api('/api/mirror/delete', { agent_id: agentId });
  }

  async function archiveLabSession(sessionId, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/lab/archive', { session_id: sessionId });
  }

  async function deleteLabSession(sessionId, ev) {
    if (ev) ev.stopPropagation();
    const title = [...(state?.lab_history || []), ...(state?.lab_sessions || [])].find(x => x.id === sessionId)?.title || sessionId;
    if (!confirm(`حذف تاریخچهٔ Lab «${title}»؟ پیام‌ها و نشست ذخیره‌شده پاک می‌شوند و این کار برگشت‌پذیر نیست.`)) return;
    try {
      const result = await api('/api/lab/delete', { session_id: sessionId });
      if (!result?.ok) throw new Error('نشست پیدا نشد یا حذف انجام نشد.');
      if (state) {
        state.lab_history = (state.lab_history || []).filter(x => x.id !== sessionId);
        state.lab_sessions = (state.lab_sessions || []).filter(x => x.id !== sessionId);
        renderTree();
      }
    } catch (error) {
      alert(`حذف انجام نشد: ${error.message}`);
    }
  }

  async function filterByObservedModel(modelName) {
    await api('/api/usage/filter', { model: modelName });
    route = 'usage-overview';
    renderTree();
  }

  async function toggleSidebarSide() {
    const cur = state?.config?.ui?.sidebar_side || 'left';
    await api('/api/config', { ui: { sidebar_side: cur === 'left' ? 'right' : 'left' } });
  }

  async function toggleProxyMode() {
    const cur = state?.config?.translation?.enabled !== false;
    await api('/api/config', {
      translation: { enabled: !cur },
      ui: { chat_mode: !cur ? 'interleaved' : 'en_only' }
    });
  }

  function toggleSidebarCollapse() {
    document.getElementById('sidebar').classList.toggle('collapsed');
  }

  let sidebarDrag = null;
  function clampSidebarWidth(value) {
    const shell = document.getElementById('shellRoot');
    const total = shell?.clientWidth || window.innerWidth || 1200;
    const min = Math.min(220, Math.max(150, total * 0.32));
    const max = Math.max(min, Math.min(560, total - Math.min(240, total * 0.35)));
    return Math.round(Math.min(max, Math.max(min, Number(value) || 280)));
  }
  function applySidebarWidth(value) {
    if (sidebarDrag) return;
    const shell = document.getElementById('shellRoot');
    if (shell) shell.style.setProperty('--sidebar-width', `${clampSidebarWidth(value)}px`);
  }
  async function saveSidebarWidth(value) {
    const width = clampSidebarWidth(value);
    try { await api('/api/config', { ui: { sidebar_width: width } }); } catch (_) {}
  }
  function bindSidebarResizer() {
    const handle = document.getElementById('sidebarResizer');
    const shell = document.getElementById('shellRoot');
    const sidebar = document.getElementById('sidebar');
    if (!handle || !shell || !sidebar || handle.dataset.bound) return;
    handle.dataset.bound = 'true';

    const move = event => {
      if (!sidebarDrag || sidebarDrag.pointerId !== event.pointerId) return;
      const delta = event.clientX - sidebarDrag.x;
      const width = sidebarDrag.width + (sidebarDrag.side === 'right' ? -delta : delta);
      const clamped = clampSidebarWidth(width);
      shell.style.setProperty('--sidebar-width', `${clamped}px`);
      handle.setAttribute('aria-valuenow', String(clamped));
    };
    const finish = event => {
      if (!sidebarDrag || (event?.pointerId != null && sidebarDrag.pointerId !== event.pointerId)) return;
      const width = sidebar.getBoundingClientRect().width;
      sidebarDrag = null;
      shell.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      saveSidebarWidth(width);
    };

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const side = state?.config?.ui?.sidebar_side || 'left';
      sidebar.classList.remove('collapsed');
      const width = sidebar.getBoundingClientRect().width;
      sidebarDrag = { pointerId: event.pointerId, x: event.clientX, width, side };
      shell.classList.add('is-resizing');
      handle.setAttribute('aria-valuenow', String(Math.round(width)));
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    });
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      sidebar.classList.remove('collapsed');
      const side = state?.config?.ui?.sidebar_side || 'left';
      const grow = (event.key === 'ArrowRight') !== (side === 'right');
      const current = sidebar.getBoundingClientRect().width;
      const width = clampSidebarWidth(current + (grow ? 16 : -16) * (event.shiftKey ? 2 : 1));
      shell.style.setProperty('--sidebar-width', `${width}px`);
      handle.setAttribute('aria-valuenow', String(width));
      saveSidebarWidth(width);
    });
  }

  function renderTree() {
    if (!state) return;
    const treeEl = document.getElementById('sbTree');
    if (!treeEl) return;

    // 1. Live Terminal Mirrors (No manual + session buttons — 100% wire-driven!)
    const mirrorHtml = (state.mirrors || []).map(m => {
      const isAct = route === 'chat' && state.view_kind === 'mirror' && state.view_id === m.agent_id;
      const dotCls = m.pty_live ? 'led ok' : 'led';
      return `
        <div class="tree-node ${isAct ? 'active' : ''}" onclick="ABApp.selectMirror('${esc(m.agent_id)}')" title="${esc(m.title)}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;">
            <i class="${dotCls}"></i>
            <strong class="mono">${esc(m.agent_id)}</strong>
          </span>
          <span style="display:flex;align-items:center;gap:4px;"><span class="tiny-tag ${m.pty_live ? 'on' : ''}">${m.pty_live ? 'زنده' : m.turn_count}</span><button class="mini-action" title="انتقال به تاریخچه؛ ترمینال خارجی متوقف نمی‌شود" onclick="ABApp.archiveMirror('${esc(m.agent_id)}',event)">↘</button></span>
        </div>`;
    }).join('') || '<div class="tree-empty">ترمینال زنده‌ای نیست</div>';

    const mirrorHistoryHtml = (state.mirror_history || []).map(m => {
      const isAct = route === 'chat' && state.view_kind === 'mirror' && state.view_id === m.agent_id;
      const status = m.pty_live ? 'PTY زنده · در تاریخچه' : 'ترمینال بسته';
      const deleteAction = m.pty_live ? '' : `<button class="mini-action danger" title="حذف تاریخچه" onclick="ABApp.deleteMirror('${esc(m.agent_id)}',event)">×</button>`;
      return `<div class="tree-node ${isAct ? 'active' : ''}" onclick="ABApp.selectMirror('${esc(m.agent_id)}')"><span>◷ <strong class="mono">${esc(m.agent_id)}</strong> <small>${m.turn_count} دور · ${status}</small></span>${deleteAction}</div>`;
    }).join('');
    const labHistoryHtml = (state.lab_history || []).map(s => {
      const isAct = route === 'chat' && state.view_kind === 'lab' && state.view_id === s.id;
      return `<div class="tree-node ${isAct ? 'active' : ''}" onclick="ABApp.selectLab('${esc(s.id)}')"><span>⚡ <strong>${esc(s.title)}</strong> <small>${s.turn_count} دور · بایگانی‌شده</small></span><span style="display:flex;align-items:center;gap:4px;"><span class="tiny-tag">بازگردانی</span><button class="mini-action danger" title="حذف دائمی تاریخچهٔ Lab" aria-label="حذف ${esc(s.title)}" onclick="ABApp.deleteLabSession('${esc(s.id)}',event)">×</button></span></div>`;
    }).join('');
    const historyHtml = [labHistoryHtml, mirrorHistoryHtml].filter(Boolean).join('') || '<div class="tree-empty">تاریخچه‌ای نیست</div>';

    // 2. Built-in Direct Model & Tool Lab (for KV/translation testing & growing our own agent!)
    const labHtml = (state.lab_sessions || []).map(s => {
      const isAct = route === 'chat' && state.view_kind === 'lab' && state.view_id === s.id;
      return `
        <div class="tree-node ${isAct ? 'active' : ''}" onclick="ABApp.selectLab('${esc(s.id)}')">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <span class="mono" style="color:var(--cyan)">⚡</span> ${esc(s.title)}
          </span>
          <span style="display:flex;align-items:center;gap:4px;">
            <span class="tiny-tag">${s.turn_count}</span>
            <button class="mini-action" title="تغییر نام" onclick="ABApp.renameLabSession('${esc(s.id)}',event)">✎</button>
            <button class="mini-action" title="انتقال به تاریخچه؛ پیام‌ها حفظ می‌شوند" onclick="ABApp.archiveLabSession('${esc(s.id)}',event)">↘</button>
          </span>
        </div>`;
    }).join('') || '<div class="tree-empty">چتی ساخته نشده؛ برای شروع «+ جدید» را بزن.</div>';

    const mkRoot = (key, icon, title, bodyHtml, extraAction = '') => `
      <div class="tree-group">
        <div class="tree-group-heading">
          <button class="tree-root-btn" type="button" onclick="ABApp.toggleBranch('${key}')" aria-expanded="${openBranches[key] ? 'true' : 'false'}" aria-controls="tree-${key}">
            <span class="tree-root-label"><span class="tree-emoji" aria-hidden="true">${icon}</span><span class="hide-collapsed">${title}</span></span>
            <span class="tree-root-chevron hide-collapsed">${openBranches[key] ? ICONS.chevronDown : ICONS.chevronRight}</span>
          </button>
          ${extraAction ? `<div class="tree-group-tools hide-collapsed">${extraAction}</div>` : ''}
        </div>
        <div id="tree-${key}" class="tree-children hide-collapsed ${openBranches[key] ? 'open' : ''}">
          ${bodyHtml}
        </div>
      </div>`;

    const mkLeaf = (rId, label, rightTag = '', tagCls = '') => `
      <button class="tree-node ${route === rId ? 'active' : ''}" onclick="ABApp.navigate('${rId}')" ${route === rId ? 'aria-current="page"' : ''}>
        <span>${label}</span>
        ${rightTag ? `<span class="tiny-tag ${tagCls}">${rightTag}</span>` : ''}
      </button>`;

    const kvPct = state.usage?.window?.cache_hit_pct ?? 0;
    const trOn = state.config.translation.enabled !== false;

    treeEl.innerHTML = [
      `<div class="sidebar-shortcuts">${mkLeaf('home', '🏠 داشبورد')}${mkLeaf('chat', '💬 گفتگو')}</div>`,
      mkRoot('mirrors', '🔌', 'عامل‌های زنده', mirrorHtml),
      mkRoot('history', '🕘', 'تاریخچهٔ مکالمه‌ها', historyHtml),
      mkRoot(
        'lab',
        '🧪',
        'آزمایش مدل و ابزار',
        labHtml,
        `<button class="tree-add-btn" type="button" title="ساخت نشست آزمایش جدید" onclick="ABApp.createLabSession(event)">＋ <span>جدید</span></button>`
      ),
      mkRoot('usage', '📊', 'آمار و پایش',
        mkLeaf('usage-overview', 'داشبورد کش، اسلات‌ها و هزینه', `${kvPct}%`, 'on') +
        mkLeaf('usage-agents', 'مقایسهٔ مدل‌ها و عامل‌ها') +
        mkLeaf('usage-xray', 'بازرس ترافیک (Wire X-Ray)')
      ),
      mkRoot('settings', '⚙️', 'تنظیمات',
        mkLeaf('set-hud', 'ظاهر و تجربهٔ کاربری') +
        mkLeaf('set-translate', 'مترجم و API آفلاین', trOn ? 'ON' : 'OFF', trOn ? 'on' : '') +
        mkLeaf('set-tap', 'مدل محلی و مدل‌های آنلاین') +
        mkLeaf('set-retention', 'نگهداری و پاکسازی', `${state.config.retention.days || '∞'}d`)
      )
    ].join('');
  }

  function renderHudBar() {
    if (!state) return;
    const up = state.upstream || {};
    const u = state.usage?.window || {};
    const ui = state.config.ui || {};
    const trEnabled = state.config.translation.enabled !== false;
    const activeTurns = state.active_conversation?.turns || [];
    const sessionTokenTotal = activeTurns.reduce((sum,t)=>sum+(t.metrics?.uncached_in||0)+(t.metrics?.cached_in||0)+(t.metrics?.out_tok||0),0);
    const latestMetrics = activeTurns[activeTurns.length-1]?.metrics || {};
    const lastPrompt = (latestMetrics.uncached_in||0)+(latestMetrics.cached_in||0);
    const contextCap = Number(up.server_ctx||0);
    const contextLeft = Math.max(0, contextCap-lastPrompt);

    document.documentElement.setAttribute('data-theme', ui.theme || 'openwebui-dark');
    document.documentElement.setAttribute('data-font', ui.font_scale || 'large');
    document.documentElement.setAttribute('data-box-style', ui.box_style || 'outlined');
    document.documentElement.setAttribute('data-think-style', ui.think_style || 'violet');
    document.documentElement.setAttribute('data-tool-style', ui.tool_style || 'cards');
    document.documentElement.setAttribute('data-translation-style', ui.translation_style || 'accent');
    document.documentElement.setAttribute('data-markdown-style', ui.markdown_style || 'reader');
    document.documentElement.setAttribute('data-image-size', ui.image_size || 'large');
    document.documentElement.setAttribute('data-paragraph-spacing', ui.paragraph_spacing || 'comfortable');
    document.documentElement.setAttribute('data-image-mode', ui.image_mode || 'click');
    document.documentElement.setAttribute('data-code-wrap', ui.code_wrap || 'scroll');
    document.documentElement.setAttribute('data-code-theme', ui.code_theme || 'midnight');
    document.documentElement.setAttribute('data-code-lines', ui.show_code_lines ? 'on' : 'off');
    document.documentElement.setAttribute('data-tool-output', ui.tool_output_mode || 'terminal');
    document.getElementById('shellRoot').classList.toggle('sidebar-right', ui.sidebar_side === 'right');

    const slotCount = up.slot_count || 1;
    document.getElementById('sbFoot').innerHTML = `
      <div><i class="led ${up.online ? 'ok' : 'warn'}"></i>MODEL: <span class="fg-1">${esc(up.detected_model)}</span></div>
      <div><i class="led ${up.online ? 'ok' : ''}"></i>SLOTS: <span class="fg-1">${slotCount} KV slot(s) · ctx ${up.server_ctx || '?'}</span></div>
      <div><i class="led ok"></i>DATA : <span class="fg-1">.data/ (${state.storage?.total_kib || 0} KiB)</span></div>
    `;

    const viewBadge = state.view_kind === 'lab'
      ? `Lab · ${state.active_conversation?.title || ''}`
      : (state.view_id ? `ترمینال · ${state.view_id}` : 'ترمینال زنده‌ای متصل نیست');

    document.getElementById('hudBar').innerHTML = `
      <div class="hud-group">
        <span class="hud-chip" style="color:var(--fg-0);font-weight:600;">${esc(viewBadge)}</span>
        <span class="hud-chip">${esc(up.detected_model)} (${slotCount} اسلات)</span>
        <span class="hud-chip" title="تقریبی بر اساس آخرین prompt گزارش‌شده؛ کانتکست سقف سرور است">این چت · ${activeTurns.length} دور · ${sessionTokenTotal.toLocaleString()} tok · آخرین زمینه ${lastPrompt.toLocaleString()} / ${contextCap ? contextCap.toLocaleString() : '?'} · مانده ~${contextCap ? contextLeft.toLocaleString() : '?'} </span>
      </div>
      <div class="hud-group">
        <button class="btn ghost ${trEnabled ? 'on' : ''}" onclick="ABApp.toggleProxyMode()">
          ${trEnabled ? 'ترجمه: روشن' : 'پروکسی خالص (ترجمه خاموش)'}
        </button>
        ${ui.show_inline_tokens ? `<span class="hud-chip">KV <strong style="color:var(--phosphor)">${u.cache_hit_pct || 0}%</strong> · ${(u.total_tokens || 0).toLocaleString()} tok</span>` : ''}
        ${ui.show_shadow_cost ? `<span class="hud-chip" style="cursor:pointer;" onclick="ABApp.navigate('usage-overview')" title="کلیک برای مقایسه هزینه مدل‌ها">$${Number(u.shadow_cost_usd || 0).toFixed(4)}</span>` : ''}
        <button class="btn ghost" onclick="ABApp.toggleSidebarSide()" title="تغییر جهت سایدبار">${ICONS.swap}</button>
      </div>
    `;
  }

  function renderMainPage(forceFull = false) {
    if (!state) return;
    const host = document.getElementById('pageHost');
    host.classList.toggle('is-chat', route === 'chat');
    if (route === 'home') {
      window.ABHomePage.render(host, state);
    } else if (route === 'chat') {
      window.ABChatPage.render(host, state, forceFull);
    } else if (route.startsWith('usage-')) {
      window.ABUsagePage.render(host, state, route);
    } else if (route.startsWith('set-')) {
      window.ABSettingsPage.render(host, state, route);
    }
    const alertId = 'modelAvailabilityAlert';
    host.querySelector(`#${alertId}`)?.remove();
    if (route === 'chat' && (state.model_status?.alert || (!state.model_status?.local_online && state.model_status?.fallback_enabled))) {
      const fallback = !state.model_status.alert && state.model_status.fallback_enabled;
      const banner = document.createElement('div');
      banner.id = alertId;
      banner.className = `model-availability-alert ${fallback ? 'fallback-ready' : ''}`;
      banner.innerHTML = fallback
        ? `<span>مدل لوکال در دسترس نیست؛ fallback آنلاین روشن است.</span><small>اگر درخواست به ابر برود، متن و تاریخچه به ارائه‌دهندهٔ آنلاین ارسال می‌شود.</small><button class="btn" onclick="ABApp.navigate('set-tap')">تنظیم fallback</button>`
        : `<span>مدل لوکال پیدا نشد یا در دسترس نیست.</span><small>آدرس ${esc(state.config.tap.upstream_url)} را بررسی کن، یا در تنظیمات مدل فهرست را بخوان و مدل را انتخاب کن.</small><button class="btn" onclick="ABApp.navigate('set-tap')">بازکردن تنظیمات مدل</button>`;
      host.prepend(banner);
    }
  }

  function renderVaultGate() {
    const locked = !!state?.model_vault?.locked;
    let gate = document.getElementById('modelVaultGate');
    if (!locked) { gate?.remove(); return; }
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'modelVaultGate';
      gate.className = 'model-vault-gate';
      document.body.appendChild(gate);
    }
    gate.innerHTML = `<section class="model-vault-card" dir="rtl"><div class="vault-lock-icon">🔐</div><h2>بازکردن خزانهٔ API</h2><p>کلیدهای حساب‌های آنلاین رمزگذاری شده‌اند. برای بازشدن این اجرا رمز اصلی را وارد کن.</p><form onsubmit="ABApp.unlockModelVault(event)"><input id="modelVaultPassphrase" type="password" autocomplete="current-password" placeholder="رمز اصلی" required><button class="btn primary" type="submit">بازکردن</button></form><div id="modelVaultError" role="status"></div></section>`;
  }

  async function unlockModelVault(event) {
    event?.preventDefault();
    const input = document.getElementById('modelVaultPassphrase');
    const error = document.getElementById('modelVaultError');
    try {
      await api('/api/models/unlock', { passphrase: input.value });
      input.value = '';
      const fresh = await api('/api/state');
      applyState(fresh, false);
    } catch (e) {
      input.value = '';
      error.textContent = `بازکردن ناموفق · ${e.message}`;
      input.focus();
    }
  }

  function withLiveWireTurn(nextState) {
    const now = Date.now();
    for (const [key, item] of liveWireTurns) {
      if (now - item.receivedAt > 120000) liveWireTurns.delete(key);
    }
    if (nextState?.view_kind !== 'mirror' || !nextState?.view_id) return nextState;
    const overlays = [...liveWireTurns.values()].filter(item => item.agent_id === nextState.view_id);
    if (!overlays.length) return nextState;
    const active = nextState.active_conversation || { agent_id: nextState.view_id, turns: [] };
    const turns = [...(active.turns || [])];
    for (const item of overlays) {
      if (!item.turn) continue;
      const index = turns.findIndex(turn => turn.id === item.turn.id);
      if (index >= 0) turns[index] = item.turn;
      else turns.push(item.turn);
    }
    return { ...nextState, session_state: 'GENERATING', active_conversation: { ...active, turns } };
  }

  function applyWireProgress(message) {
    const key = `${message.agent_id}:${message.stream_id}`;
    if (message.turn) liveWireTurns.set(key, { ...message, receivedAt: Date.now() });
    else liveWireTurns.delete(key);
    if (!baseState || baseState.view_kind !== 'mirror' || baseState.view_id !== message.agent_id) return;
    state = withLiveWireTurn(baseState);
    renderHudBar();
    renderMainPage(false);
  }

  function applyState(nextState, isFirst = false) {
    baseState = nextState;
    state = withLiveWireTurn(nextState);
    applySidebarWidth(state?.config?.ui?.sidebar_width);
    renderVaultGate();
    renderHudBar();
    renderTree();
    renderMainPage(isFirst);
  }

  function boot() {
    bindSidebarResizer();
    api('/api/state').then(s => applyState(s, true)).catch(() => {});
    let homePollBusy = false;
    window.setInterval(async () => {
      if (route !== 'home' || homePollBusy) return;
      homePollBusy = true;
      try { applyState(await api('/api/state'), false); } catch (_) {}
      finally { homePollBusy = false; }
    }, 12000);
    const connect = () => {
      const es = new EventSource('/api/events');
      es.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.kind === 'state') applyState(msg.state, false);
          else if (msg.kind === 'wire_progress') applyWireProgress(msg);
        } catch (_) {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 2500); };
    };
    connect();
  }

  return {
    getState, getRoute, navigate, toggleBranch,
    selectMirror, selectLab, createLabSession, renameLabSession, archiveLabSession, archiveMirror, deleteLabSession, deleteMirror,
    filterByObservedModel, toggleSidebarSide, toggleProxyMode,
    toggleSidebarCollapse, unlockModelVault, boot
  };
})();
