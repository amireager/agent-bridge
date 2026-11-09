// Central State Store — Dual Sidebar (Live Terminal Mirrors + Direct Model/Tool Lab), Theme & Font Scale
window.ABApp = (() => {
  const { ICONS, esc, api } = window.ABUtils;

  let state = null;
  let route = 'chat';
  const openBranches = {
    mirrors: true,
    lab: true,
    usage: true,
    settings: true
  };

  function getState() { return state; }
  function getRoute() { return route; }

  function navigate(nextRoute) {
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
    openBranches.lab = true;
    await api('/api/lab/new', {});
    route = 'chat';
  }

  async function deleteLabSession(sessionId, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/lab/delete', { session_id: sessionId });
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
          <span class="tiny-tag ${m.pty_live ? 'on' : ''}">${m.pty_live ? 'زنده' : m.turn_count}</span>
        </div>`;
    }).join('');

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
            ${state.lab_sessions.length > 1 ? `<span title="حذف تست" style="opacity:0.6;padding:0 4px;" onclick="ABApp.deleteLabSession('${esc(s.id)}',event)">×</span>` : ''}
          </span>
        </div>`;
    }).join('');

    const mkRoot = (key, icon, title, bodyHtml, extraAction = '') => `
      <div class="tree-group">
        <div class="tree-root-btn" onclick="ABApp.toggleBranch('${key}')">
          <span style="display:flex;align-items:center;gap:7px;">${icon}<span class="hide-collapsed">${title}</span></span>
          <span class="hide-collapsed" style="display:flex;align-items:center;gap:6px;">
            ${extraAction}
            ${openBranches[key] ? ICONS.chevronDown : ICONS.chevronRight}
          </span>
        </div>
        <div class="tree-children hide-collapsed ${openBranches[key] ? 'open' : ''}">
          ${bodyHtml}
        </div>
      </div>`;

    const mkLeaf = (rId, label, rightTag = '', tagCls = '') => `
      <button class="tree-node ${route === rId ? 'active' : ''}" onclick="ABApp.navigate('${rId}')">
        <span>· ${label}</span>
        ${rightTag ? `<span class="tiny-tag ${tagCls}">${rightTag}</span>` : ''}
      </button>`;

    const kvPct = state.usage?.window?.cache_hit_pct ?? 0;
    const trOn = state.config.translation.enabled !== false;

    treeEl.innerHTML = [
      mkRoot('mirrors', ICONS.terminal, 'ترمینال‌های زنده (Mirror)', mirrorHtml),
      mkRoot(
        'lab',
        ICONS.cpu,
        'تست مستقیم و ابزار (Lab)',
        labHtml,
        `<span class="tiny-tag on" title="ساخت صفحه تست جدید" onclick="ABApp.createLabSession(event)">+ جدید</span>`
      ),
      mkRoot('usage', ICONS.chart, 'شکارچی کش و توکن‌ها',
        mkLeaf('usage-overview', 'داشبورد کش، اسلات‌ها و هزینه', `${kvPct}%`, 'on') +
        mkLeaf('usage-agents', 'مقایسه مدل‌ها و ترمینال‌ها') +
        mkLeaf('usage-xray', 'بازرس بسته خام (Wire X-Ray)')
      ),
      mkRoot('settings', ICONS.sliders, 'تنظیمات',
        mkLeaf('set-translate', 'مترجم، پروکسی و API آفلاین', trOn ? 'ON' : 'OFF', trOn ? 'on' : '') +
        mkLeaf('set-hud', 'تم، فونت و کلیدهای نمایش') +
        mkLeaf('set-tap', 'اتصال محلی و دستورات اجرا') +
        mkLeaf('set-retention', 'نگهداری تاریخچه و پاکسازی', `${state.config.retention.days || '∞'}d`)
      )
    ].join('');
  }

  function renderHudBar() {
    if (!state) return;
    const up = state.upstream || {};
    const u = state.usage?.window || {};
    const ui = state.config.ui || {};
    const trEnabled = state.config.translation.enabled !== false;

    document.documentElement.setAttribute('data-theme', ui.theme || 'openwebui-dark');
    document.documentElement.setAttribute('data-font', ui.font_scale || 'large');
    document.getElementById('shellRoot').classList.toggle('sidebar-right', ui.sidebar_side === 'right');

    const slotCount = up.slot_count || 1;
    document.getElementById('sbFoot').innerHTML = `
      <div><i class="led ${up.online ? 'ok' : 'warn'}"></i>MODEL: <span class="fg-1">${esc(up.detected_model)}</span></div>
      <div><i class="led ${up.online ? 'ok' : ''}"></i>SLOTS: <span class="fg-1">${slotCount} KV slot(s) · ctx ${up.server_ctx || '?'}</span></div>
      <div><i class="led ok"></i>DATA : <span class="fg-1">.data/ (${state.storage?.total_kib || 0} KiB)</span></div>
    `;

    const viewBadge = state.view_kind === 'lab'
      ? `Lab · ${state.active_conversation?.title || ''}`
      : `ترمینال زنده · ${state.view_id}`;

    document.getElementById('hudBar').innerHTML = `
      <div class="hud-group">
        <span class="hud-chip" style="color:var(--fg-0);font-weight:600;">${esc(viewBadge)}</span>
        <span class="hud-chip">${esc(up.detected_model)} (${slotCount} اسلات)</span>
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
    if (route === 'chat') {
      window.ABChatPage.render(host, state, forceFull);
    } else if (route.startsWith('usage-')) {
      window.ABUsagePage.render(host, state, route);
    } else if (route.startsWith('set-')) {
      window.ABSettingsPage.render(host, state, route);
    }
  }

  function applyState(nextState, isFirst = false) {
    state = nextState;
    renderHudBar();
    renderTree();
    renderMainPage(isFirst);
  }

  function boot() {
    api('/api/state').then(s => applyState(s, true)).catch(() => {});
    const connect = () => {
      const es = new EventSource('/api/events');
      es.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.kind === 'state') applyState(msg.state, false);
        } catch (_) {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 2500); };
    };
    connect();
  }

  return {
    getState, getRoute, navigate, toggleBranch,
    selectMirror, selectLab, createLabSession, deleteLabSession,
    filterByObservedModel, toggleSidebarSide, toggleProxyMode,
    toggleSidebarCollapse, boot
  };
})();
