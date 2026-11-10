import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceState } from '../extension/model.js';
import { searchIsStale } from '../extension/search-model.js';
const at = '2026-11-10T12:00:00.000Z';
function snapshot(options = []) {
  return { schema: 1, site: 'danawa', category: '112758', sourceUrl: 'https://prod.danawa.com/list/?cate=112758',
    capturedAt: at, options, price: { min: null, max: null }, includeShipping: true };
}
function product(id, configuration = 'SSD 512GB', price = 1000000) {
  return { id: String(id), sourceUrl: 'https://prod.danawa.com/info/?pcode=' + id,
    name: '?? ?? ? ' + configuration, specification: 'i7 / 32GB / ???11', configuration,
    displayedPrice: price, capturedAt: at };
}
function start(options = []) {
  let state = reduceState(initialState(), { type: 'capture', name: 'A', snapshot: snapshot(options) });
  state = reduceState(state, { type: 'capture', name: 'B', snapshot: snapshot() });
  return reduceState(state, { type: 'search-start', id: 'search-1', at });
}
const act = (state, type, extra = {}) => reduceState(state, { type: 'search-' + type, id: 'search-1', at, ...extra });
const emit = (state, groupId, kind, extra = {}) => act(state, 'progress', { event: { groupId, kind, ...extra } });
test('two groups union exact product IDs, keep storage variants separate and retain per-group price evidence', () => {
  let state = start();
  const [a,b] = state.groups.map(group => group.id);
  state = emit(state,a,'group-start');
  state = emit(state,a,'page',{ page:1, hasNext:true, products:[product(1),product(2,'SSD 1TB')] });
  assert.equal(state.search.searchComplete,false);
  assert.throws(()=>emit(state,a,'group-complete'),/???/);
  state = emit(state,a,'page',{ page:2, hasNext:false, products:[product(3)] });
  state = emit(state,a,'group-complete');
  state = emit(state,b,'group-start');
  state = emit(state,b,'page',{ page:1, hasNext:false, products:[product(1,'SSD 512GB',900000)] });
  state = emit(state,b,'group-complete');
  state = act(state,'finish');
  assert.equal(state.search.phase,'complete');
  assert.equal(state.search.searchComplete,true);
  assert.equal(state.results.length,3);
  assert.deepEqual(state.results[0].matchedGroups,[a,b]);
  assert.deepEqual(state.results[0].observations.map(item=>item.price),[1000000,900000]);
  assert.equal(state.results[1].configuration,'SSD 1TB');
});
test('exact storage and ranges are checked per sale variant, missing details stay pending, budget excludes over-limit variants', () => {
  let state = start([{key:'ssd',group:'??',label:'512GB'}]);
  state = reduceState(state, {type:'budget',value:1100000});
  // Editing common conditions after start must not change this search's frozen budget.
  assert.equal(state.search.common.budget,null);
  assert.equal(searchIsStale(state),true);
  const a=state.groups[0].id;
  state=emit(state,a,'group-start');
  state=emit(state,a,'page',{page:1,hasNext:false,products:[product(1),product(2,'SSD 1TB'),product(3,'?? ??'),product(4,'SSD 512GB',null)]});
  assert.deepEqual(state.results.map(item=>item.id),['1','3','4']);
  assert.deepEqual(state.results[1].matchedGroups,[]);
  assert.deepEqual(state.results[1].pendingGroups,[a]);
  assert.deepEqual(state.results[2].pendingGroups,[a]);
  let range=start([{key:'range',group:'?? ???',label:'1TB~513GB'}]);
  range=emit(range,range.groups[0].id,'group-start');
  range=emit(range,range.groups[0].id,'page',{page:1,hasNext:false,products:[product(1),product(2,'SSD 1TB'),product(3,'SSD 2TB')]});
  assert.deepEqual(range.results.map(item=>item.id),['2']);
  let limited=reduceState(initialState(),{type:'budget',value:1000000});
  limited=reduceState(limited,{type:'capture',snapshot:snapshot()});
  limited=reduceState(limited,{type:'search-start',id:'search-1',at});
  limited=emit(limited,limited.groups[0].id,'group-start');
  limited=emit(limited,limited.groups[0].id,'page',{page:1,hasNext:false,products:[product(1),product(2,'SSD 1TB',1000001)]});
  assert.deepEqual(limited.results.map(item=>item.id),['1']);
});
test('cancelled and failed searches keep partial results and never claim full completion', () => {
  let state=start(); const a=state.groups[0].id;
  state=emit(state,a,'group-start');
  state=emit(state,a,'page',{page:1,hasNext:true,products:[product(1)]});
  assert.throws(()=>emit(state,a,'page',{page:3,hasNext:false,products:[]}),/??/);
  const partial=act(state,'finish',{error:'??? 2 ??'});
  assert.equal(partial.search.phase,'partial'); assert.equal(partial.results.length,1);
  assert.equal(partial.search.searchComplete,false);
  assert.throws(()=>emit(partial,a,'page',{page:2,hasNext:false,products:[]}),/??/);
  state=act(state,'stopping'); state=act(state,'finish');
  assert.equal(state.search.phase,'stopped'); assert.equal(state.results.length,1);
  assert.equal(state.search.searchComplete,false);
});
test('search selection, stale status and ingestion reject forged, duplicate and old-run data', () => {
  assert.throws(()=>reduceState(initialState(),{type:'search-start',id:'x',at}),/??/);
  let state=start(); const a=state.groups[0].id;
  assert.equal(searchIsStale(state),false);
  assert.throws(()=>reduceState(state,{type:'search-start',id:'other',at}),/??/);
  assert.throws(()=>reduceState(state,{type:'search-progress',id:'old',event:{}}),/??/);
  state=emit(state,a,'group-start');
  assert.throws(()=>emit(state,a,'page',{page:1,hasNext:false,products:[{...product(1),sourceUrl:'https://evil.example/info/?pcode=1'}]}),/??|??/);
  assert.equal(state.results.length,0);
  state=emit(state,a,'page',{page:1,hasNext:false,products:[product(1),product(1)]});
  assert.equal(state.results.length,1); assert.equal(state.search.progress[0].count,1);
  state=reduceState(state,{type:'group',id:a,value:false});
  assert.equal(searchIsStale(state),true);
});
