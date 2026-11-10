// Pure Offline XSS-Safe CommonMark / GFM + Immersive Interleaved Block Renderer
window.ABMarkdown = (() => {
  const { esc } = window.ABUtils;

  const KW_RE = /\b(def|class|return|import|from|if|elif|else|for|while|try|except|finally|with|as|async|await|function|const|let|var|export|default|struct|impl|fn|pub|use|match|sudo|nix|git|python3|bash)\b/g;

  function highlightCode(raw) {
    const stash = [];
    let work = esc(raw);
    work = work.replace(/(#[^\n]*|\/\/[^\n]*)/g, m => {
      stash.push(`<span class="tok-com">${m}</span>`);
      return `\x00TOK${stash.length - 1}\x00`;
    });
    work = work.replace(/(&quot;.*?&quot;|'[^'\n]*')/g, m => {
      stash.push(`<span class="tok-str">${m}</span>`);
      return `\x00TOK${stash.length - 1}\x00`;
    });
    work = work.replace(KW_RE, '<span class="tok-kw">$1</span>');
    work = work.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    return work.replace(/\x00TOK(\d+)\x00/g, (_, idx) => stash[Number(idx)]);
  }

  function copyCodeBtn(btn, encoded) {
    const text = decodeURIComponent(encoded);
    navigator.clipboard?.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'COPIED ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  function loadImage(button) {
    const url = button?.dataset?.imageUrl || '';
    if (!/^https?:\/\//i.test(url)) return;
    const figure = document.createElement('figure');
    figure.className = 'md-image-frame';
    const img = document.createElement('img');
    img.src = url;
    img.alt = button.dataset.imageAlt || 'تصویر';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('click', () => zoomImage(img));
    img.addEventListener('error', () => { figure.textContent = `تصویر بارگذاری نشد · ${img.alt}`; figure.classList.add('md-image-error'); }, { once: true });
    figure.appendChild(img);
    button.replaceWith(figure);
  }

  function zoomImage(img) {
    img?.classList.toggle('md-image-zoomed');
  }

  function renderCodeCard(rawFence) {
    const ch = String(rawFence || '').trim();
    const nl = ch.indexOf('\n');
    const lang = (nl > 3 ? ch.slice(3, nl).trim() : '') || 'code';
    const rawCode = (nl > -1 ? ch.slice(nl + 1, -3) : ch.slice(3, -3)).replace(/\n$/, '');
    const encoded = encodeURIComponent(rawCode);
    const codeLines = highlightCode(rawCode).split('\n').map(line => `<span class="md-code-line">${line || ' '}</span>`).join('');
    return `
      <div class="md-code">
        <div class="md-code-bar">
          <span>${esc(lang)}</span>
          <button class="md-copy-btn" onclick="ABMarkdown.copyCodeBtn(this,'${encoded}')">Copy</button>
        </div>
        <pre>${codeLines}</pre>
      </div>`;
  }

  function renderInline(str) {
    const codeStash = [];
    let s = String(str ?? '').replace(/`([^`\n]+)`/g, (_, c) => {
      codeStash.push(`<code>${esc(c)}</code>`);
      return `\x00INL${codeStash.length - 1}\x00`;
    });
    s = esc(s);
    const imageMode = (typeof document !== 'undefined' ? document.documentElement?.getAttribute('data-image-mode') : 'click') || 'click';
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)<>\"]+)\)/g, (_, alt, url) => {
      if (imageMode === 'off') return `<span class="md-image-blocked">[تصویر پنهان${alt ? ` · ${alt}` : ''}]</span>`;
      if (imageMode === 'inline') return `<figure class="md-image-frame"><img src="${url}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" onclick="ABMarkdown.zoomImage(this)"></figure>`;
      return `<button class="md-image-reveal" type="button" data-image-url="${url}" data-image-alt="${alt}" onclick="ABMarkdown.loadImage(this)">▧ بارگذاری تصویر${alt ? ` · ${alt}` : ''}</button>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\x00INL(\d+)\x00/g, (_, i) => codeStash[Number(i)]);
  }

  function renderTable(lines) {
    const parseRow = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const head = parseRow(lines[0]);
    const aligns = parseRow(lines[1]).map(a => {
      if (a.startsWith(':') && a.endsWith(':')) return 'center';
      if (a.endsWith(':')) return 'right';
      if (a.startsWith(':')) return 'left';
      return '';
    });
    const body = lines.slice(2).map(parseRow);
    const ths = head.map((h, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(h)}</th>`).join('');
    const trs = body.map(row => `<tr>${row.map((c, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="md-table-scroll" role="region" aria-label="جدول Markdown"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function renderProseSegment(seg) {
    const lines = String(seg ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) { i++; continue; }

      if (/^\s*([-*_])\1\1+\s*$/.test(ln)) {
        out.push('<hr/>');
        i++; continue;
      }

      const hm = ln.match(/^(#{1,4})\s+(.+)$/);
      if (hm) {
        const lvl = hm[1].length;
        out.push(`<h${lvl}>${renderInline(hm[2])}</h${lvl}>`);
        i++; continue;
      }

      if (ln.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        const tbl = [ln, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          tbl.push(lines[i++]);
        }
        out.push(renderTable(tbl));
        continue;
      }

      if (/^\s*>\s?/.test(ln)) {
        const bq = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          bq.push(renderInline(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        out.push(`<blockquote>${bq.join('<br/>')}</blockquote>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          let itemTxt = lines[i].replace(/^\s*[-*+]\s+/, '');
          itemTxt = itemTxt.replace(/^\[([ xX])\]\s+/, (_, chk) =>
            `<input type="checkbox" disabled ${chk.toLowerCase() === 'x' ? 'checked' : ''} style="margin-inline-end:6px;"/>`
          );
          items.push(`<li>${itemTxt.startsWith('<input') ? itemTxt.slice(0, itemTxt.indexOf('/>') + 2) + renderInline(itemTxt.slice(itemTxt.indexOf('/>') + 2)) : renderInline(itemTxt)}</li>`);
          i++;
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
          i++;
        }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*([-*_])\1\1+\s*$/.test(lines[i])
      ) {
        para.push(renderInline(lines[i]));
        i++;
      }
      out.push(`<p>${para.join('<br/>')}</p>`);
    }
    return out.join('');
  }

  function render(markdownText) {
    if (!markdownText) return '';
    const chunks = String(markdownText).split(/(```[\s\S]*?```)/g);
    const html = chunks.map(ch => {
      if (ch.startsWith('```') && ch.endsWith('```')) {
        return renderCodeCard(ch);
      }
      return renderProseSegment(ch);
    }).join('');
    return `<div class="md-body">${html}</div>`;
  }

  /**
   * Browser-extension-style block renderer:
   * - code blocks rendered ONCE untouched
   * - mode === 'interleaved': each English prose block + Persian translation right underneath it
   * - mode === 'fa_only': seamless full-page Persian prose + untouched code blocks
   * - mode === 'en_only': pure original English Markdown + code blocks
   */
  function renderBlocks(blocks, fallbackEn, fallbackFa, mode = 'interleaved') {
    if (mode === 'en_only') {
      return `<div class="ltr">${render(fallbackEn)}</div>`;
    }
    if (mode === 'fa_after') {
      if (!Array.isArray(blocks) || !blocks.length) return `<div class="translation-review-flow"><section><h4>متن اصلی</h4><div class="ltr">${render(fallbackEn)}</div></section><section><h4>ترجمه</h4><div class="rtl">${render(fallbackFa || '')}</div></section></div>`;
      const original = blocks.map(b => b.type === 'code' ? renderCodeCard(b.raw) : b.type === 'hr' ? '<hr/>' : `<div class="md-body para-en">${renderProseSegment(b.en || '')}</div>`).join('');
      const translated = blocks.filter(b => b.type === 'prose').map(b => `<div class="md-body para-fa-seamless">${b.fa && b.fa.trim() ? renderProseSegment(b.fa) : '<span class="translation-missing">ترجمهٔ این بند موجود نیست.</span>'}</div>`).join('');
      return `<div class="translation-review-flow"><section class="translation-original"><h4>متن اصلی · کد دست‌نخورده</h4><div class="immersive-flow">${original}</div></section><section class="translation-fa"><h4>ترجمهٔ فارسی</h4><div class="immersive-flow fa-clean">${translated || '<p class="muted">ترجمه‌ای برای این بخش نداریم.</p>'}</div></section></div>`;
    }
    if (mode === 'side_by_side') {
      if (!Array.isArray(blocks) || !blocks.length) return `<div class="immersive-flow side-by-side side-by-side-fallback"><div class="md-side-column ltr">${render(fallbackEn)}</div><div class="md-side-column rtl">${render(fallbackFa || '')}</div></div>`;
      const inner = blocks.map(b => {
        if (b.type === 'code') return `<div class="md-side-code">${renderCodeCard(b.raw)}</div>`;
        if (b.type === 'hr') return '<hr class="md-side-rule"/>';
        return `<div class="bilingual-pair side-by-side"><div class="md-body para-en">${renderProseSegment(b.en || '')}</div><div class="md-body para-fa">${b.fa && b.fa.trim() ? renderProseSegment(b.fa) : '<span class="translation-missing">ترجمهٔ این بند موجود نیست.</span>'}</div></div>`;
      }).join('');
      return `<div class="immersive-flow side-by-side">${inner}</div>`;
    }
    if (!Array.isArray(blocks) || !blocks.length) {
      if (mode === 'fa_only' && fallbackFa) {
        return `<div class="rtl">${render(fallbackFa)}</div>`;
      }
      return `<div class="ltr">${render(fallbackEn)}</div>`;
    }

    if (mode === 'fa_only') {
      const inner = blocks.map(b => {
        if (b.type === 'code') return renderCodeCard(b.raw);
        if (b.type === 'hr') return '<hr/>';
        const txt = (b.fa && b.fa.trim()) ? b.fa : (b.en || '');
        const dirCls = (b.fa && b.fa.trim()) ? 'para-fa-seamless' : 'para-en';
        return `<div class="md-body ${dirCls}">${renderProseSegment(txt)}</div>`;
      }).join('');
      return `<div class="immersive-flow fa-clean">${inner}</div>`;
    }

    // Default: 'interleaved' — English paragraph on top, Persian translation directly underneath
    const inner = blocks.map(b => {
      if (b.type === 'code') return renderCodeCard(b.raw);
      if (b.type === 'hr') return '<hr/>';
      const enHtml = b.en ? `<div class="md-body para-en">${renderProseSegment(b.en)}</div>` : '';
      const faHtml = (b.fa && b.fa.trim())
        ? `<div class="md-body para-fa">${renderProseSegment(b.fa)}</div>`
        : '';
      return `<div class="bilingual-pair">${enHtml}${faHtml}</div>`;
    }).join('');
    return `<div class="immersive-flow">${inner}</div>`;
  }

  return { render, renderBlocks, copyCodeBtn, loadImage, zoomImage };
})();
