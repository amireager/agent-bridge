// About page: product purpose, workflows, verification evidence, and current boundaries.
window.ABAboutPage = (() => {
  const { esc } = window.ABUtils;
  const sections = [
    ['overview', 'معرفی برنامه'],
    ['workflow', 'روش‌های فعالیت'],
    ['tests', 'تست‌ها و اعتبارسنجی'],
    ['specs', 'مشخصات و محدودیت‌ها'],
  ];

  function render(host, state, route) {
    const selected = route.replace(/^about-/, '');
    const active = sections.some(([key]) => key === selected) ? selected : 'overview';
    const config = state.config || {};
    const up = state.upstream || {};
    const liveAgents = (state.mirrors || []).filter(item => item.pty_live);
    const models = up.available_models || [];

    const content = {
      overview: `
        <section class="about-intro-card">
          <span class="about-mark">AB</span>
          <div><span class="about-eyebrow">LOCAL AGENT CONTROL PLANE</span><h2>Agent Bridge چه‌کار می‌کند؟</h2>
            <p>یک میزکار محلی برای وصل‌کردن عامل‌های ترمینالی به مدل، دیدن مکالمه‌ها و ابزارهای واقعی، و پایش جریان درخواست‌هاست. مترجم فارسی/انگلیسی و آزمایش مستقیم مدل هم در همان برنامه در دسترس‌اند.</p></div>
        </section>
        <div class="about-fact-grid">
          <article><span>01</span><h3>گفت‌وگوی واقعی</h3><p>پیام UI به PTY عامل زنده می‌رسد؛ Mirror، درخواست‌ها و پاسخ‌های همان عامل را نگه می‌دارد.</p></article>
          <article><span>02</span><h3>مسیر محلی</h3><p>تنظیمات، تاریخچه و داده‌های برنامه در <code>./.data/</code> نگهداری می‌شوند.</p></article>
          <article><span>03</span><h3>عامل‌های مستقل</h3><p>هر CLI مکالمه و تاریخچهٔ جدا دارد. هماهنگ‌کردن چند عامل روی یک وظیفه فعلاً جزو قابلیت‌ها نیست.</p></article>
        </div>
        <div class="about-note"><strong>هدف فعلی</strong><span>پایدار و قابل‌فهم‌کردن اتصال مستقل با هر عامل؛ نه ساخت یک orchestrator چندعاملی.</span></div>`,
      workflow: `
        <div class="about-workflow-grid">
          <article class="about-workflow-card"><span class="workflow-index">مسیر ۱</span><h3>پیام از UI به ترمینال</h3>
            <div class="about-flowline"><b>ورودی فارسی</b><i>→</i><b>ترجمهٔ اختیاری</b><i>→</i><b>PTY عامل</b></div>
            <p>Bridge پیام را به ترمینال همان عامل تایپ می‌کند و Enter می‌زند. متن اصلی و ساختار کد حفظ می‌شود؛ نتیجه در Mirror مستقل ثبت می‌شود.</p>
          </article>
          <article class="about-workflow-card"><span class="workflow-index">مسیر ۲</span><h3>درخواست مدل از CLI</h3>
            <div class="about-flowline"><b>CLI</b><i>→</i><b>پراکسی <code>/v1</code></b><i>→</i><b>مدل</b></div>
            <p>درخواست OpenAI-compatible، رویدادهای stream و tool callها عبور می‌کنند؛ داشبورد گفتگو پیشرفت را قبل از پایان پاسخ نشان می‌دهد.</p>
          </article>
          <article class="about-workflow-card"><span class="workflow-index">مسیر ۳</span><h3>آزمایش مستقیم در Lab</h3>
            <div class="about-flowline"><b>Lab</b><i>→</i><b>مدل محلی</b><i>→</i><b>نتیجهٔ آزمایش</b></div>
            <p>نشست Lab از مکالمهٔ عامل‌های ترمینالی جداست. ابزارهای فعلی Lab محدود به workspace مستقل خود برنامه‌اند.</p>
          </article>
        </div>
        <div class="about-note"><strong>مرز مهم</strong><span>یک Mirror برای هر اجرای PTY؛ انتخاب یا خروج از نما تاریخچهٔ ترمینال دیگر را بازاستفاده نمی‌کند.</span></div>`,
      tests: `
        <div class="about-test-summary"><div><strong>۴۲</strong><span>تست خودکار Python در آخرین اجرای تأییدشده</span></div><div><strong>۲</strong><span>تست رندر رابط با Node.js</span></div><small>وضعیت ثبت‌شده برای این نسخه · ۲۵ اکتبر ۲۰۲۶</small></div>
        <div class="about-test-list">
          <article><span class="test-ok">✓</span><div><h3>تفکیک تاریخچهٔ OMP</h3><p>دو prompt در یک PTY در همان Mirror ماندند؛ درخواست‌های داخلی title و side-channel تاریخچهٔ تازه نساختند.</p></div></article>
          <article><span class="test-ok">✓</span><div><h3>اجرای ابزار در OMP</h3><p>در تست زندهٔ قبلی، ابزار bash اجرا شد و خروجی دقیق <code>TOOL_SMOKE_OK</code> در خروجی ابزار و ترمینال دیده شد.</p></div></article>
          <article><span class="test-ok">✓</span><div><h3>پیشرفت SSE و ابزار ناشناخته</h3><p>تست integration محلی تأیید می‌کند رویداد ابزار با نام واقعی پیش از پایان upstream منتشر می‌شود. این تست از مدل stub استفاده می‌کند.</p></div></article>
          <article><span class="test-ok">✓</span><div><h3>نمای زنده و رابط داشبورد</h3><p>تست‌ها فهرست مدل، وضعیت عامل مشغول، و پنهان‌ماندن بخش عامل‌ها هنگام نبود اتصال را بررسی می‌کنند.</p></div></article>
          <article class="about-test-caveat"><span>!</span><div><h3>آنچه هنوز ادعا نمی‌کنیم</h3><p>تست پیکربندی adapterها برای همهٔ CLIها معادل اجرای زندهٔ تک‌تک باینری‌ها نیست. سلامت واقعی هر عامل باید با نصب و smoke test همان نسخه تأیید شود.</p></div></article>
        </div>`,
      specs: `
        <div class="about-spec-table">
          <div><span>Bridge</span><strong><code>127.0.0.1:${Number(state.bridge_port || 18080)}</code></strong><small>آدرس پیش‌فرض رابط و پراکسی</small></div>
          <div><span>مدل‌های محلی</span><strong>${models.length ? `${models.length} مدل در دسترس` : (up.online ? 'فهرست مدل خالی' : 'سرور مدل متصل نیست')}</strong><small>${models.length ? models.map(esc).join(' · ') : 'هیچ مدلی در دسترس نیست'} · ${esc(config.tap?.upstream_url || 'آدرس تنظیم نشده')}</small></div>
          <div><span>عامل‌های PTY</span><strong>${liveAgents.length ? `${liveAgents.length} عامل زنده` : 'اتصال زنده‌ای ثبت نشده'}</strong><small>وضعیت از heartbeat ترمینال و درخواست‌های جاری می‌آید</small></div>
          <div><span>مسیر داده</span><strong><code>.data/</code></strong><small>تنظیمات، Mirror، نشست‌های Lab و آمار</small></div>
          <div><span>مترجم</span><strong>${config.translation?.enabled === false ? 'خاموش' : (config.translation?.engine === 'custom-offline' ? 'API آفلاین انتخاب‌شده' : 'مسیر آنلاین انتخاب‌شده')}</strong><small>انتخاب موتور مستقل از دردسترس‌بودن مدل ترجمه است</small></div>
          <div><span>Trace پروتکل</span><strong>اختیاری · پیش‌فرض خاموش</strong><small>در صورت فعال‌کردن، اعتبارنامه‌ها redacted می‌شوند؛ پیش‌نمایش prompt ممکن است در فایل محلی trace ثبت شود.</small></div>
        </div>
        <h3 class="about-subheading">Adapterهای فعلی</h3>
        <div class="about-adapter-list"><span>Pi</span><span>OMP</span><span>Hermes</span><span>CodeWhale</span><span>Letta Code</span><span>DSH</span><span>Forge</span><span>Generic OpenAI-compatible</span></div>
        <div class="about-note about-caution"><strong>محدودیت فعلی</strong><span>adapter موجود یعنی Bridge مسیر/پیکربندی آن را فراهم می‌کند؛ پشتیبانی کامل همهٔ قابلیت‌های اختصاصی و تست زندهٔ همهٔ باینری‌ها را تضمین نمی‌کند.</span></div>`,
    }[active];

    host.innerHTML = `
      <main class="about-page" dir="rtl">
        <header class="about-page-head"><div><span class="about-eyebrow">PROJECT NOTES</span><h1>دربارهٔ Agent Bridge</h1><p>معرفی، روش کار و شواهد فنی نسخهٔ فعلی؛ ساده و قابل‌به‌روزرسانی.</p></div>
          <button class="btn" type="button" data-home>بازگشت به اتاق فرمان</button></header>
        <div class="about-layout">
          <nav class="about-tabs" aria-label="بخش‌های درباره">
            ${sections.map(([key, label], i) => `<button type="button" class="about-tab ${active === key ? 'active' : ''}" data-section="${key}" aria-current="${active === key ? 'page' : 'false'}"><span>0${i + 1}</span>${label}</button>`).join('')}
          </nav>
          <section class="about-content">${content}</section>
        </div>
        <footer class="about-foot"><span>Agent Bridge · درباره</span><span>یادداشت‌های نسخه‌ای هستند؛ وضعیت مدل و PTY از سیستم جاری خوانده می‌شود.</span></footer>
      </main>`;

    host.querySelector('[data-home]')?.addEventListener('click', () => window.ABApp.navigate('home'));
    host.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
      window.ABApp.navigate(`about-${button.dataset.section}`);
    }));
  }

  return { render };
})();
