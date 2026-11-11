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

  function translationStatusLabel(status) {
    if (status === 'used') return 'استفاده از مترجم ثبت شد';
    if (status === 'bypassed') return 'بدون عبور از مترجم';
    return 'مصرف مترجم نامعلوم';
  }

  function render(host, state) {
    const upstream = state.upstream || {};
    const config = state.config || {};
    const modelsCfg = config.models || {};
    const translation = config.translation || {};
    const mirrors = (state.mirrors || []).filter(agent => agent.pty_live && !agent.archived);
    const labs = (state.lab_sessions || []).filter(session => !session.archived);
    const activeRoutes = Array.isArray(state.active_routes) ? state.active_routes : [];
    const successfulRequests = state.usage?.recent || [];
    const failedRequests = state.usage?.recent_failures || [];
    const recent = [...successfulRequests, ...failedRequests]
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, 5);
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
    const targetConfigured = Boolean(activeAccount && targetModel && !vault.locked);
    const targetAvailable = !isOnlineMode && Boolean(upstream.online);
    const targetNodeState = isOnlineMode
      ? (targetConfigured ? 'configured' : 'offline')
      : (targetAvailable ? 'ready' : 'offline');
    const targetStatus = isOnlineMode
      ? (vault.locked ? 'خزانه قفل است' : (targetConfigured ? 'حساب و مدل انتخاب شده · اتصال مقصد تست نشده' : 'پیکربندی آنلاین ناقص'))
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
        <small>${esc(routeModeLabel(route.route_mode))} · ${esc(translationStatusLabel(route.translation_status))} · در حال اجرا</small>
      </div>`).join('');

    const failureLabels = {
      configuration: 'تنظیم مقصد یا حساب کامل نیست',
      'upstream-http': 'مقصد پاسخ HTTP ناموفق داده است',
      connection: 'اتصال به مقصد برقرار نشد',
      fallback: 'مسیر fallback نیز ناموفق شد',
    };
    const requestRows = recent.length
      ? recent.map(request => {
        const failed = request.status === 'failed';
        const requestMode = routeModeLabel(request.route_mode);
        const statusLabel = failed ? 'ناموفق' : 'پاسخ گرفت';
        const eventId = `${failed ? 'F' : 'R'}${String(request.id || '').padStart(4, '0')}`;
        const timing = Number(request.latency_ms || 0);
        const inputReported = request.input_count_reported === true;
        const cacheReported = request.cache_count_reported === true;
        const outputReported = request.output_count_reported === true;
        const costReported = inputReported && cacheReported && outputReported;
        return `
          <article class="request-card ${failed ? 'is-failed' : 'is-success'}">
            <div class="request-row">
              <div class="request-source"><span class="request-index">${eventId}</span><strong>${esc(request.agent || 'منبع نامشخص')}</strong><small>${esc(request.time || '')} · ${esc(statusLabel)}</small></div>
              <span class="request-arrow" aria-hidden="true">⟶</span>
              <div class="request-destination"><strong>${esc(request.model || (failed ? 'مقصد پاسخ نداد' : 'مدل نامشخص'))}</strong><small>${esc(providerLabel(request.provider, request.route_mode))} · ${esc(requestMode)}</small></div>
              <div class="request-metrics">${failed ? `<span class="request-fail-badge">ناموفق${request.http_status ? ` · HTTP ${Number(request.http_status)}` : ''}</span>` : `<span>${inputReported ? `${Number(request.total_in || 0).toLocaleString()} in` : 'in نامعلوم'}</span><span>${outputReported ? `${Number(request.out_tok || 0).toLocaleString()} out` : 'out نامعلوم'}</span>`}<span>${timing ? `${timing.toLocaleString()} ms` : 'زمان نامعلوم'}</span></div>
            </div>
            <details class="request-detail">
              <summary>جزئیات درخواست</summary>
              <div class="request-detail-grid">
                <span>شناسهٔ نشست <b>${esc(request.session_id || request.agent || 'ثبت نشده')}</b></span>
                <span>مسیر <b>${esc(requestMode)}</b></span>
                <span>مبدأ <b>${esc(request.agent || 'نامشخص')}</b></span>
                <span>مدت‌زمان <b>${timing ? `${timing.toLocaleString()} ms` : 'ثبت نشده'}</b></span>
                ${failed
                  ? `<span class="request-detail-wide">نتیجه <b>${esc(failureLabels[request.error_kind] || 'درخواست ناموفق')}</b>${request.http_status ? ` · HTTP ${Number(request.http_status)}` : ''}</span>`
                  : `<span>ورودی <b>${inputReported ? `${Number(request.total_in || 0).toLocaleString()} توکن` : 'گزارش نشده'}</b></span><span>از ورودی، cache <b>${cacheReported ? `${Number(request.cached_in || 0).toLocaleString()} توکن` : 'گزارش نشده'}</b></span><span>خروجی <b>${outputReported ? `${Number(request.out_tok || 0).toLocaleString()} توکن` : 'گزارش نشده'}</b></span><span>هزینهٔ سایه، تخمینی <b>${costReported ? `$${Number(request.cost_usd || 0).toFixed(5)}` : 'دادهٔ توکن ناقص'}</b></span>`}
                <span class="request-detail-wide">مترجم <b>${esc(translationStatusLabel(request.translation_status))}</b></span>
              </div>
            </details>
          </article>`;
      }).join('')
      : '<div class="request-empty">هنوز درخواستی برای نمایش ثبت نشده است.</div>';

    const engineStatus = !translatorEnabled ? 'BYPASS' : (engineKey === 'custom-offline' && !translatorReady ? 'OFFLINE' : 'SELECTED');
    const engineDetail = !translatorEnabled
      ? 'ترجمه خاموش است؛ متن بدون عبور از مترجم می‌رود.'
      : (engineKey === 'custom-offline'
        ? (translatorReady ? 'موتور آفلاین پاسخ‌گو است.' : 'موتور انتخاب شده، اما health check پاسخ نمی‌دهد.')
        : 'موتور آنلاین انتخاب شده؛ مسیر مستقیم CLI الزاماً از ترجمه عبور نمی‌کند.');
    const bridgeStatus = activeRoutes.length ? `${activeRoutes.length} درخواست در پرواز` : 'در انتظار درخواست';
    const successful24h = Number(state.usage?.last_24h?.requests || 0);

    host.innerHTML = `
      <main class="ab-home ops-console" dir="rtl">
        <header class="ops-header">
          <div class="ops-title-block">
            <span class="ops-eyebrow"><i></i> AGENT BRIDGE / ROUTE CONTROL</span>
            <h1>کنسول مسیر درخواست</h1>
            <p>منبع ورودی، موتور پردازش و مقصد واقعی را در یک نمای عملیاتی ببین.</p>
          </div>
          <div class="ops-actions">
            <button class="btn primary" type="button" data-action="chat">رفتن به گفت‌وگو</button>
            <button class="btn" type="button" data-action="models">مسیر مدل</button>
          </div>
        </header>


        <section class="route-board" aria-labelledby="routeTitle">
          <header class="section-head">
            <div><span class="section-code">01 / LIVE TOPOLOGY</span><h2 id="routeTitle">نقشهٔ اجزا و مسیر جاری</h2><p>نقشه وضعیت اجزاست؛ مسیر هر درخواست فقط از رکورد runtime نمایش داده می‌شود، نه از خطوط شماتیک.</p></div>
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
              <div class="target-primary ${targetNodeState}">
                <span class="target-icon">${isOnlineMode ? 'EXT' : 'LLM'}</span>
                <div class="target-copy"><strong>${esc(targetModel || 'مدل انتخاب نشده')}</strong><small>${esc(targetProviderLabel)}</small></div>
                <span class="target-health"><i></i>${isOnlineMode ? (targetConfigured ? 'CONFIGURED' : 'CHECK') : (targetAvailable ? 'LIVE' : 'OFFLINE')}</span>
              </div>
              <div class="target-status-line"><span class="status-led ${isOnlineMode ? (targetConfigured ? 'configured' : 'warn') : (targetAvailable ? 'on' : 'warn')}"></span>${esc(targetStatus)}</div>
              <div class="target-model-list"><span class="source-subhead-label">${isOnlineMode ? 'مدل آنلاین انتخاب‌شده' : `فهرست واقعی سرور · ${actualModelNames.length}`}</span>${localModelsHtml}</div>
              <button class="target-settings" type="button" data-action="models">تغییر مدل یا مسیر <span>↗</span></button>
            </section>
          </div>

          <div class="active-routes" aria-live="polite">${activeRouteRows}</div>
          <footer class="route-legend"><span><i class="legend-source"></i>ورودی‌های زنده</span><span><i class="legend-bridge"></i>هستهٔ Bridge</span><span><i class="legend-target"></i>مقصد انتخاب‌شده / مدل گزارش‌شده</span><span class="legend-note">نام ارائه‌دهنده فقط پس از ثبت درخواست واقعی نمایش داده می‌شود.</span></footer>
        </section>

        <section class="request-board" aria-labelledby="requestTitle">
          <header class="section-head request-head">
            <div><span class="section-code">02 / ROUTE AUDIT</span><h2 id="requestTitle">درخواست‌های اخیر</h2><p>موفقیت و خطای مسیر همراه مبدأ، مقصد و زمان؛ جزئیات فقط از دادهٔ ثبت‌شده تکمیل می‌شوند.</p></div>
            <div class="request-head-actions"><span class="request-count-chip">موفق در ۲۴ ساعت اخیر <b>${successful24h.toLocaleString()}</b></span><button class="text-action" type="button" data-action="usage">گزارش کامل توکن‌ها <span>↗</span></button></div>
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
