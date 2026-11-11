// Live control-room landing page: models, PTY agents, translator, and practical connection guides.
window.ABHomePage = (() => {
  const { esc } = window.ABUtils;

  function render(host, state) {
    const upstream = state.upstream || {};
    const translation = state.config?.translation || {};
    const modelsCfg = state.config?.models || {};
    const connected = (state.mirrors || []).filter(agent => agent.pty_live);
    const modelNames = [...new Set((upstream.available_models || []).filter(Boolean).map(String))];
    if (!modelNames.length && upstream.online && upstream.detected_model && upstream.detected_model !== 'listening...') {
      modelNames.push(String(upstream.detected_model));
    }

    const translatorEnabled = translation.enabled !== false;
    const translatorOffline = translation.engine === 'custom-offline';
    const translatorTitle = translatorOffline ? 'مترجم آفلاین' : 'مترجم آنلاین';
    const translatorDetail = translatorOffline
      ? `${translation.offline_protocol === 'rest' ? 'REST' : 'OpenAI-compatible'} · ${translation.offline_model || 'مدل محلی'}`
      : 'سرویس ترجمهٔ انتخاب‌شده';
    const translatorHealth = !translatorEnabled
      ? 'خاموش'
      : (translatorOffline ? (state.translator_online ? 'متصل' : 'نیازمند بررسی') : 'فعال');

    const modelHtml = modelNames.length
      ? modelNames.map(name => `
          <div class="flow-resource model-resource">
            <span class="resource-glyph" aria-hidden="true">◉</span>
            <span class="resource-copy"><strong>${esc(name)}</strong><small>${modelsCfg.default_mode === 'online' ? 'فهرست محلی · مسیر پیش‌فرض آنلاین' : 'از سرور مدل محلی'}</small></span>
            <span class="live-pill"><i></i>آماده</span>
          </div>`).join('')
      : `<div class="flow-resource resource-unavailable"><span class="resource-glyph" aria-hidden="true">◌</span><span class="resource-copy"><strong>مدل در دسترس نیست</strong><small>سرور مدل را روشن کن یا نشانی آن را بررسی کن.</small></span><button class="text-action" data-action="models">تنظیمات مدل</button></div>`;

    const agentHtml = connected.map(agent => {
      const busy = agent.activity === 'GENERATING';
      const subtitle = busy ? 'در حال پاسخ‌گویی' : 'آمادهٔ دریافت پیام';
      return `
        <button class="flow-resource agent-resource" type="button" data-agent="${esc(agent.agent_id)}" aria-label="بازکردن مکالمهٔ ${esc(agent.agent_id)}">
          <span class="resource-glyph agent-glyph" aria-hidden="true">⌘</span>
          <span class="resource-copy"><strong>${esc(agent.agent_id)}</strong><small>${subtitle}</small></span>
          <span class="live-pill ${busy ? 'busy' : ''}"><i></i>${busy ? 'مشغول' : 'زنده'}</span>
        </button>`;
    }).join('');

    const guideItems = [
      {
        icon: '01', title: 'راه‌اندازی Bridge',
        description: 'ابتدا رابط و پراکسی محلی را اجرا کن؛ عامل‌ها درخواست مدل را از همین مسیر می‌فرستند.',
        command: 'python3 bridge.py --host 127.0.0.1 --port 18080',
        tag: 'یک‌بار برای هر اجرا',
      },
      {
        icon: '02', title: 'اتصال یک عامل ترمینالی',
        description: 'در پوشهٔ پروژه، wrapper عامل را اجرا کن. هر PTY کانال و تاریخچهٔ مستقل دارد.',
        command: 'python3 cli.py --wrap omp',
        tag: 'OMP · Pi · Hermes · دیگر adapterها',
      },
      {
        icon: '03', title: 'فرستادن پیام از UI',
        description: 'برای عامل زنده، پیام را در صفحهٔ گفتگو بفرست؛ متن به همان PTY تایپ و با Enter ارسال می‌شود.',
        command: 'python3 cli.py --wrap pi',
        tag: 'بدون نشست ساختگی',
      },
    ];

    host.innerHTML = `
      <main class="ab-home" dir="rtl">
        <header class="home-hero">
          <div class="hero-copy">
            <div class="eyebrow"><span class="hero-pulse"></span> فضای کاری محلی · Agent Bridge</div>
            <h1>اتاق فرمان</h1>
            <p>مدل‌ها، مترجم و ترمینال‌های عامل را از یک نمای زنده مدیریت کن.</p>
          </div>
          <div class="hero-actions">
            <button class="btn primary" type="button" data-action="chat">رفتن به گفتگو <span aria-hidden="true">←</span></button>
            <button class="btn" type="button" data-action="connections">راهنمای اتصال</button>
          </div>
          <div class="hero-health">
            <span class="health-indicator ${upstream.online ? 'is-online' : ''}"></span>
            <span>${upstream.online ? 'Bridge آمادهٔ پایش' : 'در انتظار اتصال مدل'}</span>
            <code>127.0.0.1:${Number(state.bridge_port || 18080)}</code>
          </div>
        </header>

        <div class="home-control-grid">
          <section class="flow-board" aria-labelledby="flowBoardTitle">
            <div class="flow-board-head">
              <div><span class="section-kicker">LIVE CONTROL FLOW</span><h2 id="flowBoardTitle">مسیر اتصال</h2></div>
              <span class="live-refresh"><i></i>وضعیت زنده</span>
            </div>
            <div class="flow-canvas ${connected.length ? 'has-agents' : 'without-agents'}" dir="ltr">
              <section class="flow-column" aria-label="مدل‌های دردسترس">
                <div class="flow-column-head"><span>مدل‌های دردسترس</span><span class="count-chip">${modelNames.length}</span></div>
                <div class="flow-resource-list">${modelHtml}</div>
              </section>
              <div class="flow-connector" aria-hidden="true"><span></span><b>›</b></div>
              <section class="flow-core" aria-label="Agent Bridge">
                <div class="core-orbit"><span class="core-mark">AB</span></div>
                <strong>Agent Bridge</strong>
                <small>پراکسی · آینهٔ گفتگو · پایش</small>
                <code>/v1</code>
              </section>
              ${connected.length ? `
                <div class="flow-connector" aria-hidden="true"><span></span><b>›</b></div>
                <section class="flow-column agent-flow-column" aria-label="عامل‌های متصل">
                  <div class="flow-column-head"><span>عامل‌های متصل</span><span class="count-chip">${connected.length}</span></div>
                  <div class="flow-resource-list">${agentHtml}</div>
                </section>` : ''}
            </div>
            <div class="flow-board-foot">
              <span><i class="legend-dot model-dot"></i> فهرست مدل از endpoint زندهٔ <code>/v1/models</code></span>
              ${connected.length ? '<span><i class="legend-dot agent-dot"></i> عامل‌ها با heartbeat ترمینال شناسایی می‌شوند</span>' : ''}
            </div>
          </section>

          <aside class="translator-card" aria-labelledby="translatorTitle">
            <div class="translator-card-top">
              <span class="translator-icon" aria-hidden="true">文</span>
              <span class="translator-state ${translatorEnabled ? 'enabled' : ''}"><i></i>${translatorHealth}</span>
            </div>
            <span class="section-kicker">LANGUAGE PIPELINE</span>
            <h2 id="translatorTitle">${translatorTitle}</h2>
            <p>${esc(translatorDetail)}</p>
            <div class="translator-flow" aria-label="فارسی به انگلیسی">
              <span>فارسی</span><b aria-hidden="true">→</b><span>English</span>
            </div>
            <div class="translator-explain">متن ورودی فارسی پیش از ارسال به عامل، طبق تنظیم فعلی آماده می‌شود؛ کد و متن اصلی محفوظ می‌ماند.</div>
            <div class="translator-actions">
              <button class="btn ${translatorEnabled ? 'translator-toggle' : 'primary'}" type="button" data-action="toggle-translation">${translatorEnabled ? 'خاموش‌کردن ترجمه' : 'روشن‌کردن ترجمه'}</button>
              <button class="btn ghost" type="button" data-action="translator-settings">تنظیم مترجم</button>
            </div>
          </aside>
        </div>

        <section class="guide-section" id="connectionGuides">
          <div class="guide-heading"><div><span class="section-kicker">GET STARTED</span><h2>شروع سریع</h2><p>سه قدم برای وصل‌کردن یک عامل و فرستادن اولین پیام.</p></div><span class="guide-heading-mark" aria-hidden="true">↙</span></div>
          <div class="guide-grid">
            ${guideItems.map((item, index) => `
              <article class="guide-card">
                <div class="guide-card-head"><span class="guide-number">${item.icon}</span><span class="guide-step-label">${item.tag}</span></div>
                <h3>${item.title}</h3><p>${item.description}</p>
                <div class="guide-command"><code>${esc(item.command)}</code><button type="button" class="copy-command" data-copy="${esc(item.command)}" aria-label="کپی فرمان" title="کپی فرمان">⧉</button></div>
              </article>`).join('')}
          </div>
        </section>

        <section class="usecase-section">
          <div class="guide-heading"><div><span class="section-kicker">WORKFLOWS</span><h2>کارهایی که اینجا راحت‌تر می‌شوند</h2></div></div>
          <div class="usecase-grid">
            <article class="usecase-card"><span>↗</span><div><h3>مکالمهٔ مستقل با هر عامل</h3><p>Pi، OMP و دیگر CLIها کانال و Mirror جدا دارند؛ تاریخچه‌ها با هم قاطی نمی‌شوند.</p></div></article>
            <article class="usecase-card"><span>⌁</span><div><h3>دیدن رویدادهای واقعی</h3><p>پاسخ جریانی و فراخوانی ابزارها را هم‌زمان با کار عامل در صفحه دنبال کن.</p></div></article>
            <article class="usecase-card"><span>⇄</span><div><h3>کار با مدل محلی</h3><p>ترافیک CLI را از پراکسی محلی عبور بده و آمار زمینه و KV را بررسی کن.</p></div></article>
          </div>
        </section>
        <footer class="home-footer"><span>Agent Bridge</span><span>داده‌ها و تاریخچه‌ها در مسیر محلی <code>./.data/</code> نگهداری می‌شوند.</span></footer>
      </main>`;

    host.querySelector('[data-action="chat"]')?.addEventListener('click', () => window.ABApp.navigate('chat'));
    host.querySelector('[data-action="connections"]')?.addEventListener('click', () => host.querySelector('#connectionGuides')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    host.querySelector('[data-action="toggle-translation"]')?.addEventListener('click', () => window.ABApp.toggleProxyMode());
    host.querySelector('[data-action="translator-settings"]')?.addEventListener('click', () => window.ABApp.navigate('set-translate'));
    host.querySelector('[data-action="models"]')?.addEventListener('click', () => window.ABApp.navigate('set-tap'));
    host.querySelectorAll('[data-agent]').forEach(button => button.addEventListener('click', () => window.ABApp.selectMirror(button.dataset.agent)));
    host.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyCommand(button)));
  }

  async function copyCommand(button) {
    const value = button.dataset.copy || '';
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    const original = button.textContent;
    button.textContent = '✓';
    button.classList.add('copied');
    setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1300);
  }

  return { render };
})();
