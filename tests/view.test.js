import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as model from '../extension/model.js';
import { searchIsStale } from '../extension/search-model.js';
const html = readFileSync(new URL('../extension/view.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../extension/view.js', import.meta.url), 'utf8').replace(/^import[^;]+;/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const siteSnapshot = () => ({
  schema: 1, site: 'danawa', category: '112758',
  sourceUrl: 'https://prod.danawa.com/list/?cate=112758', capturedAt: '2026-11-10T11:00:00.000Z',
  options: [{ key: 'cpu-5', group: 'CPU ??', label: '??i5' }],
  price: { min: null, max: null }, includeShipping: true
});
async function setup(surface, shared) {
  const dom = new JSDOM(html, { url: 'https://extension.test/view.html?surface=' + surface, runScripts: 'outside-only' });
  const listeners = [];
  Object.assign(dom.window, { STORAGE_KEY: model.STORAGE_KEY, readState: model.readState, safeProductUrl: model.safeProductUrl, searchIsStale });
  dom.window.chrome = {
    storage: { onChanged: { addListener: callback => listeners.push(callback) } },
    runtime: { async sendMessage(message) {
      if (message.type === 'CP_GET') return { ok: true, state: structuredClone(shared.state), sourceTabId: 1 };
      if (message.type === 'CP_UPDATE') {
        shared.state = model.reduceState(shared.state, message.action);
        return { ok: true, state: structuredClone(shared.state) };
      }
      if (message.type === 'CP_CAPTURE') {
        shared.state = model.reduceState(shared.state, { type: 'capture', id: message.id,
          name: message.name, snapshot: shared.snapshot || siteSnapshot() });
        return { ok: true, state: structuredClone(shared.state) };
      }
      if (message.type === 'CP_APPLY') {
        const group = shared.state.groups.find(group => group.id === message.id);
        shared.state = model.reduceState(shared.state, { type: 'applied',
          groupId: group.id, name: group.name, at: '2026-11-10T11:10:00.000Z',
          snapshot: group.snapshot, common: shared.state.common });
        return { ok: true, state: structuredClone(shared.state), applied: { searchComplete: false } };
      }
      if (message.type === 'CP_OPEN') return shared.fail ? { ok: true, fallback: true, error: '?? ?? ??' } : { ok: true };
      if (message.type === 'CP_SEARCH') {
        shared.state = model.reduceState(shared.state, {type:'search-start',id:'ui-search',at:'2026-11-10T12:00:00.000Z'});
        return {ok:true,state:structuredClone(shared.state)};
      }
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
    assert.match(doc.getElementById('results').textContent, /?? ?? ?? ???/);
    dom.window.close();
  }
});
test('search controls preserve frozen criteria, compare individual groups and union results, and mark changed conditions stale',async()=>{
  const shared={state:model.reduceState(model.initialState(),{type:'capture',name:'A',snapshot:siteSnapshot()})};
  shared.state=model.reduceState(shared.state,{type:'capture',name:'B',snapshot:siteSnapshot()});
  const {dom,doc,listeners}=await setup('panel',shared);
  try {
    doc.getElementById('search').click();await tick();
    assert.equal(shared.state.search.id,'ui-search');
    assert.equal(doc.getElementById('stop-search').hidden,false);
    const [a,b]=shared.state.groups.map(group=>group.id);
    const progress=(groupId,kind,extra={})=>{
      shared.state=model.reduceState(shared.state,{type:'search-progress',id:'ui-search',at:'2026-11-10T12:00:00.000Z',event:{groupId,kind,...extra}});
    };
    const product=id=>({id,sourceUrl:'https://prod.danawa.com/info/?pcode='+id,name:'?? '+id,specification:'32GB',configuration:'SSD 512GB',displayedPrice:1000000,capturedAt:'2026-11-10T12:00:00.000Z'});
    progress(a,'group-start');progress(a,'page',{page:1,hasNext:false,products:[product('1')]});progress(a,'group-complete');
    progress(b,'group-start');progress(b,'page',{page:1,hasNext:false,products:[product('1'),product('2')]});progress(b,'group-complete');
    shared.state=model.reduceState(shared.state,{type:'search-finish',id:'ui-search',at:'2026-11-10T12:00:01.000Z'});
    listeners[0]({[model.STORAGE_KEY]:{newValue:shared.state}},'local');
    assert.equal(doc.querySelectorAll('#results .product').length,2);
    assert.match(doc.getElementById('results').textContent,/?? ??: A, B/);
    assert.match(doc.getElementById('search-status').textContent,/?? ??/);
    doc.getElementById('result-group').value=a;
    doc.getElementById('result-group').dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelectorAll('#results .product').length,1);
    shared.state=model.reduceState(shared.state,{type:'shipping',value:false});
    listeners[0]({[model.STORAGE_KEY]:{newValue:shared.state}},'local');
    assert.equal(doc.getElementById('search-stale').hidden,false);
    assert.match(doc.getElementById('result-basis').textContent,/??? ??/);
    assert.match(doc.getElementById('price-basis').textContent,/??? ??/);
  }finally{dom.window.close();}
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
  assert.match(second.doc.getElementById('price-basis').textContent, /??? ??/);
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
  assert.match(doc.getElementById('notice').textContent, /?? ??/);
  dom.window.close();
});
test('editing shipping does not reset a display location chosen before applying it', async () => {
  const { dom, doc } = await setup('inline', { state: model.initialState() });
  doc.getElementById('mode').value = 'panel';
  doc.getElementById('mode').dispatchEvent(new dom.window.Event('change'));
  doc.getElementById('shipping').checked = false;
  doc.getElementById('shipping').dispatchEvent(new dom.window.Event('change'));
  await tick();
  assert.equal(doc.getElementById('mode').value, 'panel');
  dom.window.close();
});
test('capture UI creates real named groups, apply records incomplete search, and overwrite is explicit', async () => {
  const shared = { state: model.initialState() };
  const { dom, doc } = await setup('inline', shared);
  doc.getElementById('capture-name').value = '??? A';
  doc.getElementById('capture').click();
  await tick();
  assert.equal(shared.state.groups.length, 1);
  assert.equal(shared.state.groups[0].name, '??? A');
  assert.ok(shared.state.groups[0].snapshot);
  assert.equal(doc.getElementById('sample').hidden, true);
  const apply = [...doc.querySelectorAll('#groups button')].find(button => button.textContent === '???? ??');
  apply.click();
  await tick();
  assert.equal(doc.getElementById('applied-section').hidden, false);
  assert.match(doc.getElementById('notice').textContent, /?? ?? ?? ??? ????/);
  const originalId = shared.state.groups[0].id;
  shared.snapshot = siteSnapshot();
  shared.snapshot.options[0].label = '??i7';
  assert.equal(shared.state.groups[0].snapshot.options[0].label, '??i5');
  [...doc.querySelectorAll('#groups button')].find(button => button.textContent === '?? ???? ??').click();
  await tick();
  assert.equal(shared.state.groups.length, 1);
  assert.equal(shared.state.groups[0].id, originalId);
  assert.equal(shared.state.groups[0].snapshot.options[0].label, '??i7');
  assert.match(doc.getElementById('applied').textContent, /?? ??/);
  dom.window.close();
});
