import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
function setup(withAnchor = true) {
  const html = '<!doctype html><html><body><main id="DnwListContents"><section id="filters"><input type="checkbox" checked>?? ??</section>' +
    (withAnchor ? '<section id="productListArea"><a href="/info/?pcode=1">?? ??</a></section>' : '') + '</main></body></html>';
  const dom = new JSDOM(html, { url: 'https://prod.danawa.com/list/?cate=112758', runScripts: 'outside-only' });
  const listeners = [];
  const shadows = new WeakMap();
  const original = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) {
    const shadow = original.call(this, options);
    shadows.set(this, shadow);
    return shadow;
  };
  dom.window.chrome = {
    runtime: { id: 'test-id', getURL: path => 'chrome-extension://test-id/' + path,
      sendMessage: async () => ({ ok: true, state: { preferredMode: 'inline' } }),
      onMessage: { addListener: callback => listeners.push(callback) } },
    storage: { onChanged: { addListener() {} } }
  };
  dom.window.eval(source);
  const dispatch = (type, mode) => {
    let response;
    for (const listener of listeners) listener({ type, mode }, { id: 'test-id' }, value => { response = value; });
    return response;
  };
  return { dom, dispatch, shadows };
}
test('mount, change position, and close leave original options and products intact', () => {
  const { dom, dispatch, shadows } = setup();
  const doc = dom.window.document;
  const main = doc.getElementById('DnwListContents');
  const before = main.innerHTML;
  const filter = doc.querySelector('#filters input');
  assert.equal(dispatch('CP_MOUNT', 'inline').ok, true);
  const inline = doc.querySelector('[data-condition-pick="view"]');
  assert.equal(inline.nextElementSibling.id, 'productListArea');
  assert.match(shadows.get(inline).querySelector('iframe').src, /surface=inline/);
  assert.equal(dispatch('CP_MOUNT', 'panel').ok, true);
  assert.equal(doc.querySelectorAll('[data-condition-pick="view"]').length, 1);
  const panel = doc.querySelector('[data-condition-pick="view"]');
  assert.match(shadows.get(panel).querySelector('iframe').src, /surface=panel/);
  dispatch('CP_UNMOUNT');
  assert.equal(main.innerHTML, before);
  assert.equal(doc.querySelector('#filters input'), filter);
  assert.equal(filter.checked, true);
  assert.equal(doc.querySelector('[data-condition-pick="launcher"]').hidden, false);
  dom.window.close();
});
test('missing inline anchor retains current panel and offers fallback', () => {
  const { dom, dispatch, shadows } = setup(false);
  assert.equal(dispatch('CP_MOUNT', 'panel').ok, true);
  const panel = dom.window.document.querySelector('[data-condition-pick="view"]');
  assert.equal(dispatch('CP_MOUNT', 'inline').ok, false);
  assert.equal(panel.isConnected, true);
  const launcher = dom.window.document.querySelector('[data-condition-pick="launcher"]');
  assert.equal(shadows.get(launcher).getElementById('fallback').hidden, false);
  dom.window.close();
});
test('external removal exposes launcher and explicit fallback without touching source page', async () => {
  const { dom, dispatch, shadows } = setup();
  dispatch('CP_MOUNT', 'inline');
  dom.window.document.querySelector('[data-condition-pick="view"]').remove();
  await new Promise(resolve => setImmediate(resolve));
  const launcher = dom.window.document.querySelector('[data-condition-pick="launcher"]');
  assert.equal(launcher.hidden, false);
  assert.equal(shadows.get(launcher).getElementById('fallback').hidden, false);
  assert.ok(dom.window.document.getElementById('productListArea'));
  dom.window.close();
});
