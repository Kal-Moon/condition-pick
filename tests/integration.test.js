import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as model from '../extension/model.js';
import { searchIsStale } from '../extension/search-model.js';

const read = name => readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8');
const viewHtml = read('view.html');
const viewSource = read('view.js').replace(/^import[^;]+;/gm, '');
const sourceUrl = 'https://prod.danawa.com/list/?cate=112758';
const extensionUrl = 'chrome-extension://integration/';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Integration operation did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
test('real view, worker, content and adapter capture two combinations and reapply across all displays', async () => {
  const originalHtml = '<!doctype html><html><body><main><div id="filters"><h2>????</h2>' +
    '<div><div><div>CPU ??</div><div>' +
    '<div><button id="attr-cpu-5-0" role="checkbox" aria-checked="true"></button><label for="attr-cpu-5-0">??i5</label></div>' +
    '<div><button id="attr-cpu-7-1" role="checkbox" aria-checked="false"></button><label for="attr-cpu-7-1">??i7</label></div>' +
    '</div></div></div><div><div><div>GPU ??</div><div>' +
    '<div><button id="attr-gpu-5060-0" role="checkbox" aria-checked="true"></button><label for="attr-gpu-5060-0">RTX5060</label></div>' +
    '</div></div></div><div><div><div>?</div><div>' +
    '<div><button id="attr-ram-32-0" role="checkbox" aria-checked="true"></button><label for="attr-ram-32-0">32GB</label></div>' +
    '</div></div></div><div><div>???</div><div><input aria-label="?? ??"><input aria-label="?? ??"><button>??</button></div></div>' +
    '</div><section id="productListArea"><a href="/info/?pcode=1">?? ??</a></section>' +
    '<label>?????<button id="shipping" role="switch" aria-checked="false"></button></label></main></body></html>';
  const source = new JSDOM(originalHtml, { url: sourceUrl, runScripts: 'outside-only' });
  const doc = source.window.document;
  const product = doc.getElementById('productListArea');
  const productHtml = product.innerHTML;
  const shadows = new WeakMap();
  const attach = source.window.Element.prototype.attachShadow;
  source.window.Element.prototype.attachShadow = function (options) {
    const root = attach.call(this, options); shadows.set(this, root); return root;
  };
  doc.querySelectorAll('[role=checkbox],[role=switch]').forEach(button => button.addEventListener('click', () => {
    button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
  }));
  let workerListener, contentListener;
  const listeners = [];
  const local = {}, session = {};
  const tabs = new Map([[1, { id: 1, url: sourceUrl, active: true }]]);
  const views = [];
  const storage = (values, area) => ({
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(update) {
      const changes = {};
      for (const [key, value] of Object.entries(update)) {
        changes[key] = { oldValue: structuredClone(values[key]), newValue: structuredClone(value) };
        values[key] = structuredClone(value);
      }
      for (const callback of listeners) callback(changes, area);
    }
  });
  function callWorker(message, sender) {
    return new Promise((resolve, reject) => {
      const handled = workerListener(message, sender, resolve);
      if (!handled) reject(new Error('Worker did not accept request'));
    });
  }
  globalThis.chrome = {
    runtime: { id: 'integration', getURL: value => extensionUrl + value,
      onMessage: { addListener: fn => { workerListener = fn; } }, onInstalled: { addListener() {} } },
    storage: { local: storage(local, 'local'), session: storage(session, 'session') },
    tabs: {
      async get(id) { const tab = tabs.get(id); if (!tab) throw new Error('Tab closed'); return tab; },
      async query() { return [...tabs.values()].filter(tab => tab.active); },
      async update(id, change) { Object.assign(tabs.get(id), change); return tabs.get(id); },
      async create(change) { const tab = { id: tabs.size + 1, ...change }; tabs.set(tab.id, tab); return tab; },
      sendMessage(id, message) {
        assert.equal(id, 1);
        return new Promise((resolve, reject) => {
          let answered = false;
          const async = contentListener(message, { id: 'integration' }, value => { answered = true; resolve(value); });
          if (!async && !answered) reject(new Error('Content did not accept request'));
        });
      }
    }
  };
  await import('../extension/background.js?integration');
  source.window.chrome = {
    runtime: { id: 'integration', getURL: value => extensionUrl + value,
      onMessage: { addListener: fn => { contentListener = fn; } },
      sendMessage: message => callWorker(message, { id: 'integration', url: sourceUrl, tab: tabs.get(1) }) },
    storage: { onChanged: { addListener: fn => listeners.push(fn) } }
  };
  source.window.eval(read('danawa.js'));
  source.window.eval(read('content.js'));
  async function view(surface) {
    const dom = new JSDOM(viewHtml, { url: 'https://extension.test/view.html?surface=' + surface + '&source=1', runScripts: 'outside-only' });
    Object.assign(dom.window, { STORAGE_KEY: model.STORAGE_KEY, readState: model.readState, safeProductUrl: model.safeProductUrl, searchIsStale });
    dom.window.chrome = {
      runtime: { sendMessage: message => callWorker(message, {
        id: 'integration', url: extensionUrl + 'view.html?surface=' + surface,
        ...(surface === 'tab' ? {} : { tab: tabs.get(1) })
      }) },
      storage: { onChanged: { addListener: fn => listeners.push(fn) } }
    };
    dom.window.eval(viewSource); views.push(dom); await tick(); return dom.window.document;
  }
  try {
    const inline = await view('inline');
    inline.getElementById('capture-name').value = '?? A';
    inline.getElementById('capture').click();
    await until(() => local[model.STORAGE_KEY]?.groups[0]?.snapshot && !inline.getElementById('capture').disabled);
    const a = local[model.STORAGE_KEY].groups[0];
    assert.ok(a.snapshot.options.some(option => option.label === '??i5'));
    // These are user edits on the source page, not edits to the saved combination.
    doc.getElementById('attr-cpu-5-0').click();
    doc.getElementById('attr-cpu-7-1').click();
    doc.getElementById('attr-gpu-5060-0').click();
    inline.getElementById('capture-name').value = '?? B';
    inline.getElementById('capture').click();
    await until(() => local[model.STORAGE_KEY].groups.length === 2 && !inline.getElementById('capture').disabled);
    const b = local[model.STORAGE_KEY].groups[1];
    assert.equal(a.snapshot.options.some(option => option.label === '??i7'), false);
    assert.ok(b.snapshot.options.some(option => option.label === '??i7'));
    inline.getElementById('budget').value = '1500000';
    inline.getElementById('save-budget').click();
    inline.getElementById('shipping').checked = true;
    inline.getElementById('shipping').dispatchEvent(new views[0].window.Event('change'));
    await until(() => local[model.STORAGE_KEY].common.budget === 1500000);
    [...inline.querySelectorAll('#groups button')].find(button => button.textContent === '???? ??').click();
    await until(() => local[model.STORAGE_KEY].lastApplied?.groupId === a.id);
    assert.equal(doc.getElementById('attr-cpu-5-0').getAttribute('aria-checked'), 'true');
    assert.equal(doc.getElementById('attr-cpu-7-1').getAttribute('aria-checked'), 'false');
    assert.equal(doc.getElementById('attr-gpu-5060-0').getAttribute('aria-checked'), 'true');
    assert.equal(doc.querySelector('[aria-label="?? ??"]').value, '1500000');
    assert.equal(doc.getElementById('shipping').getAttribute('aria-checked'), 'true');
    await until(() => !inline.getElementById('open').disabled);
    inline.getElementById('mode').value = 'panel';
    inline.getElementById('mode').dispatchEvent(new views[0].window.Event('change'));
    inline.getElementById('open').click();
    await until(() => local[model.STORAGE_KEY].preferredMode === 'panel');
    const host = doc.querySelector('[data-condition-pick=view]');
    assert.match(shadows.get(host).querySelector('iframe').src, /surface=panel/);
    const panel = await view('panel');
    assert.equal(panel.getElementById('budget').value, '1500000');
    assert.equal(panel.querySelectorAll('.group-card').length, 2);
    panel.getElementById('mode').value = 'tab';
    panel.getElementById('mode').dispatchEvent(new views[1].window.Event('change'));
    panel.getElementById('open').click();
    await until(() => local[model.STORAGE_KEY].preferredMode === 'tab');
    const tab = await view('tab');
    assert.equal(tab.querySelectorAll('.group-card').length, 2);
    assert.equal(doc.querySelector('[data-condition-pick=view]'), null);
    const applyB = [...tab.querySelectorAll('#groups button')].filter(button => button.textContent === '???? ??')[1];
    applyB.click();
    await until(() => local[model.STORAGE_KEY].lastApplied.groupId === b.id);
    assert.equal(doc.getElementById('attr-cpu-7-1').getAttribute('aria-checked'), 'true');
    assert.equal(doc.getElementById('attr-gpu-5060-0').getAttribute('aria-checked'), 'false');
    assert.equal(local[model.STORAGE_KEY].lastApplied.searchComplete, false);
    assert.equal(product.innerHTML, productHtml);
    assert.equal(doc.getElementById('productListArea'), product);
  } finally {
    views.forEach(dom => dom.window.close());
    source.window.close();
  }
});
