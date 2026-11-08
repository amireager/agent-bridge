// Modular Telemetry Page — Observed-Model Selector, KV Volume, Agent Split & X-Ray
window.ABUsagePage = (() => {
  const { esc, api } = window.ABUtils;

  async function setFilter(patch) {
    await api('/api/usage/filter', patch);
  }

  async function setPricing(prof) {
    await api('/api/config', { pricing: { active_profile: prof } });
  }

  async function clearAll() {
    await api('/api/telemetry/clear', {});
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
              <h3>بازرس پیام خام عبوری بین عامل و مدل (Wire X-Ray)</h3>
              <span class="mono muted">${items.length} frames</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${items.map(it => `
                <details class="trace-acc">
                  <summary>
                    <span>[${esc(it.ts)}] agent=${esc(it.agent)} · model=${esc(it.model)} · msgs=${it.message_count} · sys=${it.system_chars}ch</span>
                    <span>kv:${it.cached_in} + in:${it.uncached_in} → out:${it.out_tok} (${it.tg_tps}t/s)</span>
                  </summary>
                  <div class="acc-body">${esc(JSON.stringify(it.messages_tail, null, 2))}</div>
                </details>
              `).join('') || '<div class="muted">هنوز ترافیکی از گذرگاه عبور نکرده است.</div>'}
            </div>
          </div>
        </div>`;
      return;
    }

    if (route === 'usage-agents') {
      host.innerHTML = `
        <div class="panel-wrap">
          <div class="panel">
            <div class="panel-head">
              <h3>تفکیک توکن و کش بر اساس نام مدل ارسالی عامل (Observed Models)</h3>
              <span class="mono muted">window: ${curWin === 0 ? 'ALL' : curWin + 'h'}</span>
            </div>
            <table class="grid-table">
              <thead>
                <tr>
                  <th>نام مدل در پیام عامل</th>
                  <th>درخواست</th>
                  <th>ورودی جدید</th>
                  <th>خوانده از کش</th>
                  <th>نرخ کش</th>
                  <th>خروجی</th>
                  <th>حجم تخمینی کش (q8_0)</th>
                  <th>سرعت</th>
                  <th>معادل کلود</th>
                </tr>
              </thead>
              <tbody>
                ${(u.by_model || []).map(m => `
                  <tr>
                    <td class="m"><strong style="cursor:pointer;color:var(--cyan)" onclick="ABApp.filterByObservedModel('${esc(m.model)}')">${esc(m.model)}</strong></td>
                    <td class="m">${m.requests}</td>
                    <td class="m">${m.uncached_input.toLocaleString()}</td>
                    <td class="m" style="color:var(--phosphor)">${m.cached_input.toLocaleString()}</td>
                    <td class="m">${m.cache_hit_pct}%</td>
                    <td class="m">${m.output_tokens.toLocaleString()}</td>
                    <td class="m">~${m.est_kv_mb_q8 || 0} MB (peak ${m.peak_ctx || 0}t)</td>
                    <td class="m">${m.avg_decode_tps} t/s</td>
                    <td class="m">$${m.shadow_cost_usd}</td>
                  </tr>
                `).join('') || '<tr><td colspan="9" class="muted">هنوز مدلی ثبت نشده است.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>تفکیک توکن و کش بر اساس عامل (Agents)</h3></div>
            <table class="grid-table">
              <thead>
                <tr>
                  <th>نام عامل</th><th>درخواست</th><th>ورودی جدید</th><th>خوانده از کش</th><th>نرخ کش</th><th>خروجی</th><th>سرعت</th><th>معادل کلود</th>
                </tr>
              </thead>
              <tbody>
                ${(u.by_agent || []).map(a => `
                  <tr>
                    <td class="m"><strong>${esc(a.agent)}</strong></td>
                    <td class="m">${a.requests}</td>
                    <td class="m">${a.uncached_input.toLocaleString()}</td>
                    <td class="m" style="color:var(--phosphor)">${a.cached_input.toLocaleString()}</td>
                    <td class="m">${a.cache_hit_pct}%</td>
                    <td class="m">${a.output_tokens.toLocaleString()}</td>
                    <td class="m">${a.avg_decode_tps} t/s</td>
                    <td class="m">$${a.shadow_cost_usd}</td>
                  </tr>
                `).join('') || '<tr><td colspan="8" class="muted">داده‌ای ثبت نشده است.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>`;
      return;
    }

    // Default: usage-overview with Model & Agent Filter Selectors
    const maxBar = Math.max(1, ...(u.hourly || []).map(h => h.uncached_input + h.cached_input + h.output_tokens));
    const winBtns = [
      [1, '1H'], [24, '24H'], [168, '7D'], [720, '30D'], [0, 'ALL']
    ].map(([hrs, lbl]) => `<button class="btn ghost ${curWin === hrs ? 'on' : ''}" onclick="ABUsagePage.setFilter({hours:${hrs}})">${lbl}</button>`).join('');

    const modelOpts = ['all', ...(u.observed_models || [])].map(m =>
      `<option value="${esc(m)}" ${curModel === m ? 'selected' : ''}>${m === 'all' ? 'همه مدل‌ها (All Models)' : esc(m)}</option>`
    ).join('');

    const agentOpts = ['all', ...(u.observed_agents || [])].map(a =>
      `<option value="${esc(a)}" ${curAgent === a ? 'selected' : ''}>${a === 'all' ? 'همه عامل‌ها (All Agents)' : esc(a)}</option>`
    ).join('');

    const profOpts = Object.entries(u.pricing_profiles || {}).map(([k, v]) =>
      `<option value="${esc(k)}" ${k === u.pricing_profile ? 'selected' : ''}>${esc(v.label)}</option>`
    ).join('');

    host.innerHTML = `
      <div class="panel-wrap">
        <div class="panel" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${winBtns}
            <select class="btn mono" onchange="ABUsagePage.setFilter({model:this.value})" title="فیلتر بر اساس نام مدل">${modelOpts}</select>
            <select class="btn mono" onchange="ABUsagePage.setFilter({agent:this.value})" title="فیلتر بر اساس عامل">${agentOpts}</select>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="btn mono" onchange="ABUsagePage.setPricing(this.value)">${profOpts}</select>
            <button class="btn danger" onclick="ABUsagePage.clearAll()">ریست کنتور</button>
          </div>
        </div>

        <div class="stat-strip">
          <div class="stat-box">
            <div class="stat-lbl">کل توکن‌های شمارش‌شده</div>
            <div class="stat-num">${(w.total_tokens || 0).toLocaleString()}</div>
            <div class="stat-sub">reqs:${w.requests || 0} · out:${(w.output_tokens || 0).toLocaleString()}</div>
          </div>
          <div class="stat-box">
            <div class="stat-lbl">بازده کش (KV Cache Hit)</div>
            <div class="stat-num" style="color:var(--phosphor)">${w.cache_hit_pct || 0}%</div>
            <div class="stat-sub">kv:${(w.cached_input || 0).toLocaleString()} · new:${(w.uncached_input || 0).toLocaleString()}</div>
          </div>
          <div class="stat-box">
            <div class="stat-lbl">بیشینه کانتکست و سرعت</div>
            <div class="stat-num">${w.avg_decode_tps || 0} t/s</div>
            <div class="stat-sub">peak_ctx:${(w.peak_ctx_tokens || 0).toLocaleString()} tok · pp:${w.avg_prompt_tps || 0} t/s</div>
          </div>
          <div class="stat-box">
            <div class="stat-lbl">هزینه معادل کلود</div>
            <div class="stat-num">$${Number(w.shadow_cost_usd || 0).toFixed(4)}</div>
            <div class="stat-sub">1h: $${Number(u.last_1h?.shadow_cost_usd || 0).toFixed(4)}</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>هیستوگرام ساعتی مصرف توکن</h3></div>
          <div style="display:flex;align-items:flex-end;gap:8px;height:105px;direction:ltr;padding-top:10px;">
            ${(u.hourly?.length ? u.hourly : [{ hour: '00:00', uncached_input: 0, cached_input: 0, output_tokens: 0 }]).map(h => {
              const tot = h.uncached_input + h.cached_input + h.output_tokens;
              const px = Math.max(3, Math.round((tot / maxBar) * 74));
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                <span class="mono muted" style="font-size:10px;">${tot}</span>
                <div style="width:100%;max-width:34px;height:${px}px;background:var(--fg-1);border-radius:2px 2px 0 0;"></div>
                <span class="mono muted" style="font-size:10px;">${esc(String(h.hour).slice(-5))}</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>آخرین پیام‌های عبوری شمارش‌شده</h3></div>
          <table class="grid-table">
            <thead>
              <tr><th>ساعت</th><th>عامل</th><th>نام مدل</th><th>ورودی جدید</th><th>کش KV</th><th>خروجی</th><th>سرعت</th><th>هزینه فرضی</th><th>پیش‌نمایش</th></tr>
            </thead>
            <tbody>
              ${(u.recent || []).map(r => `
                <tr>
                  <td class="m">${esc(r.time)}</td>
                  <td class="m"><strong>${esc(r.agent)}</strong></td>
                  <td class="m" style="color:var(--cyan)">${esc(r.model)}</td>
                  <td class="m">${r.uncached_in}</td>
                  <td class="m" style="color:var(--phosphor)">${r.cached_in}</td>
                  <td class="m">${r.out_tok}</td>
                  <td class="m">${r.decode_tps}</td>
                  <td class="m">$${r.cost_usd}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.preview)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  return { render, setFilter, setPricing, clearAll };
})();
