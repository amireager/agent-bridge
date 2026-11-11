// Operations-grade routing console: live ingress, selected translation engine, actual target and request history.
window.ABHomePage = (() => {
  const { esc } = window.ABUtils;

  const ENGINE_NAMES = {
    'builtin-online': 'Built-in Online',
    online: 'Built-in Online',
    'online-google': 'Google Translate',
    'online-google-gtx': 'Google Translate · GTX',
    'online-mymemory': 'MyMemory',
    'custom-offline': 'Offline translator',
  };

  function providerLabel(provider, routeMode = '') {
    if (provider === 'local' || routeMode === 'local') return 'سرور مدل محلی';
    if (routeMode === 'online-fallback') return `${provider || 'ارائه‌دهندهٔ آنلاین'} · fallback`;
    return provider || 'مقصد در نسخهٔ قدیمی ثبت نشده';
  }

  function routeModeLabel(mode) {
    if (mode === 'online') return 'مسیر آنلاین';
    if (mode === 'online-fallback') return 'Fallback آنلاین';
    if (mode === 'local') return 'مسیر محلی';
    return 'مسیر قدیمی / ثبت‌نشده';
  }

  function render(host, state) {
    const upstream = state.upstream || {};
    const config = state.config || {};
    const modelsCfg = config.models || {};
    const translation = config.translation || {};
    const mirrors = (state.mirrors || []).filter(agent => agent.pty_live && !agent.archived);
    const labs = (state.lab_sessions || []).filter(session => !session.archived);
    const activeRoutes = Array.isArray(state.active_routes) ? state.active_routes : [];
    const recent = (state.usage?.recent || []).slice(0, 5);
    const isOnlineMode = modelsCfg.default_mode === 'online';
    const vault = state.model_vault || {};
    const activeAccount = (vault.accounts || []).find(account => account.id === modelsCfg.active_account_id && account.enabled !== false);
    const providerName = activeAccount
      ? (state.model_providers?.[activeAccount.provider]?.name || activeAccount.provider || 'Online provider')
      : (vault.locked && isOnlineMode ? 'خزانهٔ حساب‌ها قفل است' : 'حساب آنلاین انتخاب نشده');
    const localModel = String(modelsCfg.default_model || upstream.detected_model || '').trim();
    const targetModel = isOnlineMode ? String(modelsCfg.online_model || '').trim() : localModel;
    const actualModelNames = [...new Set((upstream.available_models || []).filter(Boolean).map(String))];
    const translatorEnabled = translation.enabled !== false;
    const engineKey = String(translation.engine || 'builtin-online');
    const engineName = engineKey === 'custom-offline'
      ? `${translation.offline_model || 'مدل مترجم محلی'} · ${translation.offline_protocol === 'rest' ? 'REST' : 'OpenAI-compatible'}`
      : (ENGINE_NAMES[engineKey] || engineKey);
    const translatorReady = engineKey === 'custom-offline' ? Boolean(state.translator_online) : true;
    const targetReady = isOnlineMode
      ? Boolean(activeAccount && targetModel && !vault.locked && !state.model_status?.alert)
      : Boolean(upstream.online);
    const targetStatus = isOnlineMode
      ? (vault.locked ? 'خزانه قفل است' : (targetReady ? 'حساب و مدل انتخاب شده' : 'پیکربندی آنلاین ناقص'))
      : (upstream.online ? 'اتصال سرور برقرار' : 'سرور مدل قطع است');
    const targetProviderLabel = isOnlineMode ? providerName : 'Inference محلی';
    const modelPool = isOnlineMode
      ? (targetModel ? [targetModel] : [])
      : actualModelNames;

    const sourceCards = mirrors.map(agent => {
      const busy = agent.activity === 'GENERATING';
      return `
        <button class="source-card ${busy ? 'is-busy' : ''}" type="button" data-agent="${esc(agent.agent_id)}" aria-label="بازکردن نشست ${esc(agent.agent_id)}">
          <span class="source-card-mark" aria-hidden="true">TTY</span>
          <span class="source-card-text"><strong>${esc(agent.agent_id)}</strong><small>${busy ? 'در حال درخواست' : 'PTY زنده · آماده'}</small></span>
          <span class="source-state ${busy ? 'busy' : ''}"><i></i>${busy ? 'BUSY' : 'LIVE'}</span>
        </button>`;
    }).join('');

    const labCards = labs.slice(0, 3).map(session => `
      <button class="lab-source" type="button" data-lab="${esc(session.id)}" title="بازکردن نشست Lab ${esc(session.title)}">
        <span class="lab-source-dot"></span><span>${esc(session.title)}</span><small>${Number(session.turn_count || 0)} دور</small>
      </button>`).join('');
    const remainingLabs = Math.max(0, labs.length - 3);
    const sourceEmpty = !mirrors.length && !labs.length
      ? '<div class="source-empty">هیچ ورودی فعالی پیدا نشد.<br><small>ترمینال را با wrapper اجرا کن یا یک نشست Lab بساز.</small></div>'
      : '';

    const localModelsHtml = modelPool.length
      ? `<div class="model-chips">${modelPool.slice(0, 5).map(name => `<span class="model-chip ${name === targetModel ? 'selected' : ''}" title="${esc(name)}"><i></i>${esc(name)}</span>`).join('')}${modelPool.length > 5 ? `<span class="model-chip more">+${modelPool.length - 5} مدل</span>` : ''}</div>`
      : '<div class="target-unavailable">مدلی برای مسیر انتخاب‌شده گزارش نشده است.</div>';

    const activeRouteRows = activeRoutes.map(route => `
      <div class="inflight-row">
        <span class="inflight-led"></span>
        <strong>${esc(route.agent_id || 'ورودی نامشخص')}</strong>
        <span class="inflight-arrow">→</span>
        <span>${esc(providerLabel(route.provider, route.route_mode))}</span>
        <span class="inflight-arrow">→</span>
        <b>${esc(route.model || 'مدل در حال resolve')}</b>
        <small>${esc(routeModeLabel(route.route_mode))} · در حال اجرا</small>
      </div>`).join('');

    const requestRows = recent.length
      ? recent.map(request => `
          <article class="request-row">
            <div class="request-source"><span class="request-index">${String(request.id || '').padStart(4, '0')}</span><strong>${esc(request.agent || 'منبع نامشخص')}</strong><small>${esc(request.time || '')}</small></div>
            <span class="request-arrow" aria-hidden="true">⟶</span>
            <div class="request-destination"><strong>${esc(request.model || 'مدل نامشخص')}</strong><small>${esc(providerLabel(request.provider, request.route_mode))} · ${esc(routeModeLabel(request.route_mode))}</small></div>
            <div class="request-metrics"><span>${Number(request.total_in || 0).toLocaleString()} in</span><span>${Number(request.out_tok || 0).toLocaleString()} out</span></div>
          </article>`).join('')
      : '<div class="request-empty">هنوز درخواست تکمیل‌شده‌ای برای نمایش ثبت نشده است.</div>';

    const engineStatus = !translatorEnabled ? 'BYPASS' : (engineKey === 'custom-offline' && !translatorReady ? 'OFFLINE' : 'SELECTED');
    const engineDetail = !translatorEnabled
      ? 'ترجمه خاموش است؛ متن بدون عبور از مترجم می‌رود.'
      : (engineKey === 'custom-offline'
        ? (translatorReady ? 'موتور آفلاین پاسخ‌گو است.' : 'موتور انتخاب شده، اما health check پاسخ نمی‌دهد.')
        : 'موتور آنلاین انتخاب شده؛ مسیر مستقیم CLI الزاماً از ترجمه عبور نمی‌کند.');
    const bridgeStatus = activeRoutes.length ? `${activeRoutes.length} درخواست در پرواز` : 'در انتظار درخواست';

    host.innerHTML = `
      <main class="ab-home ops-console" dir="rtl">
        <header class="ops-header">
          <div class="ops-title-block">
            <span class="ops-eyebrow"><i></i> AGENT BRIDGE / ROUTE CONTROL</span>
            <h1>کنسول مسیر درخواست</h1>
            <p>منبع ورودی، موتور پردازش و مقصد واقعی را در یک نمای عملیاتی ببین.</p>
          </div>
          <div class="ops-header-state ${targetReady ? 'is-ready' : 'is-warning'}">
            <span class="state-square"></span><div><strong>${esc(targetStatus)}</strong><small>${isOnlineMode ? 'ROUTE · ONLINE' : 'ROUTE · LOCAL'} · /v1</small></div>
          </div>
          <div class="ops-actions">
            <button class="btn primary" type="button" data-action="chat">بازکردن نشست</button>
            <button class="btn" type="button" data-action="models">مسیر مدل</button>
          </div>
        </header>

        <section class="ops-metrics" aria-label="خلاصهٔ وضعیت سیستم">
          <article class="metric-card"><span class="metric-label">PTYهای زنده</span><strong>${mirrors.length.toString().padStart(2, '0')}</strong><small>نشست ترمینال مستقل</small><i class="metric-accent cyan"></i></article>
          <article class="metric-card"><span class="metric-label">نشست‌های Lab</span><strong>${labs.length.toString().padStart(2, '0')}</strong><small>${remainingLabs ? `+${remainingLabs} بیشتر در فهرست` : 'فضای داخلی مستقل'}</small><i class="metric-accent violet"></i></article>
          <article class="metric-card"><span class="metric-label">مدل مقصد</span><strong class="metric-model" title="${esc(targetModel || 'تنظیم نشده')}">${esc(targetModel || 'تنظیم نشده')}</strong><small>${esc(targetProviderLabel)}</small><i class="metric-accent ${targetReady ? 'green' : 'amber'}"></i></article>
          <article class="metric-card"><span class="metric-label">موتور ترجمه</span><strong class="metric-engine" title="${esc(engineName)}">${esc(engineName)}</strong><small>${translatorEnabled ? engineStatus : 'خاموش · متن مستقیم'}</small><i class="metric-accent amber"></i></article>
        </section>

        <section class="route-board" aria-labelledby="routeTitle">
          <header class="section-head">
            <div><span class="section-code">01 / LIVE TOPOLOGY</span><h2 id="routeTitle">نقشهٔ اجزا و مسیر جاری</h2><p>نقشه، اجزای ثبت‌شده را نشان می‌دهد؛ مبدأ و مقصد هر درخواست جاری فقط از دادهٔ runtime در ردیف پایین گزارش می‌شوند.</p></div>
            <div class="route-live-indicator ${activeRoutes.length ? 'is-flowing' : ''}"><i></i><span>${esc(bridgeStatus)}</span><code>127.0.0.1:${Number(state.bridge_port || 18080)}</code></div>
          </header>

          <div class="route-stage ${activeRoutes.length ? 'has-traffic' : ''}" dir="ltr">
            <svg class="route-wires" viewBox="0 0 1000 460" preserveAspectRatio="none" role="presentation" aria-hidden="true">
              <defs>
                <linearGradient id="wireIngress" x1="0" x2="1"><stop offset="0" stop-color="#20c8dc" stop-opacity=".12"/><stop offset="1" stop-color="#20c8dc" stop-opacity=".8"/></linearGradient>
                <linearGradient id="wireEgress" x1="0" x2="1"><stop offset="0" stop-color="#76d9a4" stop-opacity=".8"/><stop offset="1" stop-color="#76d9a4" stop-opacity=".12"/></linearGradient>
              </defs>
              <path class="wire-track" d="M294 185 C360 185 370 225 435 225"/>
              <path class="wire-track" d="M294 250 C360 250 370 225 435 225"/>
              <path class="wire-track" d="M565 225 C630 225 640 185 706 185"/>
              <path class="wire-track" d="M565 225 C630 225 640 250 706 250"/>
              <path class="wire-signal ingress" d="M294 185 C360 185 370 225 435 225"/>
              <path class="wire-signal ingress" d="M294 250 C360 250 370 225 435 225"/>
              <path class="wire-signal egress" d="M565 225 C630 225 640 185 706 185"/>
              <path class="wire-signal egress" d="M565 225 C630 225 640 250 706 250"/>
              <circle class="wire-port" cx="294" cy="185" r="5"/><circle class="wire-port" cx="294" cy="250" r="5"/>
              <circle class="wire-port core-port" cx="435" cy="225" r="5"/><circle class="wire-port core-port" cx="565" cy="225" r="5"/>
              <circle class="wire-port target-port" cx="706" cy="185" r="5"/><circle class="wire-port target-port" cx="706" cy="250" r="5"/>
            </svg>

            <section class="route-node ingress-node" dir="rtl" aria-label="منابع ورودی واقعی">
              <div class="node-heading"><div><span class="node-kicker">INGRESS / 01</span><h3>ورودی‌ها</h3></div><span class="node-count">${mirrors.length + labs.length}</span></div>
              <div class="source-subhead"><span>ترمینال‌های مستقل</span><b>${mirrors.length} LIVE</b></div>
              <div class="source-grid">${sourceCards || (!labs.length ? '<div class="source-empty compact">ترمینال زنده‌ای متصل نیست.</div>' : '')}</div>
              <div class="source-subhead lab-subhead"><span>Lab داخلی</span><b>${labs.length} SESSION</b></div>
              <div class="lab-source-list">${labCards || '<span class="lab-empty">نشست Lab ثبت نشده</span>'}${remainingLabs ? `<span class="lab-more">+${remainingLabs} نشست دیگر</span>` : ''}</div>
            </section>

            <section class="route-core-column" dir="rtl" aria-label="موتورهای Agent Bridge">
              <div class="bridge-node ${activeRoutes.length ? 'is-working' : ''}">
                <div class="bridge-node-top"><span class="bridge-symbol">AB</span><span class="bridge-node-state"><i></i>${activeRoutes.length ? 'ROUTING' : 'READY'}</span></div>
                <span class="node-kicker">LOCAL GATEWAY</span><h3>Agent Bridge</h3>
                <p>ورودی یکتا · پراکسی · مدیریت نشست</p>
                <code>/v1 · :${Number(state.bridge_port || 18080)}</code>
              </div>
              <div class="translation-node ${!translatorEnabled ? 'is-bypassed' : (translatorReady ? 'is-selected' : 'is-warning')}">
                <span class="translation-mark">TR</span><div class="translation-copy"><span class="node-kicker">LANGUAGE ENGINE</span><strong>${esc(engineName)}</strong><small>${esc(engineDetail)}</small></div>
                <span class="engine-state">${esc(engineStatus)}</span>
              </div>
            </section>

            <section class="route-node destination-node" dir="rtl" aria-label="مقصد انتخاب‌شده">
              <div class="node-heading"><div><span class="node-kicker">EGRESS / 02</span><h3>مقصد مدل</h3></div><span class="destination-mode">${isOnlineMode ? 'ONLINE' : 'LOCAL'}</span></div>
              <div class="target-primary ${targetReady ? 'ready' : 'offline'}">
                <span class="target-icon">${isOnlineMode ? 'EXT' : 'LLM'}</span>
                <div class="target-copy"><strong>${esc(targetModel || 'مدل انتخاب نشده')}</strong><small>${esc(targetProviderLabel)}</small></div>
                <span class="target-health"><i></i>${targetReady ? (isOnlineMode ? 'SELECTED' : 'LIVE') : 'CHECK'}</span>
              </div>
              <div class="target-status-line"><span class="status-led ${targetReady ? 'on' : 'warn'}"></span>${esc(targetStatus)}</div>
              <div class="target-model-list"><span class="source-subhead-label">${isOnlineMode ? 'مدل آنلاین انتخاب‌شده' : `فهرست واقعی سرور · ${actualModelNames.length}`}</span>${localModelsHtml}</div>
              <button class="target-settings" type="button" data-action="models">تغییر مدل یا مسیر <span>↗</span></button>
            </section>
          </div>

          <div class="active-routes" aria-live="polite">
            ${activeRouteRows || '<div class="route-idle"><span></span>در حال حاضر درخواست فعالی در مسیر نیست؛ اتصال‌ها بر اساس وضعیت واقعی مؤلفه‌ها نمایش داده شده‌اند.</div>'}
          </div>
          <footer class="route-legend"><span><i class="legend-source"></i>ورودی‌های زنده</span><span><i class="legend-bridge"></i>هستهٔ Bridge</span><span><i class="legend-target"></i>مقصد انتخاب‌شده / مدل گزارش‌شده</span><span class="legend-note">نام ارائه‌دهنده فقط پس از ثبت درخواست واقعی نمایش داده می‌شود.</span></footer>
        </section>

        <section class="request-board" aria-labelledby="requestTitle">
          <header class="section-head request-head">
            <div><span class="section-code">02 / ROUTE AUDIT</span><h2 id="requestTitle">درخواست‌های اخیر</h2><p>مبدأ → ارائه‌دهنده و مدل پاسخ‌گو؛ ردیف‌های قدیمی ممکن است پیش از ثبت مقصد ایجاد شده باشند.</p></div>
            <button class="text-action" type="button" data-action="usage">گزارش کامل توکن‌ها <span>↗</span></button>
          </header>
          <div class="request-list">${requestRows}</div>
        </section>

        <details class="guide-section" id="connectionGuides">
          <summary class="guide-summary"><span><span class="section-code">03 / OPERATIONS</span><strong>راه‌اندازی و اتصال</strong><small>راهنمای کوتاه · قابل‌بستن</small></span><span class="guide-toggle">بازکردن راهنما <b>＋</b></span></summary>
          <div class="guide-content">
            <div class="guide-grid">
              <article class="guide-card"><span class="guide-number">01</span><h3>راه‌اندازی Bridge</h3><p>یک‌بار اجرا کن؛ داشبورد و ورودی سازگار با OpenAI از همین سرویس در دسترس‌اند.</p><div class="guide-command"><code>python3 bridge.py --host 127.0.0.1 --port 18080</code></div></article>
              <article class="guide-card"><span class="guide-number">02</span><h3>اتصال یک CLI</h3><p>برای هر عامل یک wrapper مستقل اجرا کن؛ نام‌گذاری خودکار و تاریخچهٔ جدا حفظ می‌شود.</p><div class="guide-command"><code>python3 cli.py --wrap pi</code></div></article>
              <article class="guide-card"><span class="guide-number">03</span><h3>انتخاب مسیر</h3><p>موتور ترجمه و مدل محلی/آنلاین را از تنظیمات بازبینی کن؛ مقصد درخواست در گزارش‌ها ثبت می‌شود.</p><div class="guide-actions"><button class="btn" type="button" data-action="translator">تنظیم مترجم</button><button class="btn" type="button" data-action="models">تنظیم مدل</button></div></article>
            </div>
          </div>
        </details>

        <footer class="ops-footer"><span>AB / LOCAL OPERATIONS CONSOLE</span><span>پیکربندی و تاریخچه در <code>./.data/</code> · هیچ کلید API در نمای مسیر نمایش داده نمی‌شود.</span></footer>
      </main>`;

    host.querySelector('[data-action="chat"]')?.addEventListener('click', () => window.ABApp.navigate('chat'));
    host.querySelectorAll('[data-action="models"]').forEach(button => button.addEventListener('click', () => window.ABApp.navigate('set-tap')));
    host.querySelector('[data-action="translator"]')?.addEventListener('click', () => window.ABApp.navigate('set-translate'));
    host.querySelector('[data-action="usage"]')?.addEventListener('click', () => window.ABApp.navigate('usage-overview'));
    host.querySelectorAll('[data-agent]').forEach(button => button.addEventListener('click', () => window.ABApp.selectMirror(button.dataset.agent)));
    host.querySelectorAll('[data-lab]').forEach(button => button.addEventListener('click', () => window.ABApp.selectLab(button.dataset.lab)));
  }

  return { render };
})();
