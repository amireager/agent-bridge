// Pro KV-Cache Hunter, Categorized Token Analytics & Zero-Overhead Persian Savings
window.ABUsagePage = (() => {
  const { esc, api } = window.ABUtils;

  async function setFilter(patch) {
    await api('/api/usage/filter', patch);
  }

  async function setPricing(prof) {
    await api('/api/config', { pricing: { active_profile: prof } });
  }

  async function clearAll() {
    const ok = confirm('پاکسازی آمار و تاریخچه‌ی آینه‌ها؟\n\nحذف می‌شود: آمار توکن/هزینه، X-Ray و تاریخچه‌ی کانال‌های آفلاین مثل pi قدیمی.\nحفظ می‌شود: کانال‌های ترمینالی که همین حالا زنده‌اند (فقط تاریخچه‌شان خالی می‌شود) و نشست‌های Lab.\n\nادامه بدهم؟');
    if (!ok) return;
    const res = await api('/api/telemetry/clear', {});
    alert(`پاکسازی انجام شد. کانال‌های قدیمی حذف‌شده: ${res.removed_channels || 0} · ترمینال‌های زنده‌ی حفظ‌شده: ${res.preserved_live_channels || 0}`);
  }

  function renderTokBar(kv, uncached, out) {
    const tot = Math.max(1, (kv || 0) + (uncached || 0) + (out || 0));
    const pKv = ((kv || 0) / tot * 100).toFixed(1);
    const pIn = ((uncached || 0) / tot * 100).toFixed(1);
    const pOut = ((out || 0) / tot * 100).toFixed(1);
    return `
      <div class="tok-bar" title="Cached KV: ${kv} | Uncached In: ${uncached} | Output: ${out}">
        <i class="seg-kv" style="width:${pKv}%"></i>
        <i class="seg-in" style="width:${pIn}%"></i>
        <i class="seg-out" style="width:${pOut}%"></i>
      </div>`;
  }

  function renderKvPill(status, pct) {
    const st = status || (pct >= 75 ? 'warm' : (pct >= 25 ? 'partial' : 'cold'));
    const lbl = st === 'flush' ? `افت احتمالی کش · ${pct}%` : `${st.toUpperCase()} ${pct}%`;
    return `<span class="kv-pill ${esc(st)}">${esc(lbl)}</span>`;
  }

  function render(host, state, route) {
    const u = state.usage || {};
    const w = u.window || {};
    const curWin = u.window_hours ?? 24;
    const curModel = u.model_filter || 'all';
    const curAgent = u.agent_filter || 'all';

    if (route === 'usage-xray') {
      const items = (state.inspector || []).slice().reverse();
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>بازرس بسته خام عبوری (Wire X-Ray Inspector)</h3>
              <span class="mono muted">${items.length} frames</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${items.map(it => {
                const totIn = (it.cached_in || 0) + (it.uncached_in || 0);
                const pct = totIn > 0 ? Math.round((it.cached_in / totIn) * 100) : 0;
                return `
                  <details class="trace-acc">
                    <summary>
                      <span>[${esc(it.ts)}] <strong>${esc(it.agent)}</strong> → ${esc(it.model)} · msgs:${it.message_count} · sys:${it.system_chars}ch</span>
                      <span style="display:flex;align-items:center;gap:8px;">
                        ${renderKvPill(it.kv_status, pct)}
                        <span>in:${it.uncached_in} · kv:${it.cached_in} · out:${it.out_tok} (${it.tg_tps}t/s)</span>
                      </span>
                    </summary>
                    <div class="acc-body">${esc(JSON.stringify(it.messages_tail, null, 2))}</div>
                  </details>`;
              }).join('') || '<div class="muted">هنوز ترافیکی از گذرگاه /v1 عبور نکرده است.</div>'}
            </div>
          </div>
        </div>`;
      return;
    }

    if (route === 'usage-agents') {
      const agentRows = u.by_agent || [];
      const palette = ['#34d399','#60a5fa','#a78bfa','#fbbf24','#fb7185','#22d3ee','#f472b6'];
      const agentTotal = agentRows.reduce((n,a)=>n+(a.total_tokens||0),0);
      let cursor = 0;
      const donutStops = agentRows.map((a,i)=>{ const pct=agentTotal ? (a.total_tokens||0)/agentTotal*100 : 0; const from=cursor; cursor+=pct; return `${palette[i%palette.length]} ${from}% ${cursor}%`; }).join(', ');
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
          <div class="panel-head"><h3>سهم مصرف بر اساس عامل/کانال</h3><span class="muted">درخواست‌های همین بازه</span></div>
          <div class="agent-share"><div class="agent-donut" style="background:conic-gradient(${donutStops || 'var(--bg-3) 0 100%'})"><span>${agentTotal.toLocaleString()}<small>tokens</small></span></div><div class="agent-share-legend">${agentRows.map((a,i)=>`<div><i style="background:${palette[i%palette.length]}"></i><strong>${esc(a.agent)}</strong><span>${a.total_tokens.toLocaleString()} · ${agentTotal ? (a.total_tokens/agentTotal*100).toFixed(1) : '0.0'}%</span></div>`).join('') || '<span class="muted">هنوز داده‌ای نیست.</span>'}</div></div>
        </div>

        <div class="panel">
            <div class="panel-head">
              <h3>تفکیک دقیق توکن، کش و حافظه بر اساس مدل (Observed Models)</h3>
              <span class="mono muted">window: ${curWin === 0 ? 'ALL' : curWin + 'h'}</span>
            </div>
            <div class="table-scroll">
              <table class="grid-table">
                <thead>
                  <tr>
                    <th>مدل</th>
                    <th>درخواست</th>
                    <th>ورودی جدید (Uncached)</th>
                    <th>کش بازیافتی (KV Hit)</th>
                    <th>نرخ کش و افت</th>
                    <th>خروجی (Output)</th>
                    <th>توزیع توکن</th>
                    <th>حجم کش تخمینی (q8_0)</th>
                    <th>سرعت تولید</th>
                  </tr>
                </thead>
                <tbody>
                  ${(u.by_model || []).map(m => `
                    <tr>
                      <td class="m"><strong style="cursor:pointer;color:var(--cyan)" onclick="ABApp.filterByObservedModel('${esc(m.model)}')">${esc(m.model)}</strong></td>
                      <td class="m">${m.requests}</td>
                      <td class="m" style="color:var(--cyan)">${m.uncached_input.toLocaleString()}</td>
                      <td class="m" style="color:var(--phosphor)">${m.cached_input.toLocaleString()}</td>
                      <td class="m">
                        ${renderKvPill(m.flushes > 0 ? 'flush' : '', m.cache_hit_pct)}
                        ${m.flushes > 0 ? `<span class="muted">(${m.flushes} افت احتمالی)</span>` : ''}
                      </td>
                      <td class="m" style="color:var(--violet)">${m.output_tokens.toLocaleString()}</td>
                      <td style="min-width:110px;">${renderTokBar(m.cached_input, m.uncached_input, m.output_tokens)}</td>
                      <td class="m" title="تخمین تقریبی بر اساس فرض KV نوع q8_0 و دسته‌بندی مدل؛ مقدار واقعی سرور نیست.">~${m.est_kv_mb_q8 || 0} MB · بیشترین ورودی+خروجی مشاهده‌شده: ${(m.peak_request_tokens || m.peak_ctx || 0).toLocaleString()} tok</td>
                      <td class="m">${m.avg_decode_tps} t/s</td>
                    </tr>
                  `).join('') || '<tr><td colspan="9" class="muted">هنوز مدلی ثبت نشده است.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>مقایسه بازده کش عامل‌ها (Agents KV Efficiency)</h3></div>
            <div class="table-scroll">
              <table class="grid-table">
                <thead>
                  <tr>
                    <th>عامل</th>
                    <th>درخواست</th>
                    <th>ورودی جدید (Uncached)</th>
                    <th>کش KV</th>
                    <th>نرخ کش</th>
                    <th>خروجی (Output)</th>
                    <th>صرفه‌جویی FA→EN</th>
                    <th>سرعت</th>
                    <th>معادل کلود</th>
                  </tr>
                </thead>
                <tbody>
                  ${(u.by_agent || []).map(a => `
                    <tr>
                      <td class="m"><strong>${esc(a.agent)}</strong></td>
                      <td class="m">${a.requests}</td>
                      <td class="m" style="color:var(--cyan)">${a.uncached_input.toLocaleString()}</td>
                      <td class="m" style="color:var(--phosphor)">${a.cached_input.toLocaleString()}</td>
                      <td class="m">${renderKvPill(a.flushes > 0 ? 'flush' : '', a.cache_hit_pct)}</td>
                      <td class="m" style="color:var(--violet)">${a.output_tokens.toLocaleString()}</td>
                      <td class="m" style="color:var(--phosphor)">+${(a.saved_fa_tokens || 0).toLocaleString()} tok</td>
                      <td class="m">${a.avg_decode_tps} t/s</td>
                      <td class="m">$${a.shadow_cost_usd}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="9" class="muted">داده‌ای ثبت نشده است.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;
      return;
    }

    // Default: usage-overview (Categorized KV-Cache Hunter Dashboard)
    const maxBar = Math.max(1, ...(u.hourly || []).map(h => h.uncached_input + h.cached_input + h.output_tokens));
    const winBtns = [
      [1, '1H'], [24, '24H'], [168, '7D'], [720, '30D'], [0, 'ALL']
    ].map(([hrs, lbl]) => `<button class="seg-btn ${curWin === hrs ? 'on' : ''}" onclick="ABUsagePage.setFilter({hours:${hrs}})">${lbl}</button>`).join('');

    const modelOpts = ['all', ...(u.observed_models || [])].map(m =>
      `<option value="${esc(m)}" ${curModel === m ? 'selected' : ''}>${m === 'all' ? 'همه مدل‌ها (All Models)' : esc(m)}</option>`
    ).join('');

    const agentOpts = ['all', ...(u.observed_agents || [])].map(a =>
      `<option value="${esc(a)}" ${curAgent === a ? 'selected' : ''}>${a === 'all' ? 'همه عامل‌ها (All Agents)' : esc(a)}</option>`
    ).join('');

    const profOpts = Object.entries(u.pricing_profiles || {}).map(([k, v]) =>
      `<option value="${esc(k)}" ${k === u.pricing_profile ? 'selected' : ''}>${esc(v.label)}</option>`
    ).join('');

    const totAll = Math.max(1, w.total_tokens || 0);
    const messageEstimates = u.message_estimates || {};

    host.innerHTML = `
      <div class="panel-wrap">
        <div class="panel" style="padding:12px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <div class="seg-group">${winBtns}</div>
            <select class="btn mono" onchange="ABUsagePage.setFilter({model:this.value})">${modelOpts}</select>
            <select class="btn mono" onchange="ABUsagePage.setFilter({agent:this.value})">${agentOpts}</select>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select class="btn mono" onchange="ABUsagePage.setPricing(this.value)">${profOpts}</select>
            <button class="btn danger" onclick="ABApp.navigate('set-retention')">حذف آمار توکن…</button>
          </div>
        </div>

        ${(w.missing_input_count_requests || w.missing_cache_count_requests || w.missing_output_count_requests) ? `<div class="panel" style="border-color:var(--amber);color:var(--amber);padding:10px 14px;">کامل‌بودن آمار در ${w.requests || 0} درخواست: شمارش ورودی در ${w.missing_input_count_requests || 0}، تفکیک کش در ${w.missing_cache_count_requests || 0} و شمارش خروجی در ${w.missing_output_count_requests || 0} درخواست گزارش نشده است. بخش‌های گزارش‌نشده در جمع‌ها صفر فرض می‌شوند؛ آمار قدیمی نیز ممکن است منبع شمارش نداشته باشد.</div>` : ''}

        <!-- توکن‌های ورودی، کش و خروجی جدا نگه داشته می‌شوند؛ جمع کل شامل هر سه است. -->
        <div class="stat-strip">
          <div class="stat-box">
            <div class="stat-lbl"><span>کش بازیافتی (Cached KV)</span><span class="kv-pill warm">${w.cache_hit_pct || 0}%</span></div>
            <div class="stat-num" style="color:var(--phosphor)">${(w.cached_input || 0).toLocaleString()}</div>
            <div class="stat-sub">افت احتمالی کش: ${w.flush_count || 0} مورد · بیشترین ورودی+خروجی یک درخواست: ${(w.peak_request_tokens || w.peak_ctx_tokens || 0).toLocaleString()} توکن</div>
          </div>

          <div class="stat-box">
            <div class="stat-lbl"><span>ورودی پردازش‌شده (Uncached In)</span><span class="mono muted">pp</span></div>
            <div class="stat-num" style="color:var(--cyan)">${(w.uncached_input || 0).toLocaleString()}</div>
            <div class="stat-sub">pp_speed: ${w.avg_prompt_tps || 0} t/s · reqs: ${w.requests || 0}</div>
          </div>

          <div class="stat-box">
            <div class="stat-lbl"><span>توکن خروجی مدل (Output)</span><span class="mono muted">tg</span></div>
            <div class="stat-num" style="color:var(--violet)">${(w.output_tokens || 0).toLocaleString()}</div>
            <div class="stat-sub">tg_speed: ${w.avg_decode_tps || 0} t/s · total: ${(w.total_tokens || 0).toLocaleString()}</div>
          </div>

          <div class="stat-box">
            <div class="stat-lbl"><span>پیام کاربر · ورودی تخمینی</span><span class="mono muted">${Number(messageEstimates.user_messages || 0)} پیام</span></div>
            <div class="stat-num" style="color:var(--phosphor)">~${Number(messageEstimates.input_source_tokens || 0).toLocaleString()} → ~${Number(messageEstimates.input_sent_tokens || 0).toLocaleString()}</div>
            <div class="stat-sub">برآورد متن مبدأ → متن ارسالی · صرفه‌جویی ~${Number(messageEstimates.input_saved_tokens || 0).toLocaleString()} · افزایش ~${Number(messageEstimates.input_expansion_tokens || 0).toLocaleString()} توکن</div>
          </div>

          <div class="stat-box">
            <div class="stat-lbl"><span>پیام مدل · خروجی و نمایش</span><span class="mono muted">${Number(messageEstimates.assistant_messages || 0)} پاسخ</span></div>
            <div class="stat-num" style="color:var(--violet)">${(w.output_tokens || 0).toLocaleString()} actual</div>
            <div class="stat-sub">متن مدل ~${Number(messageEstimates.model_output_text_tokens || 0).toLocaleString()} → نمایش فارسی ~${Number(messageEstimates.persian_display_tokens || 0).toLocaleString()} تخمینی · ترجمه‌شده ${Number(messageEstimates.assistant_translated_messages || 0)} پاسخ</div>
          </div>

          <div class="stat-box">
            <div class="stat-lbl"><span>ارزش معادل کلود (Shadow $)</span><span class="mono muted">USD</span></div>
            <div class="stat-num">$${Number(w.shadow_cost_usd || 0).toFixed(4)}</div>
            <div class="stat-sub">معادل تخمینی با نرخ پروفایل · یک‌ساعت اخیر: $${Number(u.last_1h?.shadow_cost_usd || 0).toFixed(4)}</div>
          </div>
        </div>
        <div class="muted" style="font-size:11px;padding:0 4px 8px;">دو کارت برآورد نویسه‌ایِ پیام‌اند، نه tokenizer یا صورتحساب؛ ورودی فقط پیام کاربر است و متن سیستم/تاریخچه، ابزارها و Think در این تخمین نیستند. پاسخ فارسی متن نمایشی است و خروجی API واقعی جدا بالاست. تاریخچهٔ بی‌زمان در بازه‌های محدود قابل‌تفکیک نیست و فقط در ALL جمع می‌شود.</div>

        <div class="panel">
          <div class="panel-head"><h3>مقایسه‌ی هزینه‌ی همین مصرف با قیمت هر مدل</h3><span class="muted">نرخ ورودی / کش‌خوانی / خروجی · USD به‌ازای یک‌میلیون توکن؛ تخمین، نه صورتحساب</span></div>
          <div class="stat-strip cost-matrix">
            ${(u.cost_matrix || []).map(p => `<button class="stat-box clickable ${u.pricing_profile === p.id ? 'selected' : ''}" title="منبع نرخ: ${esc(p.source || 'نامشخص')}" onclick="ABUsagePage.setPricing('${esc(p.id)}')"><div class="stat-lbl">${esc(p.label)}</div><div class="stat-num">$${Number(p.cost_usd).toFixed(4)}</div><div class="stat-sub">نرخ ${esc(p.rates || '—')} · بدون کش $${Number(p.nocache_usd).toFixed(4)} · اختلاف کش $${Number(p.saved_usd).toFixed(4)}</div><small class="muted">${esc(p.note || '')}</small><small class="muted">منبع: <a href="${esc(p.source || '#')}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc((p.source || 'نامشخص').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a> · بررسی نرخ: ${esc(p.checked_at || 'نامشخص')}</small></button>`).join('') || '<div class="muted">پروفایل قیمتی در دسترس نیست.</div>'}
          </div>
        </div>

        <!-- نوار تناسب کل توکن‌های عبوری -->
        <div class="panel" style="padding:14px 20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;flex-wrap:wrap;gap:8px;">
            <strong>نسبت تفکیکی کل توکن‌های عبوری در این بازه</strong>
            <div class="mono" style="display:flex;gap:14px;direction:ltr;font-size:11.5px;">
              <span style="color:var(--phosphor)">● Cached KV (${Math.round((w.cached_input || 0) / totAll * 100)}%)</span>
              <span style="color:var(--cyan)">● Uncached Input (${Math.round((w.uncached_input || 0) / totAll * 100)}%)</span>
              <span style="color:var(--violet)">● Output (${Math.round((w.output_tokens || 0) / totAll * 100)}%)</span>
            </div>
          </div>
          ${renderTokBar(w.cached_input || 0, w.uncached_input || 0, w.output_tokens || 0)}
        </div>

        <!-- تفکیک زمانی نمودار با بازه انتخاب‌شده تغییر می‌کند -->
        <div class="panel">
          <div class="panel-head">
            <h3>روند توکن‌ها · ${{ hour: 'ساعتی', day: 'روزانه', week: 'هفتگی' }[u.chart_granularity] || 'زمانی'}</h3>
            <span class="mono muted">سبز = کش KV · آبی = ورودی جدید · بنفش = خروجی</span>
          </div>
          <div style="display:flex;align-items:flex-end;gap:10px;height:125px;direction:ltr;padding-top:12px;">
            ${(u.hourly?.length ? u.hourly : [{ hour: '00:00', uncached_input: 0, cached_input: 0, output_tokens: 0 }]).map(h => {
              const tot = h.uncached_input + h.cached_input + h.output_tokens;
              const px = Math.max(4, Math.round((tot / maxBar) * 86));
              const kvH = tot > 0 ? Math.round((h.cached_input / tot) * px) : 0;
              const inH = tot > 0 ? Math.round((h.uncached_input / tot) * px) : 0;
              const outH = Math.max(0, px - kvH - inH);
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;">
                  <span class="mono muted" style="font-size:10px;">${tot > 999 ? (tot / 1000).toFixed(1) + 'k' : tot}</span>
                  <div style="width:100%;max-width:32px;height:${px}px;display:flex;flex-direction:column;border-radius:6px 6px 2px 2px;overflow:hidden;background:rgba(255,255,255,0.05);">
                    <i style="height:${outH}px;background:var(--violet);display:block;"></i>
                    <i style="height:${inH}px;background:var(--cyan);display:block;"></i>
                    <i style="height:${kvH}px;background:var(--phosphor);display:block;"></i>
                  </div>
                  <span class="mono muted" style="font-size:10px;">${esc(u.chart_granularity === 'hour' ? String(h.hour).slice(-5) : (u.chart_granularity === 'day' ? String(h.hour).slice(5) : String(h.hour).slice(-3)))}</span>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- جدول تمیز آخرین درخواست‌ها برای شکار افت کش -->
        <div class="panel">
          <div class="panel-head">
            <h3>جدول شکارچی کش — آخرین درخواست‌های عبوری از <code>/v1</code></h3>
            <span class="mono muted">هشدار احتمالی افت کش با مقایسهٔ درخواست‌های پیاپی؛ تشخیص قطعی رخداد GPU نیست.</span>
          </div>
          <div class="table-scroll">
            <table class="grid-table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>عامل</th>
                  <th>مدل</th>
                  <th>وضعیت کش</th>
                  <th>گزارش شمارش</th>
                  <th>کش KV</th>
                  <th>ورودی جدید</th>
                  <th>خروجی</th>
                  <th>توزیع</th>
                  <th>سرعت (pp / tg)</th>
                  <th>صرفه‌جویی FA</th>
                  <th>پیش‌نمایش پرامپت</th>
                </tr>
              </thead>
              <tbody>
                ${(u.recent || []).map(r => `
                  <tr>
                    <td class="m">${esc(r.time)}</td>
                    <td class="m"><strong>${esc(r.agent)}</strong></td>
                    <td class="m" style="color:var(--cyan)">${esc(r.model)}</td>
                    <td class="m">${renderKvPill(r.kv_status, r.cache_pct)}</td>
                    <td class="m" title="منبع شمارش از پاسخ مدل/provider">ورودی ${r.input_count_reported ? 'گزارش‌شده' : 'ناموجود'} · تفکیک کش ${r.cache_count_reported ? 'گزارش‌شده' : 'ناموجود'} · خروجی ${r.output_count_reported ? 'گزارش‌شده' : 'ناموجود'}</td>
                    <td class="m" style="color:var(--phosphor)">${r.cached_in.toLocaleString()}</td>
                    <td class="m" style="color:var(--cyan)">${r.uncached_in.toLocaleString()}</td>
                    <td class="m" style="color:var(--violet)">${r.out_tok.toLocaleString()}</td>
                    <td style="min-width:95px;">${renderTokBar(r.cached_in, r.uncached_in, r.out_tok)}</td>
                    <td class="m">${r.prompt_tps || 0} / ${r.decode_tps || 0} t/s</td>
                    <td class="m" style="color:var(--phosphor)">${r.saved_fa > 0 ? '+' + r.saved_fa : '—'}</td>
                    <td style="max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.preview)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="12" class="muted">هنوز درخواستی ثبت نشده است.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  return { render, setFilter, setPricing, clearAll };
})();
