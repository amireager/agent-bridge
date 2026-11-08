// Modular Focused Settings — Translation, Display HUD, /v1 Tap & History Retention
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;

  async function saveTranslation() {
    await api('/api/config', {
      translation: {
        engine: document.getElementById('sTrEngine').value,
        endpoints: {
          online: document.getElementById('sEpOnline').value.trim(),
          bergamot: document.getElementById('sEpBerg').value.trim(),
          plamo: document.getElementById('sEpPlamo').value.trim()
        }
      }
    });
  }

  async function testTranslator() {
    const txt = document.getElementById('sTrTestIn').value;
    const out = document.getElementById('sTrTestOut');
    out.value = '...';
    const r = await api('/api/translate', { text: txt, to: 'en' });
    out.value = r.error ? `ERR: ${r.error}` : `${r.translation}\n[${r.engine} · ${r.elapsed_ms}ms]`;
  }

  function addGlossaryItem() {
    const box = document.getElementById('sGlossaryList');
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
    div.innerHTML = `
      <input class="gl-fa" placeholder="اصطلاح فارسی" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:5px 8px;border-radius:4px;" />
      <input class="gl-en mono ltr" placeholder="Locked English term" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:5px 8px;border-radius:4px;" />
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
        show_english_reply: document.getElementById('sShowEn').value === 'true',
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

    if (route === 'set-translate') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>موتور ترجمه دوزبانه (پیش‌فرض: Online :18091)</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTranslation()">ذخیره تنظیمات ترجمه</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>موتور فعال ترجمه نثر (کدها هرگز ترجمه نمی‌شوند)</label>
                <select id="sTrEngine">
                  <option value="online" ${c.translation.engine === 'online' ? 'selected' : ''}>Online (:18091 — Google Shielded)</option>
                  <option value="bergamot" ${c.translation.engine === 'bergamot' ? 'selected' : ''}>Bergamot Offline (:18092 — 47MB WASM)</option>
                  <option value="plamo" ${c.translation.engine === 'plamo' ? 'selected' : ''}>PLaMo-3 0.8B Offline (:18093)</option>
                </select>
              </div>
              <div class="fld">
                <label>درگاه Online</label>
                <input id="sEpOnline" class="mono ltr" value="${esc(c.translation.endpoints?.online || 'http://127.0.0.1:18091')}" />
              </div>
              <div class="fld">
                <label>درگاه Bergamot</label>
                <input id="sEpBerg" class="mono ltr" value="${esc(c.translation.endpoints?.bergamot || 'http://127.0.0.1:18092')}" />
              </div>
              <div class="fld">
                <label>درگاه PLaMo-3</label>
                <input id="sEpPlamo" class="mono ltr" value="${esc(c.translation.endpoints?.plamo || 'http://127.0.0.1:18093')}" />
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>تست زنده سپر محافظ کد و واژه‌نامه</h3>
              <button class="btn" onclick="ABSettingsPage.testTranslator()">تست FA → EN</button>
            </div>
            <div class="field-grid">
              <div class="fld"><textarea id="sTrTestIn" rows="2">کش کی‌وی را در فایل `bridge.py` با دستور `--metrics` بررسی کن.</textarea></div>
              <div class="fld"><textarea id="sTrTestOut" class="mono ltr" rows="2" readonly placeholder="output..."></textarea></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>واژه‌نامه فنی قفل‌شده (<code>.data/glossary.json</code>)</h3>
              <div style="display:flex;gap:6px;">
                <button class="btn" onclick="ABSettingsPage.addGlossaryItem()">+ افزودن اصطلاح</button>
                <button class="btn primary" onclick="ABSettingsPage.saveGlossary()">ذخیره واژه‌نامه</button>
              </div>
            </div>
            <div id="sGlossaryList">
              ${(state.glossary || []).map(g => `
                <div style="display:flex;gap:8px;margin-bottom:6px;">
                  <input class="gl-fa" value="${esc(g.fa)}" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:5px 8px;border-radius:4px;" />
                  <input class="gl-en mono ltr" value="${esc(g.en)}" style="flex:1;background:var(--bg-0);color:var(--fg-0);border:1px solid var(--line-strong);padding:5px 8px;border-radius:4px;" />
                  <button class="btn danger" onclick="this.parentElement.remove()">×</button>
                </div>`).join('')}
            </div>
          </div>
        </div>`;
      return;
    }

    if (route === 'set-hud') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>گزینه‌های نمایش چت، متن انگلیسی و توکن‌ها</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveHud()">ذخیره تنظیمات نمایش</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>جایگاه سایدبار (پیش‌فرض: سمت چپ)</label>
                <select id="sSbSide">
                  <option value="left" ${c.ui.sidebar_side === 'left' ? 'selected' : ''}>سمت چپ (Left — پیش‌فرض)</option>
                  <option value="right" ${c.ui.sidebar_side === 'right' ? 'selected' : ''}>سمت راست (Right)</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش متن انگلیسی اصلی کنار ترجمه فارسی پاسخ‌ها</label>
                <select id="sShowEn">
                  <option value="true" ${c.ui.show_english_reply !== false ? 'selected' : ''}>نمایش کنار فارسی (با دکمه حذف تکی روی هر پیام)</option>
                  <option value="false" ${c.ui.show_english_reply === false ? 'selected' : ''}>مخفی کردن انگلیسی (صفحه خلوت — فقط فارسی + کد)</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش شمارنده توکن و کش بالای هر پیام</label>
                <select id="sShowTok">
                  <option value="true" ${c.ui.show_inline_tokens !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_inline_tokens === false ? 'selected' : ''}>غیرفعال</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش تخمین هزینه معادل کلود در نوار بالا</label>
                <select id="sShowCost">
                  <option value="true" ${c.ui.show_shadow_cost !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_shadow_cost === false ? 'selected' : ''}>غیرفعال</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش کشوی تاشوی فکر مدل (<code>THINK</code>)</label>
                <select id="sShowThink">
                  <option value="true" ${c.ui.show_think !== false ? 'selected' : ''}>فعال</option>
                  <option value="false" ${c.ui.show_think === false ? 'selected' : ''}>مخفی</option>
                </select>
              </div>
              <div class="fld">
                <label>نمایش کشوی تاشوی فراخوانی ابزار (<code>TOOLS</code>)</label>
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
              <h3>مسیر شنود بین عامل و مدل (<code>/v1</code> Listener) — بدون دستکاری پارامترهای عامل</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTap()">ذخیره مسیر</button>
            </div>
            <p class="fg-1" style="margin:0 0 12px;">
              تنظیمات مدل، دما و پنجره کانتکست کاملاً در اختیار خودِ عامل باقی می‌ماند. این برنامه صرفاً ترافیک ارسالی به <code>http://127.0.0.1:${state.bridge_port}/v1</code> را بدون دستکاری به سرور مدل مقصد فوروارد کرده، توکن و کش را به نام همان مدل می‌شمارد و نثر پاسخ را به فارسی ترجمه می‌کند.
            </p>
            <div class="field-grid">
              <div class="fld">
                <label>آدرس سرور مدل مقصد (Upstream Model Server)</label>
                <input id="sUpstream" class="mono ltr" value="${esc(c.tap.upstream_url)}" />
              </div>
              <div class="fld">
                <label>پوشه کاری پیش‌فرض هنگام ارسال مستقیم پرامپت</label>
                <input id="sWorkdir" class="mono ltr" value="${esc(c.tap.workdir)}" />
              </div>
              <div class="fld">
                <label>باینری عامل برای ارسال مستقیم از وب (اختیاری)</label>
                <input id="sPiBin" class="mono ltr" value="${esc(c.tap.pi_bin)}" />
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>نحوه اتصال عامل‌ها و ترمینال لینوکس خودت (سبک <code>zellij</code>)</h3></div>
            <p class="fg-1" style="margin:0 0 8px;">۱. در تنظیمات هر عامل دلخواه در ترمینال، آدرس Base URL را روی درگاه شنود بگذار و نام عامل را در کلید مشخص کن:</p>
            <div class="md-code"><div class="md-code-bar"><span>env / config</span></div><pre>OPENAI_BASE_URL=http://127.0.0.1:${state.bridge_port}/v1
OPENAI_API_KEY=agent:pi</pre></div>
            <p class="fg-1" style="margin:10px 0 8px;">۲. برای اتصال دوطرفه ترمینال واقعی لینوکس به همین نشست زنده وب:</p>
            <div class="md-code"><div class="md-code-bar"><span>bash / fish</span></div><pre>python3 cli.py --url http://127.0.0.1:${state.bridge_port}</pre></div>
          </div>
        </div>`;
      return;
    }

    // set-retention
    const curDays = c.retention?.days ?? 7;
    const st = state.storage || {};
    host.innerHTML = `
      <div class="panel-wrap">
        <div class="panel">
          <div class="panel-head">
            <h3>پاکسازی خودکار تاریخچه (Retention Policy)</h3>
          </div>
          <p class="fg-1" style="margin:0 0 12px;">
            انتخاب کن تاریخچه نشست‌ها و آمار توکن‌ها چه مدت در <code>./.data/</code> باقی بمانند:
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            ${[[1, '۱ روز (1 Day)'], [7, '۱ هفته (1 Week)'], [30, '۱ ماه (1 Month)'], [0, 'همیشگی (Forever)']].map(([d, lbl]) => `
              <button class="btn ${curDays === d ? 'primary' : ''}" onclick="ABSettingsPage.applyRetention(${d})">${lbl}</button>
            `).join('')}
          </div>
          <div id="sPruneResult" class="mono" style="color:var(--phosphor);font-size:11.5px;"></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>فایل‌های داخل <code>./.data/</code> (ایزوله و خارج از گیت)</h3>
            <span class="mono muted">${st.file_count || 0} files · ${st.total_kib || 0} KiB</span>
          </div>
          <table class="grid-table">
            <thead><tr><th>مسیر داخل <code>.data/</code></th><th>حجم (Bytes)</th></tr></thead>
            <tbody>
              ${(st.files || []).map(f => `
                <tr><td class="m">${esc(f.path)}</td><td class="m">${f.bytes.toLocaleString()}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  return { render, saveTranslation, testTranslator, addGlossaryItem, saveGlossary, saveHud, saveTap, applyRetention };
})();
