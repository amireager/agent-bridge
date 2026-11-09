// Arena-Smooth Settings — Built-in Online + Offline APIs, Pure Proxy Mode, Interleaved View & PTY Guide
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;

  async function saveTranslation() {
    await api('/api/config', {
      translation: {
        enabled: document.getElementById('sTrEnabled').value === 'true',
        engine: document.getElementById('sTrEngine').value,
        proxy: document.getElementById('sTrProxy').value.trim(),
        openai_model: document.getElementById('sOpenaiModel').value.trim(),
        endpoints: {
          bergamot: document.getElementById('sEpBerg').value.trim(),
          plamo: document.getElementById('sEpPlamo').value.trim(),
          openai: document.getElementById('sEpOpenai').value.trim()
        }
      }
    });
  }

  async function testTranslator() {
    const txt = document.getElementById('sTrTestIn').value;
    const out = document.getElementById('sTrTestOut');
    out.value = 'در حال ترجمه...';
    const r = await api('/api/translate', { text: txt, to: 'en' });
    out.value = r.error ? `ERR: ${r.error}` : `${r.translation}\n[${r.engine} · ${r.elapsed_ms}ms]`;
  }

  function addGlossaryItem() {
    const box = document.getElementById('sGlossaryList');
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
    div.innerHTML = `
      <input class="gl-fa" placeholder="اصطلاح فارسی" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:7px 10px;border-radius:8px;" />
      <input class="gl-en mono ltr" placeholder="Locked English term" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:7px 10px;border-radius:8px;" />
      <button class="btn danger" onclick="this.parentElement.remove()">×</button>`;
    box.appendChild(div);
  }

  async function saveGlossary() {
    const rows = [...document.querySelectorAll('#sGlossaryList > div')];
    const glossary = rows.map(r => ({
      fa: r.querySelector('.gl-fa').value.trim(),
      en: r.querySelector('.gl-en').value.trim()
    })).filter(x => x.fa && x.en);
    await api('/api/glossary', { glossary });
  }

  async function saveHud() {
    await api('/api/config', {
      ui: {
        sidebar_side: document.getElementById('sSbSide').value,
        chat_mode: document.getElementById('sChatMode').value,
        show_inline_tokens: document.getElementById('sShowTok').value === 'true',
        show_shadow_cost: document.getElementById('sShowCost').value === 'true',
        show_think: document.getElementById('sShowThink').value === 'true',
        show_tools: document.getElementById('sShowTools').value === 'true'
      }
    });
  }

  async function saveTap() {
    await api('/api/config', {
      tap: {
        upstream_url: document.getElementById('sUpstream').value.trim(),
        workdir: document.getElementById('sWorkdir').value.trim(),
        pi_bin: document.getElementById('sPiBin').value.trim()
      }
    });
  }

  async function applyRetention(days) {
    const res = await api('/api/retention/prune', { days: Number(days) });
    const msgEl = document.getElementById('sPruneResult');
    if (msgEl) {
      msgEl.textContent = `ذخیره شد (${res.retention_days === 0 ? 'همیشگی' : res.retention_days + ' روز'}) — پاکسازی فوری: ${res.deleted_requests} رکورد توکن و ${res.deleted_sessions} نشست منقضی حذف شد.`;
    }
  }

  function render(host, state, route) {
    const c = state.config;
    const curEng = c.translation.engine === 'online' ? 'builtin-online' : (c.translation.engine || 'builtin-online');
    const trEnabled = c.translation.enabled !== false;

    if (route === 'set-translate') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>مترجم داخلی آنلاین + API آفلاین + حالت پروکسی خالص (بدون ترجمه)</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTranslation()">ذخیره تنظیمات</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>وضعیت ماژول ترجمه</label>
                <select id="sTrEnabled">
                  <option value="true" ${trEnabled ? 'selected' : ''}>فعال — ترجمه پاراگرافی دوطرفه</option>
                  <option value="false" ${!trEnabled ? 'selected' : ''}>خاموش — فقط پروکسی شکارچی کش KV (بدون تاخیر ترجمه)</option>
                </select>
              </div>
              <div class="fld">
                <label>موتور ترجمه</label>
                <select id="sTrEngine">
                  <option value="builtin-online" ${curEng === 'builtin-online' ? 'selected' : ''}>Built-in Online (داخلی — بدون سرور جدا)</option>
                  <option value="offline-openai" ${curEng === 'offline-openai' ? 'selected' : ''}>Offline OpenAI API (/v1/chat/completions — مثل HY-MT2)</option>
                  <option value="bergamot" ${curEng === 'bergamot' ? 'selected' : ''}>Offline REST API — Bergamot (:18092)</option>
                  <option value="plamo" ${curEng === 'plamo' ? 'selected' : ''}>Offline REST API — PLaMo-3 (:18093)</option>
                </select>
              </div>
              <div class="fld">
                <label>پروکسی اختیاری برای حالت آنلاین (SOCKS5H / HTTP)</label>
                <input id="sTrProxy" class="mono ltr" placeholder="مثلاً socks5h://127.0.0.1:1080" value="${esc(c.translation.proxy || '')}" />
              </div>
              <div class="fld">
                <label>آدرس API آفلاین OpenAI-Compatible</label>
                <input id="sEpOpenai" class="mono ltr" value="${esc(c.translation.endpoints?.openai || 'http://127.0.0.1:18093')}" />
              </div>
              <div class="fld">
                <label>نام مدل در API آفلاین OpenAI</label>
                <input id="sOpenaiModel" class="mono ltr" value="${esc(c.translation.openai_model || 'hy-mt2-1.8b')}" />
              </div>
              <div class="fld">
                <label>آدرس Bergamot REST / PLaMo REST</label>
                <div style="display:flex;gap:6px;">
                  <input id="sEpBerg" class="mono ltr" style="width:50%;" value="${esc(c.translation.endpoints?.bergamot || 'http://127.0.0.1:18092')}" />
                  <input id="sEpPlamo" class="mono ltr" style="width:50%;" value="${esc(c.translation.endpoints?.plamo || 'http://127.0.0.1:18093')}" />
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>تست زنده مترجم و سپر محافظ کد</h3>
              <button class="btn" onclick="ABSettingsPage.testTranslator()">تست FA → EN</button>
            </div>
            <div class="field-grid">
              <div class="fld"><textarea id="sTrTestIn" rows="2">کش کی‌وی را در فایل \`bridge.py\` با دستور \`--metrics\` بررسی کن.</textarea></div>
              <div class="fld"><textarea id="sTrTestOut" class="mono ltr" rows="2" readonly placeholder="output..."></textarea></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>واژه‌نامه فنی قفل‌شده (<code>.data/glossary.json</code>)</h3>
              <div style="display:flex;gap:8px;">
                <button class="btn" onclick="ABSettingsPage.addGlossaryItem()">+ افزودن اصطلاح</button>
                <button class="btn primary" onclick="ABSettingsPage.saveGlossary()">ذخیره واژه‌نامه</button>
              </div>
            </div>
            <div id="sGlossaryList">
              ${(state.glossary || []).map(g => `
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                  <input class="gl-fa" value="${esc(g.fa)}" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:7px 10px;border-radius:8px;" />
                  <input class="gl-en mono ltr" value="${esc(g.en)}" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:7px 10px;border-radius:8px;" />
                  <button class="btn danger" onclick="this.parentElement.remove()">×</button>
                </div>`).join('')}
            </div>
          </div>
        </div>`;
      return;
    }

    if (route === 'set-hud') {
      const curMode = c.ui.chat_mode || 'interleaved';
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>چیدمان نمایش پاراگرافی (سبک افزونه مرورگر) و پنل‌ها</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveHud()">ذخیره چیدمان</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>حالت نمایش پاسخ‌ها در چت (کدها همیشه فقط یک‌بار رندر می‌شوند)</label>
                <select id="sChatMode">
                  <option value="interleaved" ${curMode === 'interleaved' ? 'selected' : ''}>زیرِ هم (هر پاراگراف انگلیسی + ترجمه فارسی زیرش)</option>
                  <option value="fa_only" ${curMode === 'fa_only' ? 'selected' : ''}>تمام‌صفحه فارسی یکپارچه + بلوک کدهای اصلی</option>
                  <option value="en_only" ${curMode === 'en_only' ? 'selected' : ''}>فقط انگلیسی اصلی (مناسب حالت پروکسی کش)</option>
                </select>
              </div>
              <div class="fld">
                <label>جایگاه سایدبار</label>
                <select id="sSbSide">
                  <option value="left" ${c.ui.sidebar_side === 'left' ? 'selected' : ''}>سمت چپ (Left — پیش‌فرض)</option>
                  <option value="right" ${c.ui.sidebar_side === 'right' ? 'selected' : ''}>سمت راست (Right)</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش آمار توکن و کش بالای هر پیام</label>
                <select id="sShowTok">
                  <option value="true" ${c.ui.show_inline_tokens !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_inline_tokens === false ? 'selected' : ''}>غیرفعال</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش هزینه معادل کلود در نوار بالا</label>
                <select id="sShowCost">
                  <option value="true" ${c.ui.show_shadow_cost !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_shadow_cost === false ? 'selected' : ''}>غیرفعال</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش کشوی فکر مدل (Think)</label>
                <select id="sShowThink">
                  <option value="true" ${c.ui.show_think !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_think === false ? 'selected' : ''}>مخفی</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش کشوی فراخوانی ابزارها (Tools)</label>
                <select id="sShowTools">
                  <option value="true" ${c.ui.show_tools !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_tools === false ? 'selected' : ''}>مخفی</option>
                </select>
              </div>
            </div>
          </div>
        </div>`;
      return;
    }

    if (route === 'set-tap') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>پروکسی میانی <code>/v1</code> و اجرای هم‌زمان محیط تعاملی <code>pi</code> در ترمینال</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTap()">ذخیره مسیر</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>آدرس سرور مدل مقصد (مثلاً <code>llama-server</code>)</label>
                <input id="sUpstream" class="mono ltr" value="${esc(c.tap.upstream_url)}" />
              </div>
              <div class="fld">
                <label>پوشه کاری پیش‌فرض</label>
                <input id="sWorkdir" class="mono ltr" value="${esc(c.tap.workdir)}" />
              </div>
              <div class="fld">
                <label>فرمان پیش‌فرض عامل</label>
                <input id="sPiBin" class="mono ltr" value="${esc(c.tap.pi_bin)}" />
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>دو روش کار با <code>pi</code> واقعی در ترمینال سندباکس</h3></div>
            <p class="fg-1" style="margin:0 0 8px;">
              <strong>حالت اول — اجرای <code>pi</code> معمولی بدون هیچ اسکریپتی (صرفاً تنظیم آدرس مدل روی <code>:18080/v1</code>):</strong>
              خروجی‌ها، ابزارها و آمار کش ۱۰۰٪ خودکار از مسیر شبکه استخراج و ترجمه می‌شوند؛ و برای ارسال پرامپت از وب، با یک کلیک روی <code>Copy EN</code> در ترمینال Paste می‌کنی.
            </p>
            <p class="fg-1" style="margin:10px 0 8px;">
              <strong>حالت دوم — اجرای محیط تعاملی ۱۰۰٪ واقعی <code>pi</code> همراه با تایپ خودکار از وب (پیشنهادی):</strong>
              داخل ترمینال سندباکس دستور زیر را بزن تا همان محیط رنگی و تعاملی کامل <code>pi</code> باز شود و هرچه در وب تایید کردی مستقیم داخلش تایپ شود:
            </p>
            <div class="md-code"><div class="md-code-bar"><span>inside sandbox terminal</span></div><pre>python3 ~/path/to/agent-bridge/cli.py --wrap pi</pre></div>
          </div>
        </div>`;
      return;
    }

    const curDays = c.retention?.days ?? 7;
    const st = state.storage || {};
    host.innerHTML = `
      <div class="panel-wrap">
        <div class="panel">
          <div class="panel-head"><h3>پاکسازی خودکار تاریخچه (Retention Policy)</h3></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            ${[[1, '۱ روز (1 Day)'], [7, '۱ هفته (1 Week)'], [30, '۱ ماه (1 Month)'], [0, 'همیشگی (Forever)']].map(([d, lbl]) => `
              <button class="btn ${curDays === d ? 'primary' : ''}" onclick="ABSettingsPage.applyRetention(${d})">${lbl}</button>
            `).join('')}
          </div>
          <div id="sPruneResult" class="mono" style="color:var(--phosphor);font-size:11.8px;"></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>فایل‌های داخل <code>./.data/</code></h3>
            <span class="mono muted">${st.file_count || 0} files · ${st.total_kib || 0} KiB</span>
          </div>
          <div class="table-scroll">
            <table class="grid-table">
              <thead><tr><th>مسیر داخل <code>.data/</code></th><th>حجم (Bytes)</th></tr></thead>
              <tbody>
                ${(st.files || []).map(f => `
                  <tr><td class="m">${esc(f.path)}</td><td class="m">${f.bytes.toLocaleString()}</td></tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  return { render, saveTranslation, testTranslator, addGlossaryItem, saveGlossary, saveHud, saveTap, applyRetention };
})();
