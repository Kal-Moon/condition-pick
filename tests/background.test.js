import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, initialState } from '../extension/model.js';

function environment() {
  const local = { [STORAGE_KEY]: initialState() }, session = {}, handlers = [], opened = [], sent = [];
  const tabs = new Map([[1, { id: 1, url: 'https://prod.danawa.com/list/?cate=112758', active: true }]]);
  let nextId = 10;
  const storage = values => ({
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(data) { Object.assign(values, structuredClone(data)); }
  });
  const env = { local, session, tabs, opened, sent, failMount: false, failCapture: false,
    snapshot: { schema: 1, site: 'danawa', category: '112758',
      sourceUrl: 'https://prod.danawa.com/list/?cate=112758', capturedAt: '2026-11-10T11:00:00.000Z',
      options: [{ key: 'cpu-5', label: '??i5', group: 'CPU ??' }],
      price: { min: null, max: null }, includeShipping: false } };
  env.api = {
    runtime: { id: 'test-id', getURL: path => 'chrome-extension://test-id/' + path,
      onMessage: { addListener: callback => handlers.push(callback) },
      onInstalled: { addListener() {} } },
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw new Error('Tab closed'); return tabs.get(id); },
      async query() { return [...tabs.values()].filter(tab => tab.active); },
      async create(properties) {
        const tab = { id: nextId++, ...properties };
        tabs.set(tab.id, tab); opened.push(tab); return tab;
      },
      async update(id, properties) { Object.assign(tabs.get(id), properties); return tabs.get(id); },
      async remove(id) { tabs.delete(id); },
      async sendMessage(id, message) {
        sent.push({ id, message });
        if (message.type === 'CP_CAPTURE_OPTIONS') return env.failCapture
          ? { ok: false, error: 'Cannot read filter options' } : { ok: true, snapshot: structuredClone(env.snapshot) };
        if (message.type === 'CP_APPLY_OPTIONS') return {
          ok: true, applied: { appliedAt: '2026-11-10T11:10:00.000Z', searchComplete: false,
            options: message.snapshot.options, price: message.snapshot.price, includeShipping: message.common.includeShipping }
        };
        return env.failMount && message.type === 'CP_MOUNT' ? { ok: false, error: 'Missing result anchor' } : { ok: true };
      }
    }
  };
  env.call = (message, sender = { id: 'test-id', url: 'https://prod.danawa.com/list/?cate=112758', tab: tabs.get(1) }) =>
    new Promise(resolve => {
      const active = handlers.at(-1)(message, sender, resolve);
      if (!active) resolve(null);
    });
  return env;
}
let counter = 0;
async function start() {
  const env = environment();
  globalThis.chrome = env.api;
  await import('../extension/background.js?test=' + ++counter);
  return env;
}
test('search uses an inactive owned tab, rejects source-tab progress and closes only its worker on stop', async () => {
  const env = await start();
  await env.call({ type:'CP_CAPTURE', name:'A' });
  const original = structuredClone(env.tabs.get(1));
  const started = await env.call({type:'CP_SEARCH'});
  assert.equal(started.ok,true);
  const search=started.state.search;
  const tab=env.tabs.get(search.workerTabId);
  assert.equal(tab.active,false);assert.match(tab.url,/#condition-pick-worker=/);
  assert.deepEqual(env.tabs.get(1),original);
  assert.equal((await env.call({type:'CP_SEARCH'})).ok,false);
  assert.equal((await env.call({type:'CP_SEARCH_PROGRESS',id:search.id,event:{}})).ok,false);
  const sender={id:'test-id',url:tab.url,tab};
  const ready=await env.call({type:'CP_WORKER_READY',id:search.id},sender);
  assert.equal(ready.ok,true);assert.equal(ready.plan.groups.length,1);
  const groupId=ready.plan.groups[0].id;
  await env.call({type:'CP_SEARCH_PROGRESS',id:search.id,event:{kind:'group-start',groupId}},sender);
  await env.call({type:'CP_SEARCH_PROGRESS',id:search.id,event:{kind:'page',groupId,page:1,hasNext:true,products:[]}},sender);
  const stopped=await env.call({type:'CP_STOP_SEARCH'});
  assert.equal(stopped.state.search.phase,'stopped');assert.equal(stopped.state.search.searchComplete,false);
  assert.equal(env.tabs.has(tab.id),false);assert.equal(env.tabs.has(1),true);
  assert.equal((await env.call({type:'CP_SEARCH_FINISH',id:search.id},sender)).ok,false);
});
test('worker reload and missing worker recovery retain partial status instead of resuming mixed results',async()=>{
  const env=await start();await env.call({type:'CP_CAPTURE'});
  let response=await env.call({type:'CP_SEARCH'});let search=response.state.search;
  let tab=env.tabs.get(search.workerTabId);let sender={id:'test-id',url:tab.url,tab};
  assert.equal((await env.call({type:'CP_WORKER_READY',id:search.id},sender)).ok,true);
  assert.equal((await env.call({type:'CP_WORKER_READY',id:search.id},sender)).ok,false);
  assert.equal(env.local[STORAGE_KEY].search.phase,'partial');
  response=await env.call({type:'CP_SEARCH'}); search=response.state.search;
  env.tabs.delete(search.workerTabId);
  env.local[STORAGE_KEY].search.updatedAt='2026-01-01T00:00:00.000Z';
  const recovered=await env.call({type:'CP_GET'});
  assert.equal(recovered.state.search.phase,'partial');assert.equal(recovered.state.search.searchComplete,false);
});
test('failed display and explicit tab fallback preserve preferred mode and results', async () => {
  const env = await start();
  await env.call({ type: 'CP_UPDATE', action: { type: 'sample' } });
  env.failMount = true;
  const response = await env.call({ type: 'CP_OPEN', mode: 'inline', persist: true });
  assert.equal(response.fallback, true);
  assert.equal(env.opened.length, 0);
  const result = await env.call({ type: 'CP_OPEN', mode: 'tab', persist: false });
  assert.equal(result.ok, true);
  assert.equal(env.local[STORAGE_KEY].preferredMode, 'inline');
  assert.equal(env.local[STORAGE_KEY].results.length, 2);
  assert.equal(env.opened.length, 1);
});
test('concurrent setting changes serialize instead of overwriting each other', async () => {
  const env = await start();
  await Promise.all([
    env.call({ type: 'CP_UPDATE', action: { type: 'shipping', value: false } }),
    env.call({ type: 'CP_UPDATE', action: { type: 'budget', value: 1500000 } }),
    env.call({ type: 'CP_UPDATE', action: { type: 'group', id: 'A', value: false } })
  ]);
  const saved = env.local[STORAGE_KEY];
  assert.equal(saved.common.includeShipping, false);
  assert.equal(saved.common.budget, 1500000);
  assert.equal(saved.groups[0].selected, false);
});
test('tab view is reused and explicit mode selection persists', async () => {
  const env = await start();
  await env.call({ type: 'CP_OPEN', mode: 'tab', persist: true });
  await env.call({ type: 'CP_OPEN', mode: 'tab', persist: true });
  assert.equal(env.opened.length, 1);
  assert.equal(env.local[STORAGE_KEY].preferredMode, 'tab');
  assert.ok(env.sent.some(entry => entry.message.type === 'CP_UNMOUNT'));
});
test('unknown senders cannot read state or open extension views', async () => {
  const env = await start();
  const response = await env.call({ type: 'CP_GET' }, { id: 'other-id', url: 'https://evil.example' });
  assert.equal(response.ok, false);
  assert.equal(response.state, undefined);
  assert.equal(env.opened.length, 0);
});
test('capturing a source tab stores an immutable real combination and applying passes common conditions', async () => {
  const env = await start();
  const captured = await env.call({ type: 'CP_CAPTURE', name: '? ??? ??' });
  assert.equal(captured.ok, true);
  const group = captured.state.groups[0];
  assert.equal(group.name, '? ??? ??');
  env.snapshot.options[0].label = '?? ??? ??? ??';
  assert.equal(env.local[STORAGE_KEY].groups[0].snapshot.options[0].label, '??i5');
  await env.call({ type: 'CP_UPDATE', action: { type: 'budget', value: 1400000 } });
  const applied = await env.call({ type: 'CP_APPLY', id: group.id });
  assert.equal(applied.ok, true);
  const sent = env.sent.find(entry => entry.message.type === 'CP_APPLY_OPTIONS');
  assert.equal(sent.message.common.budget, 1400000);
  assert.equal(sent.message.common.includeShipping, true);
  assert.equal(applied.state.lastApplied.searchComplete, false);
  assert.equal(applied.state.lastApplied.name, '? ??? ??');
});
test('embedded view keeps its owning source tab when another tab is active', async () => {
  const env = await start();
  env.tabs.get(1).active = false;
  env.tabs.set(2, { id: 2, url: 'https://example.com', active: true });
  const sender = { id: 'test-id', url: 'chrome-extension://test-id/view.html?surface=inline', tab: env.tabs.get(1) };
  const result = await env.call({ type: 'CP_CAPTURE', name: '?? ? ??' }, sender);
  assert.equal(result.ok, true);
  assert.equal(env.sent.find(entry => entry.message.type === 'CP_CAPTURE_OPTIONS').id, 1);
});
test('capture failure does not store a fabricated or incomplete combination', async () => {
  const env = await start();
  const before = structuredClone(env.local[STORAGE_KEY]);
  env.failCapture = true;
  const response = await env.call({ type: 'CP_CAPTURE' });
  assert.equal(response.ok, false);
  assert.deepEqual(env.local[STORAGE_KEY], before);
});
test('settings messages cannot bypass the source capture workflow', async () => {
  const env = await start();
  const response = await env.call({ type: 'CP_UPDATE', action: { type: 'capture', snapshot: env.snapshot } });
  assert.equal(response.ok, false);
  assert.equal(env.local[STORAGE_KEY].groups.some(group => group.snapshot), false);
});
