const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function classList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
    toggle(value, force) {
      if (force === undefined) force = !values.has(value);
      if (force) values.add(value); else values.delete(value);
      return force;
    }
  };
}
function element() {
  return {
    innerHTML: '', textContent: '', dataset: {}, style: {
      props: {}, setProperty(name, value) { this.props[name] = value; },
      getPropertyValue(name) { return this.props[name] || ''; }
    },
    classList: classList(), listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute() {},
    setPointerCapture() {},
    querySelector() { return null; },
    prepend() {}
  };
}
const els = Object.fromEntries(['shellRoot','sidebar','sidebarResizer','sbTree','sbFoot','hudBar','pageHost'].map(id => [id, element()]));
els.sidebar.getBoundingClientRect = () => ({ width: Number.parseFloat(els.shellRoot.style.getPropertyValue('--sidebar-width')) || 280 });
const state = {
  config: { ui:{sidebar_width:280,sidebar_side:'left'}, translation:{enabled:true}, retention:{days:14}, tap:{} },
  usage:{window:{}}, upstream:{}, active_conversation:{turns:[]}, storage:{}, model_status:{local_online:true},
  view_kind:'mirror', view_id:'', mirrors:[], mirror_history:[], lab_sessions:[],
  lab_history:[{id:'lab-old',title:'Archived Lab',turn_count:2,archived:true}]
};
const apiCalls = [];
global.window = {
  innerWidth:1200,
  listeners:{},
  addEventListener(type, callback){this.listeners[type]=callback;},
  removeEventListener(type){delete this.listeners[type];},
  setInterval:()=>0,
  ABUtils:{
    ICONS:{terminal:'T',clock:'C',cpu:'P',chart:'U',sliders:'S',chevronDown:'v',chevronRight:'>' ,swap:'⇄'},
    esc:value=>String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    api:async(path, body)=>{apiCalls.push({path,body});return path==='/api/state'?state:{ok:true};}
  },
  ABChatPage:{render(){}},
  EventSource:class { constructor(){} close(){} }
};
global.EventSource = window.EventSource;
global.document = {
  getElementById:id=>els[id]||null,
  documentElement:{setAttribute(){}},
};
global.confirm=()=>true;
vm.runInThisContext(fs.readFileSync('frontend/core/state.js','utf8'));

(async()=>{
  window.ABApp.boot();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(els.sbTree.innerHTML,/حذف دائمی تاریخچهٔ Lab/);
  assert.match(els.sbTree.innerHTML,/ABApp\.deleteLabSession\('lab-old',event\)/);

  const handle=els.sidebarResizer;
  handle.listeners.pointerdown({button:0,pointerId:7,clientX:280,preventDefault(){},stopPropagation(){}});
  window.listeners.pointermove({pointerId:7,clientX:360});
  assert.equal(els.shellRoot.style.getPropertyValue('--sidebar-width'),'360px');
  window.listeners.pointerup({pointerId:7});
  await window.ABApp.deleteLabSession('lab-old');
  assert(apiCalls.some(call=>call.path==='/api/config'&&call.body.ui.sidebar_width===360));
  assert(apiCalls.some(call=>call.path==='/api/lab/delete'&&call.body.session_id==='lab-old'));
  assert.equal(state.lab_history.length,0);
  console.log('sidebar resize and archived Lab delete smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
