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
  if (sender.tab && isNotebookPage(sender.url)) return sender.tab.id;
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
async function handle(message, sender) {
  if (!trusted(sender)) throw new Error('지원하지 않는 페이지의 요청입니다.');
  const source = await resolveSource(sender, message.sourceTabId);
  if (message.type === 'CP_GET') return { state: await getState(), sourceTabId: source };
  if (message.type === 'CP_UPDATE') return { state: await update(message.action) };
  if (message.type === 'CP_CLOSE') {
    if (source !== null) await chrome.tabs.sendMessage(source, { type: 'CP_UNMOUNT' });
    return {};
  }
  if (message.type === 'CP_OPEN') {
    if (!MODES.includes(message.mode)) throw new Error('표시 위치를 확인해 주세요.');
    if (message.mode === 'tab') {
      await openResultTab(source);
      if (message.persist !== false) await update({ type: 'mode', value: 'tab' });
      if (source !== null) {
        try { await chrome.tabs.sendMessage(source, { type: 'CP_UNMOUNT' }); } catch {}
      }
      return { mode: 'tab' };
    }
    if (source === null) return { fallback: true, error: '다나와 노트북 원본 탭을 찾지 못했습니다. 별도 탭에서 확인할 수 있습니다.' };
    let response;
    try {
      response = await chrome.tabs.sendMessage(source, { type: 'CP_MOUNT', mode: message.mode });
    } catch {
      return { fallback: true, error: '페이지 연결을 확인하지 못했습니다. 다나와 탭을 새로고침하거나 별도 탭에서 확인해 주세요.' };
    }
    if (!response?.ok) return { fallback: true, error: response?.error || '표시 영역을 열 수 없습니다.' };
    if (message.persist !== false) await update({ type: 'mode', value: message.mode });
    await chrome.tabs.update(source, { active: true });
    return { mode: message.mode };
  }
  throw new Error('알 수 없는 요청입니다.');
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
