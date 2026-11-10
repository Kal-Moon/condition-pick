import { STORAGE_KEY, readState, safeProductUrl } from './model.js';
import { searchIsStale } from './search-model.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const surface = params.get('surface') || 'popup';
const labels = { inline: '??? ??? ?', panel: '??? ??', tab: '??? ?? ?', popup: '?? ??? ??? ?? ???.' };
$('surface-label').textContent = labels[surface] || labels.popup;
let sourceTabId = params.has('source') ? Number(params.get('source')) : null;
let busy = false;
let lastRevision = -1;
let modeDraft = null;
let renderedState = null;
async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, sourceTabId });
  if (!response?.ok) throw new Error(response?.error || '??? ??? ???? ?????.');
  return response;
}
function notice(message, fallback = false) {
  $('notice').textContent = message;
  $('fallback').hidden = !fallback;
}
function setBusy(value) {
  busy = value;
  $('open').disabled = value;
  $('capture').disabled = value || sourceTabId === null;
  document.querySelectorAll('[data-page-operation]').forEach(button => {
    button.disabled = value || sourceTabId === null;
  });
  $('search').disabled = value || ['running', 'stopping'].includes(renderedState?.search?.phase) ||
    !renderedState?.groups.some(group => group.selected && group.snapshot);
}
function render(value) {
  const state = readState(value);
  if (state.revision < lastRevision) return;
  renderedState = state;
  lastRevision = state.revision;
  $('mode').value = modeDraft ?? state.preferredMode;
  $('shipping').checked = state.common.includeShipping;
  if (document.activeElement !== $('budget')) $('budget').value = state.common.budget ?? '';
  $('price-basis').textContent = state.common.includeShipping
    ? '?? ??: ??? ??? ?? ?? ??'
    : '?? ??: ??? ??? ?? ?? ??';
  const groups = state.groups.map(group => {
    const card = document.createElement('article');
    card.className = 'group-card';
    const label = document.createElement('label');
    label.className = 'check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.selected;
    checkbox.addEventListener('change', () => update({ type: 'group', id: group.id, value: checkbox.checked }));
    const text = document.createElement('span');
    text.append(document.createTextNode(group.name + (group.snapshot ? '' : ' ? ?? ??')));
    const detail = document.createElement('span');
    detail.className = 'group-detail';
    detail.textContent = group.description;
    text.append(detail);
    label.append(checkbox, text);
    card.append(label);
    if (group.snapshot) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '??? ?? ' + group.snapshot.options.length + '? ??';
      const paragraph = document.createElement('p');
      paragraph.textContent = group.description;
      details.append(summary, paragraph);
      // Keep the compact line above short; the complete condition remains expandable.
      detail.textContent = group.snapshot.options.length + '? ?? ? ??? ?? ?? + ?? ?????? ??';
      const controls = document.createElement('div');
      controls.className = 'row';
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.value = group.name;
      name.setAttribute('aria-label', group.name + ' ??');
      name.addEventListener('change', () => update({ type: 'rename', id: group.id, value: name.value }));
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = '???? ??';
      apply.dataset.pageOperation = '';
      apply.disabled = busy || sourceTabId === null;
      apply.addEventListener('click', () => applyGroup(group.id));
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.textContent = '?? ???? ??';
      replace.dataset.pageOperation = '';
      replace.disabled = busy || sourceTabId === null;
      replace.addEventListener('click', () => captureGroup(group.id, group.name));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '??';
      remove.addEventListener('click', () => update({ type: 'remove', id: group.id }));
      controls.append(name, apply, replace, remove);
      card.append(details, controls);
    }
    return card;
  });
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.textContent = '????? ??? ?? ? ??? ?? ???? ?? ???.';
    groups.push(empty);
  }
  $('groups').replaceChildren(...groups);
  $('sample').hidden = state.groups.some(group => group.snapshot);
  $('capture').disabled = busy || sourceTabId === null;
  $('applied-section').hidden = !state.lastApplied;
  if (state.lastApplied) {
    const old = state.lastApplied;
    const group = state.groups.find(group => group.id === old.groupId);
    const stale = JSON.stringify(old.common) !== JSON.stringify(state.common) ||
      !group || JSON.stringify(old.snapshot) !== JSON.stringify(group.snapshot);
    $('applied').textContent = old.name + ' ? ' + new Date(old.at).toLocaleString('ko-KR') +
      (stale ? ' ? ??? ???? ?? ???? ???.' : ' ? ?? ???. ?? ?? ??? ????? ??? ???.');
  }
  const search = state.search;
  const running = ['running', 'stopping'].includes(search?.phase);
  $('search').disabled = busy || running || !state.groups.some(group => group.selected && group.snapshot);
  $('stop-search').hidden = !running;
  $('search-stale').hidden = !searchIsStale(state);
  const phaseLabels = { running: '?? ?', stopping: '?? ?', complete: '?? ??? ?? ??', partial: '?? ?? ? ?? ??', stopped: '??? ? ?? ??' };
  $('search-status').textContent = search ? (phaseLabels[search.phase] || '?? ??') +
    ' ? ' + new Date(search.startedAt).toLocaleString('ko-KR') +
    (search.errors.length ? ' ? ' + search.errors.join(' / ') : '') : '?? ???? ?????.';
  const progressRows = (search?.progress || []).map(group => {
    const row = document.createElement('p');
    const labels = { waiting: '??', running: '?? ?', complete: '??? ??? ??', partial: '??', stopped: '??' };
    row.textContent = group.name + ' ? ' + group.pages + '??? ?? ? ' + group.count + '? ?? ? ' + (labels[group.phase] || group.phase);
    return row;
  });
  $('search-progress').replaceChildren(...progressRows);
  const previousFilter = $('result-group').value;
  const choices = [['all', '??? ?? ??'], ...(search?.groups || state.groups).map(group => [group.id, group.name + ' ??'])];
  $('result-group').replaceChildren(...choices.map(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
  }));
  $('result-group').value = choices.some(([value]) => value === previousFilter) ? previousFilter : 'all';
  const filter = $('result-group').value;
  const selected = filter === 'all' ? new Set(state.groups.filter(group => group.selected).map(group => group.id)) : new Set([filter]);
  const rows = state.results.filter(product => [...product.matchedGroups, ...(product.pendingGroups || [])].some(id => selected.has(id)));
  function observation(product) {
    return (product.observations || []).filter(item => selected.has(item.groupId))
      .sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  }
  if ($('result-sort').value === 'price') rows.sort((a,b) => (observation(a)?.price ?? Infinity) - (observation(b)?.price ?? Infinity));
  $('result-basis').textContent = search ? '?? ?? ??: ' +
    (search.common.includeShipping ? '??? ??' : '??? ??') +
    ' ? ??? ?? ???? ?????. ??? ?? ????? ? ?? ??? ???? ??? ???. ?? ?? ??? ??? ??? ?? ??? ?? ?????.' :
    '??? ?? ???? ??? ??? ????.';
  $('result-count').textContent = rows.length + '? ?? ?? ? ????? ?? ? ? ????.';
  const products = rows.map(product => {
    const article = document.createElement('article');
    article.className = 'product';
    const title = document.createElement('h3');
    title.textContent = product.name;
    const details = document.createElement('p');
    details.textContent = product.specification;
    const status = document.createElement('p');
    status.className = 'hint';
    const evidence = observation(product);
    const names = new Map((search?.groups || state.groups).map(group => [group.id, group.name]));
    const matched = product.matchedGroups.filter(id => selected.has(id)).map(id => names.get(id) || id);
    const pending = (product.pendingGroups || []).filter(id => selected.has(id)).map(id => names.get(id) || id);
    status.textContent = evidence ? (evidence.price === null ? '?? ?? ??' : evidence.price.toLocaleString('ko-KR') + '? ? ??? ' +
      (evidence.includeShipping ? '??? ??' : '??? ??') + ' ???') +
      (matched.length ? ' ? ?? ??: ' + matched.join(', ') : '') +
      (pending.length ? ' ? ?? ?? ?? ?? ??: ' + pending.join(', ') : '') +
      ' ? ' + new Date(evidence.capturedAt).toLocaleString('ko-KR') : '?? ? ?? ?? ? ? ?? ?? ?? ???';
    article.append(title, details, status);
    const url = safeProductUrl(product.sourceUrl);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '?? ??? ?? ?? ?';
      article.append(link);
    }
    return article;
  });
  if (!products.length) {
    const empty = document.createElement('p');
    empty.textContent = selected.size === 0 ? '??? ??? ??? ???.' :
      state.status === 'sample' ? '??? ??? ???? ?? ??? ????.' : search ?
        (running ? '?? ??? ??? ???? ?????' : '??? ???? ??? ??? ????. ??? ?? ??? ??? ???.') :
        state.groups.some(group => group.snapshot) ? '??? ???? ???? ?? ???? ?? ???.' :
        '?? ??? ??? ????. ??? ?? ??? ??? ? ????.';
    products.push(empty);
  }
  $('results').replaceChildren(...products);
}
async function searchAction(type) {
  try {
    const response = await request({ type });
    render(response.state);
    notice(type === 'CP_SEARCH' ? '?? ??? ??? ??????. ?? ??? ????? ???.' : '??? ???? ??? ??? ??????.');
  } catch (error) { notice(error.message); }
}
async function update(action) {
  try { const response = await request({ type: 'CP_UPDATE', action }); render(response.state); notice('? ????? ??? ??????.'); }
  catch (error) { notice(error.message); }
}
async function captureGroup(id, name) {
  if (busy) return;
  setBusy(true);
  notice('?? ?? ??? ??? ??? ?? ?????');
  const entered = $('capture-name').value;
  try {
    const response = await request({ type: 'CP_CAPTURE', id, name: id ? name : entered });
    render(response.state);
    if (!id && $('capture-name').value === entered) $('capture-name').value = '';
    notice(id ? '?? ??? ???? ? ??? ??????.' : '???? ?? ??? ? ???? ?????.');
  } catch (error) { notice(error.message); }
  finally { setBusy(false); }
}
async function applyGroup(id) {
  if (busy) return;
  setBusy(true);
  notice('??? ??? ?? ?????? ??? ???? ???? ?????');
  try {
    const response = await request({ type: 'CP_APPLY', id });
    render(response.state);
    notice('??? ??? ??????. ?? ?? ??? ????? ??? ???. ?? ?? ?? ??? ????.');
  } catch (error) { notice(error.message); }
  finally { setBusy(false); }
}
async function open(mode, persist) {
  if (busy) return;
  setBusy(true);
  try {
    const response = await request({ type: 'CP_OPEN', mode, persist });
    if (response.fallback) notice(response.error, true);
    else {
      if (persist && modeDraft === mode) modeDraft = null;
      notice('?? ??? ?????. ??? ?? ??? ?????.');
    }
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
}
$('capture').addEventListener('click', () => captureGroup());
$('search').addEventListener('click', () => searchAction('CP_SEARCH'));
$('stop-search').addEventListener('click', () => searchAction('CP_STOP_SEARCH'));
$('result-group').addEventListener('change', () => render(renderedState));
$('result-sort').addEventListener('change', () => render(renderedState));
$('mode').addEventListener('change', () => { modeDraft = $('mode').value; });
$('open').addEventListener('click', () => open($('mode').value, true));
$('fallback').addEventListener('click', () => open('tab', false));
$('shipping').addEventListener('change', () => update({ type: 'shipping', value: $('shipping').checked }));
$('save-budget').addEventListener('click', () => {
  const input = $('budget');
  if (!input.checkValidity()) { input.reportValidity(); return; }
  update({ type: 'budget', value: input.value.trim() ? Number(input.value) : null });
});
$('sample').addEventListener('click', () => update({ type: 'sample' }));
if (['inline', 'panel'].includes(surface)) {
  $('close').hidden = false;
  $('close').addEventListener('click', () => request({ type: 'CP_CLOSE' }).catch(error => notice(error.message)));
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]?.newValue) render(changes[STORAGE_KEY].newValue);
});
// Recover a closed/navigated worker even when no further progress messages can arrive.
setInterval(() => {
  if (['running', 'stopping'].includes(renderedState?.search?.phase)) {
    request({ type: 'CP_GET' }).then(response => render(response.state)).catch(() => {});
  }
}, 15000);
request({ type: 'CP_GET' }).then(response => {
  sourceTabId = response.sourceTabId;
  render(response.state);
}).catch(error => notice(error.message, true));
