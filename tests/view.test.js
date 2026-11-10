import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as model from '../extension/model.js';
const html = readFileSync(new URL('../extension/view.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../extension/view.js', import.meta.url), 'utf8').replace(/^import[^;]+;/, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(surface, shared) {
  const dom = new JSDOM(html, { url: 'https://extension.test/view.html?surface=' + surface, runScripts: 'outside-only' });
  const listeners = [];
  Object.assign(dom.window, { STORAGE_KEY: model.STORAGE_KEY, readState: model.readState, safeProductUrl: model.safeProductUrl });
  dom.window.chrome = {
    storage: { onChanged: { addListener: callback => listeners.push(callback) } },
    runtime: { async sendMessage(message) {
      if (message.type === 'CP_GET') return { ok: true, state: structuredClone(shared.state), sourceTabId: 1 };
      if (message.type === 'CP_UPDATE') {
        shared.state = model.reduceState(shared.state, message.action);
        return { ok: true, state: structuredClone(shared.state) };
      }
      if (message.type === 'CP_OPEN') return shared.fail ? { ok: true, fallback: true, error: '표시 실패 예시' } : { ok: true };
      return { ok: true };
    } }
  };
  dom.window.eval(source);
  await tick();
  return { dom, doc: dom.window.document, listeners };
}
test('all three view surfaces load the same conditions and original product links', async () => {
  let state = model.reduceState(model.initialState(), { type: 'sample' });
  state = model.reduceState(state, { type: 'shipping', value: false });
  state = model.reduceState(state, { type: 'budget', value: 1500000 });
  const shared = { state };
  for (const surface of ['inline', 'panel', 'tab']) {
    const { dom, doc } = await setup(surface, shared);
    assert.equal(doc.getElementById('shipping').checked, false);
    assert.equal(doc.getElementById('budget').value, '1500000');
    const links = doc.querySelectorAll('#results a');
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
    assert.equal(links[0].getAttribute('href'), state.results[0].sourceUrl);
    assert.match(doc.getElementById('results').textContent, /예산 충족 여부 미판정/);
    dom.window.close();
  }
});
test('a storage notification updates another surface without performing a search', async () => {
  const shared = { state: model.initialState() };
  const first = await setup('inline', shared);
  const second = await setup('tab', shared);
  first.doc.getElementById('shipping').checked = false;
  first.doc.getElementById('shipping').dispatchEvent(new first.dom.window.Event('change'));
  await tick();
  second.listeners[0]({ [model.STORAGE_KEY]: { newValue: shared.state } }, 'local');
  assert.equal(second.doc.getElementById('shipping').checked, false);
  assert.match(second.doc.getElementById('price-basis').textContent, /상품 가격만/);
  first.dom.window.close(); second.dom.window.close();
});
test('failed placement exposes an explicit fallback, and unsafe links are omitted', async () => {
  const state = model.reduceState(model.initialState(), { type: 'sample' });
  state.results[0].name = '<img src=x onerror=alert(1)>';
  state.results[0].sourceUrl = 'javascript:alert(1)';
  const { dom, doc } = await setup('tab', { state, fail: true });
  assert.equal(doc.querySelectorAll('#results a').length, 1);
  assert.equal(doc.querySelectorAll('#results img').length, 0);
  assert.ok(doc.getElementById('results').textContent.includes('<img'));
  doc.getElementById('open').click();
  await tick();
  assert.equal(doc.getElementById('fallback').hidden, false);
  assert.match(doc.getElementById('notice').textContent, /표시 실패/);
  dom.window.close();
});
