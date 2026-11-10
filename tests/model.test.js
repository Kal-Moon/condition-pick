import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, readState, reduceState, safeProductUrl, isNotebookPage, normalizeSnapshot } from '../extension/model.js';
test('display changes preserve sample results, common conditions and group selection', () => {
  let state = reduceState(initialState(), { type: 'sample' });
  state = reduceState(state, { type: 'shipping', value: false });
  state = reduceState(state, { type: 'budget', value: 1500000 });
  state = reduceState(state, { type: 'group', id: 'A', value: false });
  const snapshot = structuredClone(state);
  for (const mode of ['panel', 'tab', 'inline']) {
    state = reduceState(state, { type: 'mode', value: mode });
    assert.deepEqual(state.results, snapshot.results);
    assert.deepEqual(state.common, snapshot.common);
    assert.deepEqual(state.groups, snapshot.groups);
  }
  assert.equal(snapshot.preferredMode, 'inline');
});
test('reloading serialized state keeps selected shipping and mode', () => {
  const saved = reduceState(reduceState(initialState(), { type: 'shipping', value: false }), { type: 'mode', value: 'panel' });
  const restored = readState(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.common.includeShipping, false);
  assert.equal(restored.preferredMode, 'panel');
});
test('invalid updates fail without mutating the saved state', () => {
  const state = initialState();
  for (const action of [{ type: 'budget', value: -1 }, { type: 'budget', value: 1.5 }, { type: 'mode', value: 'unknown' }, { type: 'group', id: 'missing', value: true }]) {
    assert.throws(() => reduceState(state, action));
  }
  assert.deepEqual(state, initialState());
});
test('only the intended source and original product links are accepted', () => {
  assert.ok(isNotebookPage('https://prod.danawa.com/list/?cate=112758'));
  assert.equal(isNotebookPage('https://evil.example/list/?cate=112758'), false);
  assert.ok(safeProductUrl('https://prod.danawa.com/info/?pcode=92104118'));
  for (const url of ['javascript:alert(1)', 'https://evil.example/info/?pcode=1', 'https://prod.danawa.com/info/?pcode=oops']) {
    assert.equal(safeProductUrl(url), null);
  }
});
const captured = () => ({
  schema: 1, site: 'danawa', category: '112758',
  sourceUrl: 'https://prod.danawa.com/list/?cate=112758', capturedAt: '2026-11-10T11:00:00.000Z',
  options: [{ key: 'cpu-5', group: 'CPU ??', label: '??i5' }],
  price: { min: null, max: 1500000 }, includeShipping: true
});
test('captured combinations are independent snapshots and updates affect only the named combination', () => {
  const source = captured();
  let state = reduceState(initialState(), { type: 'sample' });
  state = reduceState(state, { type: 'capture', name: '???', snapshot: source });
  const id = state.groups[0].id;
  source.options[0].label = '?? ?? ??? ??';
  state = reduceState(state, { type: 'capture', name: '???', snapshot: captured() });
  assert.equal(state.groups.length, 2);
  assert.equal(state.groups[0].snapshot.options[0].label, '??i5');
  assert.equal(state.results.length, 0);
  assert.equal(state.status, 'not-connected');
  state = reduceState(state, { type: 'capture', id, name: '??? ???', snapshot: captured() });
  assert.equal(state.groups.length, 2);
  assert.equal(state.groups[0].name, '??? ???');
  assert.equal(state.groups[1].name, '???');
});
test('rename and removal keep other captured combinations and common settings intact', () => {
  let state = reduceState(initialState(), { type: 'capture', snapshot: captured() });
  const first = state.groups[0].id;
  state = reduceState(state, { type: 'capture', snapshot: captured() });
  const second = state.groups[1].id;
  state = reduceState(state, { type: 'rename', id: first, value: 'A' });
  state = reduceState(state, { type: 'remove', id: first });
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].id, second);
  assert.equal(state.common.includeShipping, true);
});
test('malformed, duplicate, and oversized captured conditions are rejected', () => {
  const duplicate = captured(); duplicate.options.push({ ...duplicate.options[0] });
  assert.throws(() => normalizeSnapshot(duplicate), /??/);
  const wrong = captured(); wrong.sourceUrl = 'https://evil.example';
  assert.throws(() => normalizeSnapshot(wrong));
  const badPrice = captured(); badPrice.price.max = -1;
  assert.throws(() => normalizeSnapshot(badPrice));
  const missing = captured(); delete missing.options[0].group;
  assert.throws(() => normalizeSnapshot(missing));
  const tooMany = captured(); tooMany.options = Array.from({ length: 257 }, (_, i) => ({ key: 'k' + i, group: 'g', label: String(i) }));
  assert.throws(() => normalizeSnapshot(tooMany));
});
