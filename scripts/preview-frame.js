const host = window.parent !== window ? window.parent : window.opener;
const callbacks = new Map(), storageCallbacks = [];
let nextId = 0;
globalThis.chrome = {
  runtime: { sendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!host) { reject(new Error('검증 원본 페이지를 찾지 못했습니다.')); return; }
      const id = ++nextId;
      callbacks.set(id, { resolve, reject });
      host.postMessage({ channel: 'cp-preview-request', id, message }, location.origin);
    });
  } },
  storage: { onChanged: { addListener: fn => storageCallbacks.push(fn) } }
};
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== host) return;
  if (event.data?.channel === 'cp-preview-response') {
    const handler = callbacks.get(event.data.id);
    if (!handler) return;
    callbacks.delete(event.data.id);
    if (event.data.error) handler.reject(new Error(event.data.error));
    else handler.resolve(event.data.result);
  } else if (event.data?.channel === 'cp-preview-storage') {
    storageCallbacks.forEach(fn => fn(event.data.changes, event.data.area));
  }
});
await import('/extension/view.js');
