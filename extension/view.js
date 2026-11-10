import { STORAGE_KEY, readState, safeProductUrl } from './model.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const surface = params.get('surface') || 'popup';
const labels = { inline: '다나와 페이지 안', panel: '오른쪽 패널', tab: '조건픽 별도 탭', popup: '표시 위치를 선택해 열어 보세요.' };
$('surface-label').textContent = labels[surface] || labels.popup;
let sourceTabId = params.has('source') ? Number(params.get('source')) : null;
let busy = false;
let lastRevision = -1;
let modeDraft = null;
async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, sourceTabId });
  if (!response?.ok) throw new Error(response?.error || '조건픽 연결을 확인하지 못했습니다.');
  return response;
}
function notice(message, fallback = false) {
  $('notice').textContent = message;
  $('fallback').hidden = !fallback;
}
function render(value) {
  const state = readState(value);
  if (state.revision < lastRevision) return;
  lastRevision = state.revision;
  $('mode').value = modeDraft ?? state.preferredMode;
  $('shipping').checked = state.common.includeShipping;
  if (document.activeElement !== $('budget')) $('budget').value = state.common.budget ?? '';
  $('price-basis').textContent = state.common.includeShipping
    ? '선택 기준: 상품 가격 + 배송비 · 실제 가격 판정은 미연결'
    : '선택 기준: 상품 가격만 · 실제 가격 판정은 미연결';
  const groups = state.groups.map(group => {
    const label = document.createElement('label');
    label.className = 'check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.selected;
    checkbox.addEventListener('change', () => update({ type: 'group', id: group.id, value: checkbox.checked }));
    const text = document.createElement('span');
    text.append(document.createTextNode(group.name));
    const detail = document.createElement('span');
    detail.className = 'group-detail';
    detail.textContent = group.description;
    text.append(detail);
    label.append(checkbox, text);
    return label;
  });
  $('groups').replaceChildren(...groups);
  const selected = new Set(state.groups.filter(group => group.selected).map(group => group.id));
  const rows = state.results.filter(product => product.matchedGroups.some(id => selected.has(id)));
  const products = rows.map(product => {
    const article = document.createElement('article');
    article.className = 'product';
    const title = document.createElement('h3');
    title.textContent = product.name;
    const details = document.createElement('p');
    details.textContent = product.specification;
    const status = document.createElement('p');
    status.className = 'hint';
    status.textContent = '샘플 · 가격 연동 전 · 예산 충족 여부 미판정';
    article.append(title, details, status);
    const url = safeProductUrl(product.sourceUrl);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '원본 다나와 상품 상세 ↗';
      article.append(link);
    }
    return article;
  });
  if (!products.length) {
    const empty = document.createElement('p');
    empty.textContent = selected.size === 0 ? '적용할 조합을 선택해 주세요.' :
      state.status === 'sample' ? '선택한 조합에 해당하는 표시 샘플이 없습니다.' : '아직 검색한 결과가 없습니다. 샘플로 표시 위치를 확인할 수 있습니다.';
    products.push(empty);
  }
  $('results').replaceChildren(...products);
}
async function update(action) {
  try { const response = await request({ type: 'CP_UPDATE', action }); render(response.state); notice('이 브라우저에 설정을 저장했습니다.'); }
  catch (error) { notice(error.message); }
}
async function open(mode, persist) {
  if (busy) return;
  busy = true;
  $('open').disabled = true;
  try {
    const response = await request({ type: 'CP_OPEN', mode, persist });
    if (response.fallback) notice(response.error, true);
    else {
      if (persist && modeDraft === mode) modeDraft = null;
      notice('표시 위치를 열었습니다. 조합과 샘플 결과는 유지됩니다.');
    }
  } catch (error) { notice(error.message, true); }
  finally { busy = false; $('open').disabled = false; }
}
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
request({ type: 'CP_GET' }).then(response => {
  sourceTabId = response.sourceTabId;
  render(response.state);
}).catch(error => notice(error.message, true));
