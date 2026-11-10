export const STORAGE_KEY = 'conditionPickDisplayV1';
export const MODES = ['inline', 'panel', 'tab'];

export function isNotebookPage(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://prod.danawa.com' &&
      url.pathname === '/list/' && url.searchParams.get('cate') === '112758';
  } catch { return false; }
}

export function initialState() {
  return {
    version: 1, revision: 0, preferredMode: 'inline',
    common: { budget: null, includeShipping: true },
    groups: [
      { id: 'A', name: '조합 A', description: 'i5 + 선택한 외장 GPU', selected: true },
      { id: 'B', name: '조합 B', description: 'i7 또는 i9 · GPU 제한 없음', selected: true }
    ],
    results: [], status: 'not-connected'
  };
}

export function readState(value) {
  if (!value || value.version !== 1) return initialState();
  const defaults = initialState();
  return {
    ...defaults, ...value,
    preferredMode: MODES.includes(value.preferredMode) ? value.preferredMode : 'inline',
    common: { ...defaults.common, ...value.common },
    groups: Array.isArray(value.groups) ? value.groups : defaults.groups,
    results: Array.isArray(value.results) ? value.results : []
  };
}

export function reduceState(current, action) {
  const next = structuredClone(readState(current));
  switch (action?.type) {
    case 'mode':
      if (!MODES.includes(action.value)) throw new Error('지원하지 않는 표시 위치입니다.');
      next.preferredMode = action.value;
      break;
    case 'shipping':
      if (typeof action.value !== 'boolean') throw new Error('배송비 설정을 확인해 주세요.');
      next.common.includeShipping = action.value;
      break;
    case 'budget':
      if (action.value !== null && (!Number.isSafeInteger(action.value) || action.value < 0)) {
        throw new Error('예산은 0 이상의 정수로 입력해 주세요.');
      }
      next.common.budget = action.value;
      break;
    case 'group': {
      const group = next.groups.find(item => item.id === action.id);
      if (!group || typeof action.value !== 'boolean') throw new Error('조합 선택을 확인해 주세요.');
      group.selected = action.value;
      break;
    }
    case 'sample':
      next.results = [{
        id: 'sample-512',
        name: 'MSI 소드 GF76 HX B14WFK-i7 QHD WIN11 32GB램 · SSD 512GB',
        specification: 'i7 · RTX5060 · RAM 32GB · SSD 512GB',
        sourceUrl: 'https://prod.danawa.com/info/?pcode=92104118&cate=112758',
        matchedGroups: ['B']
      }, {
        id: 'sample-1tb',
        name: 'MSI 소드 GF76 HX B14WFK-i7 QHD WIN11 32GB램 · SSD 1TB',
        specification: 'i7 · RTX5060 · RAM 32GB · SSD 1TB',
        sourceUrl: 'https://prod.danawa.com/info/?pcode=92104124&cate=112758',
        matchedGroups: ['B']
      }];
      next.status = 'sample';
      break;
    default:
      throw new Error('지원하지 않는 설정 변경입니다.');
  }
  next.revision += 1;
  return next;
}

export function safeProductUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://prod.danawa.com' && url.pathname === '/info/' &&
      /^\d+$/.test(url.searchParams.get('pcode') || '') ? url.href : null;
  } catch { return null; }
}
