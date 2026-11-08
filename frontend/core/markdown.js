// Pure Offline XSS-Safe CommonMark / GFM Renderer + Syntax Highlighter
window.ABMarkdown = (() => {
  const { esc } = window.ABUtils;

  const KW_RE = /\b(def|class|return|import|from|if|elif|else|for|while|try|except|finally|with|as|async|await|function|const|let|var|export|default|struct|impl|fn|pub|use|match|sudo|nix|git|python3|bash)\b/g;

  function highlightCode(raw) {
    // Tokenize comments & strings first to avoid nested replacements
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
    btn.textContent = 'COPIED';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  function renderInline(str) {
    const codeStash = [];
    let s = String(str ?? '').replace(/`([^`\n]+)`/g, (_, c) => {
      codeStash.push(`<code>${esc(c)}</code>`);
      return `\x00INL${codeStash.length - 1}\x00`;
    });
    s = esc(s);
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
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  function renderProseSegment(seg) {
    const lines = seg.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) { i++; continue; }

      // Horizontal rule
      if (/^\s*([-*_])\1\1+\s*$/.test(ln)) {
        out.push('<hr/>');
        i++; continue;
      }

      // Heading
      const hm = ln.match(/^(#{1,4})\s+(.+)$/);
      if (hm) {
        const lvl = hm[1].length;
        out.push(`<h${lvl}>${renderInline(hm[2])}</h${lvl}>`);
        i++; continue;
      }

      // GFM Table
      if (ln.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        const tbl = [ln, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          tbl.push(lines[i++]);
        }
        out.push(renderTable(tbl));
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(ln)) {
        const bq = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          bq.push(renderInline(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        out.push(`<blockquote>${bq.join('<br/>')}</blockquote>`);
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          let itemTxt = lines[i].replace(/^\s*[-*+]\s+/, '');
          itemTxt = itemTxt.replace(/^\[([ xX])\]\s+/, (_, chk) =>
            `<input type="checkbox" disabled ${chk.toLowerCase() === 'x' ? 'checked' : ''} style="margin-inline-end:6px;"/>`
          );
          items.push(`<li>${ itemTxt.startsWith('<input') ? itemTxt.slice(0, itemTxt.indexOf('/>') + 2) + renderInline(itemTxt.slice(itemTxt.indexOf('/>') + 2)) : renderInline(itemTxt) }</li>`);
          i++;
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(ln)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
          i++;
        }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // Paragraph
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
        const nl = ch.indexOf('\n');
        const lang = (nl > 3 ? ch.slice(3, nl).trim() : '') || 'code';
        const rawCode = (nl > -1 ? ch.slice(nl + 1, -3) : ch.slice(3, -3)).replace(/\n$/, '');
        const encoded = encodeURIComponent(rawCode);
        return `
          <div class="md-code">
            <div class="md-code-bar">
              <span>${esc(lang)}</span>
              <button class="md-copy-btn" onclick="ABMarkdown.copyCodeBtn(this,'${encoded}')">COPY</button>
            </div>
            <pre>${highlightCode(rawCode)}</pre>
          </div>`;
      }
      return renderProseSegment(ch);
    }).join('');
    return `<div class="md-body">${html}</div>`;
  }

  return { render, copyCodeBtn };
})();
