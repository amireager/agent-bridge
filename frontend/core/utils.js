// Monochrome SVG Icons & Formatting Helpers (Zero Cartoon Emojis)
window.ABUtils = (() => {
  const ICONS = {
    chevronDown: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6l4 4 4-4"/></svg>',
    chevronRight: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4l4 4-4 4"/></svg>',
    terminal: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4l4 4-4 4M8 12h5"/></svg>',
    cpu: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3"/></svg>',
    chart: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 13.5h12M4 11V7M8 11V3M12 11V6"/></svg>',
    sliders: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.5" fill="var(--bg-1)"/><circle cx="11" cy="8" r="1.5" fill="var(--bg-1)"/><circle cx="7" cy="12" r="1.5" fill="var(--bg-1)"/></svg>',
    plus: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v10M3 8h10"/></svg>',
    swap: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h10l-2.5-2.5M13 11H3l2.5 2.5"/></svg>',
    sidebar: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg>'
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderRichProse(text) {
    if (!text) return '';
    const blocks = String(text).split(/(```[\s\S]*?```)/g);
    return blocks.map(blk => {
      if (blk.startsWith('```') && blk.endsWith('```')) {
        const firstNl = blk.indexOf('\n');
        const lang = firstNl > 3 ? blk.slice(3, firstNl).trim() : 'code';
        const code = (firstNl > -1 ? blk.slice(firstNl + 1, -3) : blk.slice(3, -3)).replace(/\n$/, '');
        return `<div class="code-card"><div class="code-card-head"><span>${esc(lang || 'text')}</span></div><pre>${esc(code)}</pre></div>`;
      }
      return esc(blk).replace(/`([^`\n]+)`/g, '<code>$1</code>');
    }).join('');
  }

  async function api(path, body = undefined) {
    const opts = body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET' };
    const r = await fetch(path, opts);
    return r.json();
  }

  return { ICONS, esc, renderRichProse, api };
})();
