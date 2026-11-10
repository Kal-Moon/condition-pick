import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, readState, reduceState, safeProductUrl, isNotebookPage } from '../extension/model.js';
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
