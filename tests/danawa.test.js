import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const adapter = readFileSync(new URL('../extension/danawa.js', import.meta.url), 'utf8');
function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><main><div id="filters"><div><div><h2>????</h2></div></div><div id="rows"></div><div id="price"><div>???</div><div><input aria-label="?? ??" value="?"><input aria-label="?? ??" value="?"><button id="price-search">??</button></div></div><button id="all">?? ????</button></div><section id="productListArea"><label><input type="checkbox" id="vs" checked>VS????</label><a href="/info/?pcode=9">?? ??</a></section><label>?????<button type="button" role="switch" aria-checked="false" id="shipping">OFF</button></label></main></body></html>',
    { url: 'https://prod.danawa.com/list/?cate=112758', runScripts: 'outside-only' });
  const doc = dom.window.document;
  const values = new Map([['cpu-7', true], ['cpu-5', false], ['gpu-5060', false], ['gpu-integrated', true], ['ram-32', true], ['maker-msi', false], ['storage-1tb', false]]);
  let searches = 0;
  const groups = new Map();
  function option(id, label, image = false) {
    const row = doc.createElement('div');
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = 'attr-' + id + '-0';
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(values.get(id) || false));
    button.addEventListener('click', () => {
      values.set(id, !values.get(id));
      button.setAttribute('aria-checked', String(values.get(id)));
    });
    const text = doc.createElement('label');
    text.htmlFor = button.id;
    if (image) {
      const img = doc.createElement('img'); img.alt = label; text.append(img);
    } else text.textContent = label;
    row.append(button, text);
    return row;
  }
  function group(name, specs, hidden = []) {
    const block = doc.createElement('div');
    const row = doc.createElement('div'), heading = doc.createElement('div'), body = doc.createElement('div'), grid = doc.createElement('div');
    heading.textContent = name;
    specs.forEach(spec => grid.append(option(...spec)));
    body.append(grid); row.append(heading, body); block.append(row);
    if (hidden.length) {
      const more = doc.createElement('button');
      more.type = 'button';
      more.setAttribute('aria-label', '?? ?? ' + hidden.length + '? ???');
      more.textContent = hidden.length + '?';
      let expanded = false;
      more.addEventListener('click', () => {
        expanded = !expanded;
        more.setAttribute('aria-expanded', String(expanded));
        more.setAttribute('aria-label', expanded ? '?? ?? ??' : '?? ?? ' + hidden.length + '? ???');
        if (expanded) hidden.forEach(spec => grid.append(option(...spec)));
        else for (const [id] of hidden) grid.querySelector('[id="attr-' + id + '-0"]')?.parentElement.remove();
      });
      body.append(more);
    }
    doc.getElementById('rows').append(block);
    groups.set(name, block);
    return block;
  }
  group('????', [['maker-msi', 'MSI', true]]);
  group('CPU ??', [['cpu-7', '??i7']], [['cpu-5', '??i5']]);
  group('GPU ??', [['gpu-5060', 'RTX5060'], ['gpu-integrated', '?????']]);
  group('?', [['ram-32', 'CM ?? ??: 32GB']]);
  let advanced;
  doc.getElementById('all').addEventListener('click', () => {
    if (advanced?.isConnected) {
      advanced.remove(); doc.getElementById('all').textContent = '?? ????';
    } else {
      advanced = group('??', [['storage-1tb', '1TB']]);
      doc.getElementById('all').textContent = '?? ????';
    }
  });
  doc.getElementById('price-search').addEventListener('click', () => { searches++; });
  doc.getElementById('shipping').addEventListener('click', event => {
    const button = event.currentTarget;
    button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
  });
  dom.window.eval(adapter);
  return { dom, doc, api: dom.window.ConditionPickDanawa, values, groups, searches: () => searches };
}
function saved(options = [{ key: 'attr-cpu-5', group: 'CPU ??', label: '??i5' }, { key: 'attr-gpu-5060', group: 'GPU ??', label: 'RTX5060' }, { key: 'attr-ram-32', group: '?', label: '32GB' }]) {
  return { schema: 1, site: 'danawa', category: '112758',
    sourceUrl: 'https://prod.danawa.com/list/?cate=112758', capturedAt: '2026-11-10T11:00:00.000Z',
    options, price: { min: null, max: null }, includeShipping: false };
}
test('capture includes selected folded and advanced options, excludes product checkboxes and restores expansion', async () => {
  const f = fixture();
  f.values.set('cpu-5', true);
  f.values.set('storage-1tb', true);
  const snapshot = await f.api.capture();
  assert.equal(snapshot.options.length, 5);
  assert.ok(snapshot.options.some(option => option.label === '??i5'));
  assert.ok(snapshot.options.some(option => option.group === '??' && option.label === '1TB'));
  assert.ok(snapshot.options.some(option => option.label === '32GB'));
  assert.equal(snapshot.options.some(option => option.label === 'VS????'), false);
  assert.equal(f.doc.getElementById('all').textContent, '?? ????');
  assert.ok(f.groups.get('CPU ??').querySelector('[aria-label="?? ?? 1? ???"]'));
  assert.equal(f.searches(), 0);
  f.dom.window.close();
});
test('capture reads image labels and does not share mutable snapshots', async () => {
  const f = fixture();
  f.doc.getElementById('attr-maker-msi-0').click();
  const one = await f.api.capture();
  assert.ok(one.options.some(option => option.label === 'MSI'));
  f.doc.getElementById('attr-ram-32-0').click();
  const two = await f.api.capture();
  assert.ok(one.options.some(option => option.label === '32GB'));
  assert.equal(two.options.some(option => option.label === '32GB'), false);
  f.dom.window.close();
});
test('reapply clears old CPU/GPU, restores folded options and combines common price/shipping', async () => {
  const f = fixture();
  const target = saved();
  target.price = { min: 500000, max: 2000000 };
  const result = await f.api.apply(target, { budget: 1500000, includeShipping: true });
  assert.equal(f.values.get('cpu-7'), false);
  assert.equal(f.values.get('cpu-5'), true);
  assert.equal(f.values.get('gpu-integrated'), false);
  assert.equal(f.values.get('gpu-5060'), true);
  assert.equal(f.doc.getElementById('shipping').getAttribute('aria-checked'), 'true');
  assert.equal(result.price.min, 500000);
  assert.equal(result.price.max, 1500000);
  assert.equal(result.searchComplete, false);
  assert.equal(f.searches(), 1);
  assert.equal(f.doc.getElementById('vs').checked, true);
  f.dom.window.close();
});
test('missing option fails before changing existing selections', async () => {
  const f = fixture();
  const before = [...f.values];
  await assert.rejects(f.api.apply(saved([{ key: 'not-found', group: 'CPU ??', label: '?? CPU' }]),
    { budget: null, includeShipping: true }), /??? ?? ?????/);
  assert.deepEqual([...f.values], before);
  assert.equal(f.searches(), 0);
  f.dom.window.close();
});
test('labels within groups can resolve changed index/identifiers without picking a different field', async () => {
  const f = fixture();
  const target = saved([{ key: 'old-id', group: '?', label: '32GB' }]);
  await f.api.apply(target, { budget: null, includeShipping: false });
  assert.equal(f.values.get('ram-32'), true);
  assert.equal(f.values.get('cpu-7'), false);
  f.dom.window.close();
});
test('mid-application failure rolls selections back', async () => {
  const f = fixture();
  const button = f.doc.getElementById('attr-gpu-5060-0');
  const normal = button.click.bind(button);
  let fail = true;
  button.click = () => { if (fail) { fail = false; throw new Error('test click failure'); } normal(); };
  await assert.rejects(f.api.apply(saved(), { budget: null, includeShipping: true }), /?? ???? ??????/);
  assert.equal(f.values.get('cpu-7'), true);
  assert.equal(f.values.get('cpu-5'), false);
  assert.equal(f.values.get('gpu-integrated'), true);
  assert.equal(f.values.get('gpu-5060'), false);
  f.dom.window.close();
});
test('conflicting budget and concurrent operations are rejected without mixed selections', async () => {
  const f = fixture();
  const target = saved(); target.price.min = 2000000;
  await assert.rejects(f.api.apply(target, { budget: 1500000, includeShipping: true }), /?? ??/);
  const first = f.api.capture();
  await assert.rejects(f.api.capture(), /?? ?? ??/);
  await first;
  assert.equal(f.values.get('cpu-7'), true);
  f.dom.window.close();
});
test('unavailable price search fails before any filter changes', async () => {
  const f = fixture();
  const before = [...f.values];
  f.doc.getElementById('price-search').remove();
  await assert.rejects(f.api.apply(saved(), { budget: 1500000, includeShipping: true }), /?? ?? ??/);
  assert.deepEqual([...f.values], before);
  f.dom.window.close();
});
