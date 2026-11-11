const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/pages/home/home.js', 'utf8');
const window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]) },
  ABApp: { navigate() {}, toggleProxyMode() {}, selectMirror() {} },
};
vm.runInNewContext(source, { window, navigator: {}, setTimeout });

function render(state) {
  const host = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  window.ABHomePage.render(host, state);
  return host.innerHTML;
}

const common = {
  bridge_port: 18080,
  config: {
    translation: { enabled: true, engine: 'builtin-online' },
    models: { default_mode: 'local' },
  },
  upstream: {
    online: true,
    detected_model: 'local-model',
    available_models: ['local-model', 'local-second-model'],
    server_ctx: 65536,
  },
  mirrors: [],
  translator_online: true,
};

const empty = render(common);
assert.match(empty, /local-model/);
assert.match(empty, /local-second-model/);
assert.match(empty, /مترجم آنلاین/);
assert.doesNotMatch(empty, /agent-resource/);
assert.doesNotMatch(empty, /aria-label="عامل‌های متصل"/);

const connected = render({
  ...common,
  mirrors: [{ agent_id: 'omp-2', pty_live: true, activity: 'GENERATING' }],
});
assert.match(connected, /عامل‌های متصل/);
assert.match(connected, /omp-2/);
assert.match(connected, /در حال پاسخ‌گویی/);
assert.match(connected, /مشغول/);

const disconnectedModel = render({
  ...common,
  upstream: { online: false, available_models: [], detected_model: 'listening...' },
  mirrors: [],
});
assert.match(disconnectedModel, /مدل در دسترس نیست/);
assert.doesNotMatch(disconnectedModel, /agent-resource/);

console.log('home dashboard render tests: OK');
