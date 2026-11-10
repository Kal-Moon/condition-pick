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
  const env = { local, session, tabs, opened, sent, failMount: false };
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
      async sendMessage(id, message) {
        sent.push({ id, message });
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
