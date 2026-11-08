// Central State Store, Expandable Left Tree Sidebar, HUD Bar, and Router
window.ABApp = (() => {
  const { ICONS, esc, api } = window.ABUtils;

  let state = null;
  let route = 'chat'; // chat | usage-overview | usage-models | usage-agents | usage-xray | set-translate | set-hud | set-tap | set-retention
  const openBranches = {
    agents: true,
    'agent-pi': true,
    usage: true,
    'obs-models': true,
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

  async function selectAgentSession(agentId, sessionId) {
    openBranches['agent-' + agentId] = true;
    await api('/api/session/select', { agent_id: agentId, session_id: sessionId });
    route = 'chat';
    renderTree();
  }

  async function createAgentSession(agentId, ev) {
    if (ev) ev.stopPropagation();
    openBranches['agent-' + agentId] = true;
    await api('/api/session/new', { agent_id: agentId });
    route = 'chat';
  }

  async function deleteAgentSession(agentId, sessionId, ev) {
    if (ev) ev.stopPropagation();
    await api('/api/session/delete', { agent_id: agentId, session_id: sessionId });
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

  function toggleSidebarCollapse() {
    document.getElementById('sidebar').classList.toggle('collapsed');
  }

  function renderTree() {
    if (!state) return;
    const treeEl = document.getElementById('sbTree');
    if (!treeEl) return;

    // 1. Nested Agent -> Sessions Tree
    const agentNodes = (state.agent_tree || []).map(ag => {
      const bKey = 'agent-' + ag.id;
      if (openBranches[bKey] === undefined) openBranches[bKey] = (ag.id === state.active_agent);
      const isOpen = !!openBranches[bKey];
      const isAgActive = state.active_agent === ag.id;

      const sessHtml = (ag.sessions || []).map(s => {
        const isCurrent = isAgActive && state.active_session?.id === s.id && route === 'chat';
        return `
          <div class="tree-node ${isCurrent ? 'active' : ''}" onclick="ABApp.selectAgentSession('${esc(ag.id)}','${esc(s.id)}')">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <span class="node-indicator mono">›</span> ${esc(s.title)}
            </span>
            <span style="display:flex;align-items:center;gap:4px;">
              <span class="tiny-tag">${s.turn_count}</span>
              ${ag.sessions.length > 1 ? `<span title="حذف نشست" style="opacity:0.55;padding:0 3px;" onclick="ABApp.deleteAgentSession('${esc(ag.id)}','${esc(s.id)}',event)">×</span>` : ''}
            </span>
          </div>`;
      }).join('');

      return `
        <div>
          <div class="tree-node ${isAgActive && route === 'chat' ? 'active' : ''}" onclick="ABApp.toggleBranch('${esc(bKey)}')">
            <span style="display:flex;align-items:center;gap:6px;">
              ${isOpen ? ICONS.chevronDown : ICONS.chevronRight}
              <span class="mono">${esc(ag.label)}</span>
            </span>
            <span style="display:flex;align-items:center;gap:4px;">
              <span class="tiny-tag" title="نشست جدید برای این عامل" onclick="ABApp.createAgentSession('${esc(ag.id)}',event)">+</span>
            </span>
          </div>
          <div class="tree-sub-children ${isOpen ? 'open' : ''}">
            ${sessHtml}
          </div>
        </div>`;
    }).join('');

    // 2. Nested Observed Models Sub-Tree under Telemetry
    const obsModels = state.usage?.observed_models || [];
    const curModelFilter = state.usage?.model_filter || 'all';
    const modelsSubOpen = !!openBranches['obs-models'];
    const obsModelSubTree = `
      <div>
        <div class="tree-node ${route === 'usage-models' ? 'active' : ''}" onclick="ABApp.toggleBranch('obs-models')">
          <span style="display:flex;align-items:center;gap:6px;">
            ${modelsSubOpen ? ICONS.chevronDown : ICONS.chevronRight}
            <span>فیلتر مدل‌های عبوری</span>
          </span>
          <span class="tiny-tag">${obsModels.length}</span>
        </div>
        <div class="tree-sub-children ${modelsSubOpen ? 'open' : ''}">
          <div class="tree-node ${curModelFilter === 'all' && route === 'usage-overview' ? 'active' : ''}" onclick="ABApp.filterByObservedModel('all')">
            <span class="mono">· all-models</span>
          </div>
          ${obsModels.map(m => `
            <div class="tree-node ${curModelFilter === m && route === 'usage-overview' ? 'active' : ''}" onclick="ABApp.filterByObservedModel('${esc(m)}')">
              <span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(m)}">· ${esc(m)}</span>
            </div>
          `).join('')}
        </div>
      </div>`;

    const mkRoot = (key, icon, title, bodyHtml) => `
      <div class="tree-group">
        <button class="tree-root-btn" onclick="ABApp.toggleBranch('${key}')">
          <span style="display:flex;align-items:center;gap:7px;">${icon}<span class="hide-collapsed">${title}</span></span>
          <span class="hide-collapsed">${openBranches[key] ? ICONS.chevronDown : ICONS.chevronRight}</span>
        </button>
        <div class="tree-children hide-collapsed ${openBranches[key] ? 'open' : ''}">
          ${bodyHtml}
        </div>
      </div>`;

    const mkLeaf = (rId, label, rightTag = '') => `
      <button class="tree-node ${route === rId ? 'active' : ''}" onclick="ABApp.navigate('${rId}')">
        <span><span class="node-indicator mono">·</span> ${label}</span>
        ${rightTag ? `<span class="tiny-tag">${rightTag}</span>` : ''}
      </button>`;

    const kvPct = state.usage?.window?.cache_hit_pct ?? 0;

    treeEl.innerHTML = [
      mkRoot('agents', ICONS.terminal, 'Agents / چت و نشست‌ها', agentNodes),
      mkRoot('usage', ICONS.chart, 'Telemetry / توکن و کش',
        mkLeaf('usage-overview', 'کنتور کش، توکن و هزینه', `KV ${kvPct}%`) +
        obsModelSubTree +
        mkLeaf('usage-agents', 'مقایسه مدل‌ها و عامل‌ها') +
        mkLeaf('usage-xray', 'بازرس پیام خام (X-Ray)')
      ),
      mkRoot('settings', ICONS.sliders, 'Config / تنظیمات',
        mkLeaf('set-translate', 'مترجم و واژه‌نامه', state.config.translation.engine) +
        mkLeaf('set-hud', 'نمایش چت و توکن‌ها') +
        mkLeaf('set-tap', 'شنود (/v1) و ترمینال') +
        mkLeaf('set-retention', 'نگهداری تاریخچه و .data', `${state.config.retention.days || '∞'}d`)
      )
    ].join('');
  }

  function renderHudBar() {
    if (!state) return;
    const up = state.upstream || {};
    const u = state.usage?.window || {};
    const ui = state.config.ui || {};

    document.getElementById('shellRoot').classList.toggle('sidebar-right', ui.sidebar_side === 'right');
    document.documentElement.setAttribute('data-theme', ui.theme || 'hacker-dark');

    document.getElementById('sbFoot').innerHTML = `
      <div><i class="led ${up.online ? 'ok' : 'warn'}"></i>TAP : <span class="fg-1">:18080/v1 → ${esc(up.detected_model)}</span></div>
      <div><i class="led ${state.translator_online ? 'ok' : ''}"></i>TR  : <span class="fg-1">${esc(state.config.translation.engine)}</span></div>
      <div><i class="led ok"></i>DATA: <span class="fg-1">.data/ (${state.storage?.total_kib || 0} KiB)</span></div>
    `;

    const modelBadge = (state.usage?.model_filter && state.usage.model_filter !== 'all')
      ? `filter:${state.usage.model_filter}`
      : `model:${up.detected_model}`;

    document.getElementById('hudBar').innerHTML = `
      <div class="hud-group">
        <span class="hud-chip state-${esc(state.session_state)}">[${esc(state.session_state)}]</span>
        <span class="hud-chip">agent:<strong style="color:var(--fg-0)">${esc(state.active_agent)}</strong></span>
        <span class="hud-chip">${esc(modelBadge)}</span>
        ${up.peak_kv_mb_q8 ? `<span class="hud-chip">kv_vol:~${up.peak_kv_mb_q8}MB</span>` : ''}
      </div>
      <div class="hud-group">
        ${ui.show_inline_tokens ? `<span class="hud-chip">kv_hit:<strong style="color:var(--phosphor)">${u.cache_hit_pct || 0}%</strong> · tok:${(u.total_tokens || 0).toLocaleString()}</span>` : ''}
        ${ui.show_shadow_cost ? `<span class="hud-chip">est:$${Number(u.shadow_cost_usd || 0).toFixed(4)}</span>` : ''}
        <button class="btn ghost" onclick="ABApp.toggleSidebarSide()" title="تغییر جهت سایدبار">${ICONS.swap} ${ui.sidebar_side === 'left' ? 'L→R' : 'R→L'}</button>
      </div>
    `;
  }

  function renderMainPage(forceFull = false) {
    if (!state) return;
    const host = document.getElementById('pageHost');
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
    selectAgentSession, createAgentSession, deleteAgentSession,
    filterByObservedModel, toggleSidebarSide, toggleSidebarCollapse, boot
  };
})();
