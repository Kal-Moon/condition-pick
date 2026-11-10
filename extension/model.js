import { reduceSearch } from './search-model.js';
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
      { id: 'A', name: '?? A', description: 'i5 + ??? ?? GPU', selected: true },
      { id: 'B', name: '?? B', description: 'i7 ?? i9 ? GPU ?? ??', selected: true }
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

export function normalizeSnapshot(value) {
  if (!value || value.schema !== 1 || value.site !== 'danawa' || value.category !== '112758' ||
      !isNotebookPage(value.sourceUrl) || !Array.isArray(value.options) || value.options.length > 256 ||
      typeof value.includeShipping !== 'boolean' || !value.price) throw new Error('?? ? ?? ??? ???? ????.');
  const price = {};
  for (const field of ['min', 'max']) {
    const number = value.price[field];
    if (number !== null && (!Number.isSafeInteger(number) || number < 0)) throw new Error('?? ? ?? ??? ??? ???.');
    price[field] = number;
  }
  if (price.min !== null && price.max !== null && price.min > price.max) throw new Error('?? ??? ?? ???? ???.');
  const identities = new Set();
  const options = value.options.map(option => {
    const result = {};
    for (const [field, max] of [['key', 180], ['label', 180], ['group', 80]]) {
      if (typeof option?.[field] !== 'string' || !option[field].trim() || option[field].length > max) {
        throw new Error('?? ??? ???? ??? ???.');
      }
      result[field] = option[field].trim();
    }
    const identity = result.group + '\u0000' + result.label;
    if (identities.has(identity)) throw new Error('?? ??? ???? ???? ?????.');
    identities.add(identity);
    return result;
  });
  if (typeof value.capturedAt !== 'string' || value.capturedAt.length > 60 ||
      !Number.isFinite(Date.parse(value.capturedAt))) throw new Error('?? ?? ??? ?? ?????.');
  return { schema: 1, site: 'danawa', category: '112758',
    sourceUrl: 'https://prod.danawa.com/list/?cate=112758', capturedAt: value.capturedAt,
    options, price, includeShipping: value.includeShipping };
}
function groupName(value, fallback) {
  const name = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (name.length > 80) throw new Error('?? ??? 80? ??? ??? ???.');
  return name;
}
function describeSnapshot(snapshot) {
  const groups = new Map();
  for (const option of snapshot.options) {
    if (!groups.has(option.group)) groups.set(option.group, []);
    groups.get(option.group).push(option.label);
  }
  const labels = [...groups].map(([group, values]) => group + ': ' + values.join(' ?? '));
  if (snapshot.price.min !== null) labels.push('?? ' + snapshot.price.min.toLocaleString('ko-KR') + '?');
  if (snapshot.price.max !== null) labels.push('?? ' + snapshot.price.max.toLocaleString('ko-KR') + '?');
  return labels.length ? labels.join(' / ') : '?? ?? ?? ??';
}

export function reduceState(current, action) {
  const next = structuredClone(readState(current));
  switch (action?.type) {
    case 'mode':
      if (!MODES.includes(action.value)) throw new Error('???? ?? ?? ?????.');
      next.preferredMode = action.value;
      break;
    case 'shipping':
      if (typeof action.value !== 'boolean') throw new Error('??? ??? ??? ???.');
      next.common.includeShipping = action.value;
      break;
    case 'budget':
      if (action.value !== null && (!Number.isSafeInteger(action.value) || action.value < 0)) {
        throw new Error('??? 0 ??? ??? ??? ???.');
      }
      next.common.budget = action.value;
      break;
    case 'group': {
      const group = next.groups.find(item => item.id === action.id);
      if (!group || typeof action.value !== 'boolean') throw new Error('?? ??? ??? ???.');
      group.selected = action.value;
      break;
    }
    case 'capture': {
      const saved = normalizeSnapshot(action.snapshot);
      const existing = action.id ? next.groups.find(group => group.id === action.id) : null;
      if (action.id && !existing) throw new Error('??? ??? ????.');
      const groups = next.groups.filter(group => group.snapshot);
      if (!existing && groups.length >= 50) throw new Error('??? ?? 50??? ??? ? ????.');
      const group = {
        id: existing?.id || 'group-' + globalThis.crypto.randomUUID(),
        name: groupName(action.name, existing?.name || '?? ' + (groups.length + 1)),
        description: describeSnapshot(saved),
        selected: existing?.selected ?? true,
        snapshot: saved
      };
      const index = groups.findIndex(item => item.id === group.id);
      if (index < 0) groups.push(group);
      else groups[index] = group;
      next.groups = groups;
      if (next.status === 'sample') { next.results = []; next.status = 'not-connected'; }
      break;
    }
    case 'rename': {
      const group = next.groups.find(group => group.id === action.id);
      if (!group) throw new Error('??? ?? ?????.');
      group.name = groupName(action.value, group.name);
      break;
    }
    case 'remove': {
      if (!next.groups.some(group => group.id === action.id)) throw new Error('??? ?? ?????.');
      next.groups = next.groups.filter(group => group.id !== action.id);
      break;
    }
    case 'applied':
      next.lastApplied = {
        groupId: action.groupId, name: action.name, at: action.at,
        snapshot: normalizeSnapshot(action.snapshot),
        common: structuredClone(action.common),
        searchComplete: false
      };
      break;
    case 'sample':
      next.results = [{
        id: 'sample-512',
        name: 'MSI ?? GF76 HX B14WFK-i7 QHD WIN11 32GB? ? SSD 512GB',
        specification: 'i7 ? RTX5060 ? RAM 32GB ? SSD 512GB',
        sourceUrl: 'https://prod.danawa.com/info/?pcode=92104118&cate=112758',
        matchedGroups: ['B']
      }, {
        id: 'sample-1tb',
        name: 'MSI ?? GF76 HX B14WFK-i7 QHD WIN11 32GB? ? SSD 1TB',
        specification: 'i7 ? RTX5060 ? RAM 32GB ? SSD 1TB',
        sourceUrl: 'https://prod.danawa.com/info/?pcode=92104124&cate=112758',
        matchedGroups: ['B']
      }];
      next.status = 'sample';
      break;
    default:
      if (action?.type?.startsWith('search-')) reduceSearch(next, action);
      else throw new Error('???? ?? ?? ?????.');
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
