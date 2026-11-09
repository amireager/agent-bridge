// Modular Focused Settings — Built-in Online + API-Driven Offline Translation, HUD, Tap & Retention
window.ABSettingsPage = (() => {
  const { esc, api } = window.ABUtils;

  async function saveTranslation() {
    await api('/api/config', {
      translation: {
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
    const curEng = c.translation.engine === 'online' ? 'builtin-online' : (c.translation.engine || 'builtin-online');

    if (route === 'set-translate') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>مترجم داخلی آنلاین + درگاه‌های استاندارد API آفلاین</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTranslation()">ذخیره تنظیمات ترجمه</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>حالت فعال ترجمه</label>
                <select id="sTrEngine">
                  <option value="builtin-online" ${curEng === 'builtin-online' ? 'selected' : ''}>Built-in Online (داخلی — بدون نیاز به سرور جدا)</option>
                  <option value="offline-openai" ${curEng === 'offline-openai' ? 'selected' : ''}>Offline OpenAI API (/v1/chat/completions — مثل HY-MT2 یا Qwen)</option>
                  <option value="bergamot" ${curEng === 'bergamot' ? 'selected' : ''}>Offline REST API — Bergamot (:18092)</option>
                  <option value="plamo" ${curEng === 'plamo' ? 'selected' : ''}>Offline REST API — PLaMo-3 (:18093)</option>
                </select>
              </div>
              <div class="fld">
                <label>پروکسی اختیاری برای حالت آنلاین (پشتیبانی از SOCKS5H / HTTP)</label>
                <input id="sTrProxy" class="mono ltr" placeholder="مثلاً socks5h://127.0.0.1:1080 (خالی = متغیر سیستم)" value="${esc(c.translation.proxy || '')}" />
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
                <label>آدرس API آفلاین Bergamot REST</label>
                <input id="sEpBerg" class="mono ltr" value="${esc(c.translation.endpoints?.bergamot || 'http://127.0.0.1:18092')}" />
              </div>
              <div class="fld">
                <label>آدرس API آفلاین PLaMo REST</label>
                <input id="sEpPlamo" class="mono ltr" value="${esc(c.translation.endpoints?.plamo || 'http://127.0.0.1:18093')}" />
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>تست زنده ترجمه و سپر محافظ کد</h3>
              <button class="btn" onclick="ABSettingsPage.testTranslator()">تست FA → EN</button>
            </div>
            <div class="field-grid">
              <div class="fld"><textarea id="sTrTestIn" rows="2">کش کی‌وی را در فایل `bridge.py` با دستور `--metrics` بررسی کن.</textarea></div>
              <div class="fld"><textarea id="sTrTestOut" class="mono ltr" rows="2" readonly placeholder="output..."></textarea></div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>راهنمای استاندارد API برای حالت‌های کاملاً آفلاین</h3></div>
            <p class="fg-1" style="margin:0 0 6px;"><strong>روش ۱ (مستقیم با <code>llama-server</code> روی CPU بدون هیچ اسکریپت کمکی — حالت <code>Offline OpenAI API</code>):</strong></p>
            <div class="md-code"><div class="md-code-bar"><span>fish / bash</span></div><pre>llama-server -m ~/models/micro/translate/hy-mt2-1.8b-heretic-iq4_xs.gguf --device none -ngl 0 -t 4 -tb 8 -c 2048 --port 18093</pre></div>
            <p class="fg-1" style="margin:10px 0 6px;"><strong>روش ۲ (قرارداد استاندارد <code>Offline REST API</code> — <code>POST /translate</code>):</strong> هر سرویسی که JSON زیر را بگیرد و برگرداند:</p>
            <div class="md-code"><div class="md-code-bar"><span>JSON Contract</span></div><pre>// Request  -> POST /translate  {"text": "سلام", "from": "auto", "to": "en"}
// Response <- 200 OK           {"translation": "Hello", "engine": "custom-offline"}</pre></div>
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
              <h3>مسیر شنود بین عامل و مدل (<code>/v1</code>) و اتصال به سندباکس</h3>
              <button class="btn primary" onclick="ABSettingsPage.saveTap()">ذخیره مسیر</button>
            </div>
            <div class="field-grid">
              <div class="fld">
                <label>آدرس سرور مدل مقصد (مثلاً <code>llama-server</code> روی سیستم اصلی)</label>
                <input id="sUpstream" class="mono ltr" value="${esc(c.tap.upstream_url)}" />
              </div>
              <div class="fld">
                <label>پوشه کاری پیش‌فرض</label>
                <input id="sWorkdir" class="mono ltr" value="${esc(c.tap.workdir)}" />
              </div>
              <div class="fld">
                <label>فرمان اجرای عامل (می‌تواند <code>box pi</code> هم باشد)</label>
                <input id="sPiBin" class="mono ltr" value="${esc(c.tap.pi_bin)}" />
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>راهنمای اتصال به <code>pi</code> داخل سندباکس (بدون بردن پروژه به داخل سندباکس!)</h3></div>
            <p class="fg-1" style="margin:0 0 8px;">
              <strong>روش ۱ (اتصال دوطرفه زنده از داخل سندباکس):</strong> برنامه <code>bridge.py</code> روی سیستم عادی می‌ماند؛ داخل ترمینال سندباکس (<code>box</code> / <code>dev agent</code>) روی پوشه پروژه‌ات این دستور را بزن تا <code>pi</code> داخل سندباکس اجرا شود و به وب وصل گردد:
            </p>
            <div class="md-code"><div class="md-code-bar"><span>inside sandbox</span></div><pre>python3 ~/path/to/agent-bridge/cli.py --pi-worker</pre></div>
            <p class="fg-1" style="margin:10px 0 8px;">
              <strong>روش ۲ (فقط شنود شفاف <code>/v1</code> برای هر عامل دلخواه):</strong> در تنظیمات عامل داخل سندباکس، آدرس مدل را روی <code>http://127.0.0.1:${state.bridge_port}/v1</code> بگذار.
            </p>
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
          <div class="panel-head"><h3>پاکسازی خودکار تاریخچه (Retention Policy)</h3></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            ${[[1, '۱ روز (1 Day)'], [7, '۱ هفته (1 Week)'], [30, '۱ ماه (1 Month)'], [0, 'همیشگی (Forever)']].map(([d, lbl]) => `
              <button class="btn ${curDays === d ? 'primary' : ''}" onclick="ABSettingsPage.applyRetention(${d})">${lbl}</button>
            `).join('')}
          </div>
          <div id="sPruneResult" class="mono" style="color:var(--phosphor);font-size:11.5px;"></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>فایل‌های داخل <code>./.data/</code></h3>
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
