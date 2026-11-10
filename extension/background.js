import { STORAGE_KEY, MODES, initialState, readState, reduceState, isNotebookPage } from './model.js';

let writeQueue = Promise.resolve();
async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return readState(data[STORAGE_KEY]);
}
function update(action) {
  const operation = writeQueue.then(async () => {
    const next = reduceState(await getState(), action);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
function trusted(sender) {
  return sender.id === chrome.runtime.id &&
    (sender.url?.startsWith(chrome.runtime.getURL('')) || isNotebookPage(sender.url));
}
async function resolveSource(sender, requestedId) {
  if (sender.tab && (isNotebookPage(sender.url) || isNotebookPage(sender.tab.url))) return sender.tab.id;
  if (Number.isInteger(requestedId)) {
    try {
      const tab = await chrome.tabs.get(requestedId);
      if (isNotebookPage(tab.url)) return tab.id;
    } catch { /* A source tab may have been closed. */ }
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(tab => isNotebookPage(tab.url))?.id ?? null;
}
async function openResultTab(sourceTabId) {
  const query = new URLSearchParams({ surface: 'tab' });
  if (sourceTabId !== null) query.set('source', String(sourceTabId));
  const resultUrl = chrome.runtime.getURL('view.html') + '?' + query;
  const stored = await chrome.storage.session.get('resultTabId');
  if (Number.isInteger(stored.resultTabId)) {
    try {
      const tab = await chrome.tabs.get(stored.resultTabId);
      if (tab.url?.startsWith(chrome.runtime.getURL('view.html'))) {
        await chrome.tabs.update(tab.id, { active: true, ...(tab.url === resultUrl ? {} : { url: resultUrl }) });
        return tab;
      }
    } catch { /* Recreate a closed results tab. */ }
  }
  const tab = await chrome.tabs.create({ url: resultUrl });
  await chrome.storage.session.set({ resultTabId: tab.id });
  return tab;
}
const now = () => new Date().toISOString();
function workerMatches(search, sender) {
  try {
    const url = new URL(sender.url);
    return search && sender.tab?.id === search.workerTabId && isNotebookPage(url.href) &&
      new URLSearchParams(url.hash.slice(1)).get('condition-pick-worker') === search.id;
  } catch { return false; }
}
async function finishSearch(search, error, cancelled = false) {
  const state = await update({ type: 'search-finish', id: search.id, at: now(), error, cancelled });
  if (Number.isInteger(search.workerTabId)) {
    try {
      const tab = await chrome.tabs.get(search.workerTabId);
      if (workerMatches(search, { tab, url: tab.url })) await chrome.tabs.remove(search.workerTabId);
    } catch { /* Already closed or navigated away by the user. */ }
  }
  return state;
}
async function recoverSearch() {
  const state = await getState();
  if (!['running', 'stopping'].includes(state.search?.phase)) return state;
  const search = state.search;
  // Give tab creation and its first content-script handshake time to complete.
  if (Date.now() - Date.parse(search.updatedAt) < 60000) return state;
  try {
    const tab = await chrome.tabs.get(search.workerTabId);
    if (!workerMatches(search, { tab, url: tab.url })) throw new Error('?? ?? ???? ?? ???? ??????.');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CP_WORKER_PING', id: search.id });
    if (!response?.running) throw new Error('?? ?? ??? ???????.');
    return state;
  } catch {
    return finishSearch(search, '?? ? ??? ?????. ??? ?? ??? ??????.');
  }
}
async function handle(message, sender) {
  if (!trusted(sender)) throw new Error('???? ?? ???? ?????.');
  const source = await resolveSource(sender, message.sourceTabId);
  if (message.type === 'CP_GET') return { state: await recoverSearch(), sourceTabId: source };
  if (message.type === 'CP_SEARCH') {
    const id = globalThis.crypto.randomUUID();
    await update({ type: 'search-start', id, at: now() });
    let tab;
    try {
      tab = await chrome.tabs.create({ active: false,
        url: 'https://prod.danawa.com/list/?cate=112758#condition-pick-worker=' + id });
      return { state: await update({ type: 'search-worker', id, tabId: tab.id, at: now() }) };
    } catch (error) {
      if (tab) { try { await chrome.tabs.remove(tab.id); } catch {} }
      const state = await getState();
      if (state.search?.id === id && ['running', 'stopping'].includes(state.search.phase)) {
        await finishSearch(state.search, '??? ?? ??? ?????: ' + error.message);
      }
      throw error;
    }
  }
  if (message.type === 'CP_STOP_SEARCH') {
    const state = await getState();
    if (!['running', 'stopping'].includes(state.search?.phase)) return { state };
    const search = state.search;
    await update({ type: 'search-stopping', id: search.id, at: now() });
    // Closing only the extension-owned worker makes cancellation immediate, including a delayed site request.
    return { state: await finishSearch(search, null, true) };
  }
  if (['CP_WORKER_READY', 'CP_SEARCH_PROGRESS', 'CP_SEARCH_FINISH'].includes(message.type)) {
    const state = await getState();
    const search = state.search;
    if (message.type === 'CP_WORKER_READY' && search?.id === message.id && search.workerTabId === null &&
        search.phase === 'running') return { pending: true };
    if (!workerMatches(search, sender) || search.id !== message.id || search.phase !== 'running') {
      throw new Error('??? ?? ?? ?? ????.');
    }
    if (message.type === 'CP_WORKER_READY') {
      if (search.workerStarted) {
        await finishSearch(search, '?? ?? ?? ???? ??????. ?? ??? ??????.');
        throw new Error('?? ??? ?????. ?? ??? ???.');
      }
      await update({ type: 'search-ready', id: search.id, at: now() });
      return { plan: { id: search.id, groups: search.groups, common: search.common } };
    }
    if (message.type === 'CP_SEARCH_PROGRESS') {
      await update({ type: 'search-progress', id: search.id, at: now(), event: message.event });
      return {};
    }
    return { state: await finishSearch(search, message.error ? String(message.error) : null) };
  }
  if (message.type === 'CP_UPDATE') {
    if (!['mode', 'shipping', 'budget', 'group', 'rename', 'remove', 'sample'].includes(message.action?.type)) {
      throw new Error('???? ?? ?? ?????.');
    }
    return { state: await update(message.action) };
  }
  if (message.type === 'CP_CAPTURE') {
    if (source === null) throw new Error('??? ?? ??? ??? ?? ?? ?????.');
    const response = await chrome.tabs.sendMessage(source, { type: 'CP_CAPTURE_OPTIONS' });
    if (!response?.ok) throw new Error(response?.error || '?? ??? ?? ?????.');
    return { state: await update({ type: 'capture', id: message.id, name: message.name, snapshot: response.snapshot }) };
  }
  if (message.type === 'CP_APPLY') {
    if (source === null) throw new Error('??? ??? ??? ??? ?? ?? ?????.');
    const state = await getState();
    const group = state.groups.find(group => group.id === message.id);
    if (!group?.snapshot) throw new Error('????? ?? ?? ??? ??? ???.');
    const response = await chrome.tabs.sendMessage(source, {
      type: 'CP_APPLY_OPTIONS', snapshot: group.snapshot, common: state.common
    });
    if (!response?.ok) throw new Error(response?.error || '??? ???? ?????.');
    const next = await update({
      type: 'applied', groupId: group.id, name: group.name, snapshot: group.snapshot,
      common: state.common, at: response.applied.appliedAt
    });
    await chrome.tabs.update(source, { active: true });
    return { state: next, applied: response.applied, sourceTabId: source };
  }
  if (message.type === 'CP_CLOSE') {
    if (source !== null) await chrome.tabs.sendMessage(source, { type: 'CP_UNMOUNT' });
    return {};
  }
  if (message.type === 'CP_OPEN') {
    if (!MODES.includes(message.mode)) throw new Error('?? ??? ??? ???.');
    if (message.mode === 'tab') {
      await openResultTab(source);
      if (message.persist !== false) await update({ type: 'mode', value: 'tab' });
      if (source !== null) {
        try { await chrome.tabs.sendMessage(source, { type: 'CP_UNMOUNT' }); } catch {}
      }
      return { mode: 'tab' };
    }
    if (source === null) return { fallback: true, error: '??? ??? ?? ?? ?? ?????. ?? ??? ??? ? ????.' };
    let response;
    try {
      response = await chrome.tabs.sendMessage(source, { type: 'CP_MOUNT', mode: message.mode });
    } catch {
      return { fallback: true, error: '??? ??? ???? ?????. ??? ?? ??????? ?? ??? ??? ???.' };
    }
    if (!response?.ok) return { fallback: true, error: response?.error || '?? ??? ? ? ????.' };
    if (message.persist !== false) await update({ type: 'mode', value: message.mode });
    await chrome.tabs.update(source, { active: true });
    return { mode: message.mode };
  }
  throw new Error('? ? ?? ?????.');
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || !message.type.startsWith('CP_')) return false;
  handle(message, sender).then(value => sendResponse({ ok: true, ...value }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) await chrome.storage.local.set({ [STORAGE_KEY]: initialState() });
});
chrome.tabs.onRemoved?.addListener(async tabId => {
  const state = await getState();
  if (state.search?.workerTabId === tabId && ['running', 'stopping'].includes(state.search.phase)) {
    try { await finishSearch(state.search, '?? ?? ?? ??? ??????. ?? ??? ??????.'); } catch {}
  }
});
