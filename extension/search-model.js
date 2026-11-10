const copy = value => structuredClone(value);
const money = value => value === null || Number.isSafeInteger(value) && value >= 0;
function canonicalProduct(value) {
  let url;
  try { url = new URL(value.sourceUrl); } catch { throw new Error('??? ?? ?????.'); }
  const id = url.searchParams.get('pcode');
  if (url.origin !== 'https://prod.danawa.com' || url.pathname !== '/info/' || !/^\d+$/.test(id || '') ||
      value.id !== id || typeof value.name !== 'string' || !value.name || value.name.length > 600 ||
      typeof value.specification !== 'string' || value.specification.length > 6000 ||
      typeof value.configuration !== 'string' || value.configuration.length > 300 ||
      !money(value.displayedPrice) || !Number.isFinite(Date.parse(value.capturedAt))) {
    throw new Error('?? ? ?? ??? ??? ???? ????.');
  }
  return { id, name: value.name, specification: value.specification,
    configuration: value.configuration, displayedPrice: value.displayedPrice,
    sourceUrl: 'https://prod.danawa.com/info/?pcode=' + id + '&cate=112758', capturedAt: value.capturedAt };
}
function capacity(value) {
  const match = String(value).trim().match(/^(?:SSD\s*)?(\d+(?:\.\d+)?)\s*(TB|GB)$/i);
  return match ? Number(match[1]) * (match[2].toUpperCase() === 'TB' ? 1024 : 1) : null;
}
function storageMatch(product, snapshot) {
  const options = snapshot.options.filter(option => ['??', '?? ???'].includes(option.group));
  if (!options.length) return true;
  const actual = capacity(product.configuration);
  if (actual === null) return null;
  for (const group of new Set(options.map(option => option.group))) {
    let unknown = false;
    const matched = options.filter(option => option.group === group).some(option => {
      const exact = capacity(option.label);
      if (exact !== null) return actual === exact;
      // Danawa's range labels list the upper bound first, e.g. 512~257GB.
      const range = option.label.match(/^(\d+(?:\.\d+)?)(TB|GB)?\s*~\s*(\d+(?:\.\d+)?)(TB|GB)$/i);
      if (range) {
        const unit = range[4].toUpperCase();
        const a = Number(range[1]) * ((range[2] || unit).toUpperCase() === 'TB' ? 1024 : 1);
        const b = Number(range[3]) * (unit === 'TB' ? 1024 : 1);
        return actual >= Math.min(a, b) && actual <= Math.max(a, b);
      }
      unknown = true;
      return false;
    });
    if (!matched) return unknown ? null : false;
  }
  return true;
}
export function searchIsStale(state) {
  if (!state.search) return false;
  const selected = state.groups.filter(group => group.selected && group.snapshot);
  return JSON.stringify(state.common) !== JSON.stringify(state.search.common) ||
    JSON.stringify(selected.map(group => [group.id, group.snapshot])) !==
    JSON.stringify(state.search.groups.map(group => [group.id, group.snapshot]));
}
export function reduceSearch(next, action) {
  if (action.type === 'search-start') {
    if (next.search?.phase === 'running' || next.search?.phase === 'stopping') throw new Error('?? ?? ????.');
    const groups = next.groups.filter(group => group.selected && group.snapshot);
    if (!groups.length) throw new Error('????? ?? ??? ?? ?? ??? ???.');
    next.search = { id: action.id, phase: 'running', workerTabId: null, workerStarted: false,
      common: copy(next.common), groups: copy(groups), startedAt: action.at, updatedAt: action.at,
      progress: groups.map(group => ({ groupId: group.id, name: group.name, phase: 'waiting', pages: 0, count: 0 })),
      errors: [], searchComplete: false };
    next.results = [];
    next.status = 'search';
    return;
  }
  const search = next.search;
  if (!search || search.id !== action.id || !['running', 'stopping'].includes(search.phase)) throw new Error('?????? ?? ??? ?????.');
  search.updatedAt = action.at;
  if (action.type === 'search-worker') { search.workerTabId = action.tabId; return; }
  if (action.type === 'search-ready') {
    if (search.workerStarted) throw new Error('?? ?? ?? ???? ??? ??????.');
    search.workerStarted = true;
    return;
  }
  if (action.type === 'search-stopping') { search.phase = 'stopping'; return; }
  if (action.type === 'search-finish') {
    const complete = !action.error && search.phase === 'running' && search.progress.every(group => group.phase === 'complete');
    search.phase = complete ? 'complete' : action.cancelled || search.phase === 'stopping' ? 'stopped' : 'partial';
    search.searchComplete = complete;
    search.finishedAt = action.at;
    if (action.error) search.errors.push(String(action.error).slice(0,500));
    for (const group of search.progress) if (group.phase === 'running') group.phase = search.phase;
    return;
  }
  if (action.type !== 'search-progress' || search.phase !== 'running') throw new Error('?? ?? ?????.');
  const event = action.event;
  const progress = search.progress.find(group => group.groupId === event?.groupId);
  const group = search.groups.find(group => group.id === event?.groupId);
  if (!progress || !group) throw new Error('?? ??? ???? ????.');
  if (event.kind === 'group-start') {
    if (progress.phase !== 'waiting') throw new Error('?? ??? ?????.');
    progress.phase = 'running';
  } else if (event.kind === 'group-complete') {
    if (progress.phase !== 'running' || progress.pages < 1 || progress.hasNext !== false) throw new Error('??? ??? ??? ?????.');
    progress.phase = 'complete';
  } else if (event.kind === 'page') {
    if (progress.phase !== 'running' || event.page !== progress.pages + 1 || typeof event.hasNext !== 'boolean' ||
        !Array.isArray(event.products) || event.products.length > 3000) throw new Error('?? ??? ??? ??? ??? ???.');
    const products = event.products.map(canonicalProduct);
    const byId = new Map(next.results.map(product => [product.id, product]));
    for (const product of products) {
      const storage = storageMatch(product, group.snapshot);
      if (storage === false) continue;
      const upper = [search.common.budget, group.snapshot.price.max].filter(value => value !== null);
      const max = upper.length ? Math.min(...upper) : null;
      const min = group.snapshot.price.min;
      const price = product.displayedPrice;
      if (price !== null && (max !== null && price > max || min !== null && price < min)) continue;
      const confirmed = storage === true && price !== null;
      let existing = byId.get(product.id);
      if (!existing) {
        existing = { ...product, matchedGroups: [], pendingGroups: [], observations: [] };
        byId.set(product.id, existing);
        next.results.push(existing);
      }
      // Preserve each observation: later lower prices must not rewrite an earlier group's evidence.
      existing.observations = existing.observations.filter(item => item.groupId !== group.id);
      existing.observations.push({ groupId: group.id, price, includeShipping: search.common.includeShipping,
        capturedAt: product.capturedAt, page: event.page, confirmed });
      const alreadyCounted = existing.matchedGroups.includes(group.id) || existing.pendingGroups.includes(group.id);
      existing.matchedGroups = existing.matchedGroups.filter(id => id !== group.id);
      existing.pendingGroups = existing.pendingGroups.filter(id => id !== group.id);
      const ids = confirmed ? existing.matchedGroups : existing.pendingGroups;
      if (!ids.includes(group.id)) ids.push(group.id);
      if (!alreadyCounted) progress.count++;
    }
    if (next.results.length > 15000) throw new Error('?? ??? ?? ?? ??????. ??? ?? ?? ??? ???.');
    progress.pages = event.page;
    progress.hasNext = event.hasNext;
    if (new TextEncoder().encode(JSON.stringify(next)).length > 4000000) {
      throw new Error('???? ?? ??? ??? ??????. ??? ?? ?? ??? ???.');
    }
  } else throw new Error('? ? ?? ?? ?? ?????.');
}
