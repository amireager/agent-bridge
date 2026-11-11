const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/pages/about/about.js', 'utf8');
const window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]) },
  ABApp: { navigate() {} },
};
vm.runInNewContext(source, { window });

function render(route) {
  const host = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  window.ABAboutPage.render(host, {
    bridge_port: 18080,
    config: {
      tap: { upstream_url: 'http://127.0.0.1:8080' },
      translation: { enabled: true, engine: 'builtin-online' },
    },
    upstream: { online: true, available_models: ['local-model'] },
    mirrors: [{ agent_id: 'omp-2', pty_live: true }],
  }, route);
  return host.innerHTML;
}

const overview = render('about-overview');
assert.match(overview, /Agent Bridge چه‌کار می‌کند/);
assert.match(overview, /هماهنگ‌کردن چند عامل/);
assert.match(overview, /روش‌های فعالیت/);

const tests = render('about-tests');
assert.match(tests, /اجرای ابزار در OMP/);
assert.match(tests, /مدل stub/);
assert.match(tests, /اجرای زندهٔ تک‌تک باینری‌ها/);

const specs = render('about-specs');
assert.match(specs, /local-model/);
assert.match(specs, /1 عامل زنده/);
assert.match(specs, /18080/);

console.log('about page render tests: OK');
