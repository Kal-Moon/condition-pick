// Browser DOM harness only. Chrome APIs and the source site are simulated;
// the extension's actual background, content and view modules are used.
const channels = { background: [], content: [], storage: [] };
let registration = 'background';
const local = JSON.parse(localStorage.getItem('cp-preview-state') || '{}');
const session = {};
const resultWindows = new Map();
const sourceUrl = 'https://prod.danawa.com/list/?cate=112758';
let nextTab = 10;
function storage(values, area) {
  return {
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(update) {
      const changes = {};
      for (const [key, value] of Object.entries(update)) {
        changes[key] = { oldValue: structuredClone(values[key]), newValue: structuredClone(value) };
        values[key] = structuredClone(value);
      }
      if (area === 'local') localStorage.setItem('cp-preview-state', JSON.stringify(local));
      channels.storage.forEach(fn => fn(changes, area));
      document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage({ channel: 'cp-preview-storage', changes, area }, location.origin));
      resultWindows.forEach(win => { if (!win.closed) win.postMessage({ channel: 'cp-preview-storage', changes, area }, location.origin); });
    }
  };
}
function dispatch(listeners, message, sender) {
  return new Promise((resolve, reject) => {
    let handled = false;
    let answered = false;
    const answer = value => { answered = true; resolve(value); };
    for (const callback of listeners) {
      if (callback(message, sender, answer)) handled = true;
      if (answered) return;
    }
    if (!handled) reject(new Error('No message receiver'));
  });
}
const sourceTab = { id: 1, url: sourceUrl, active: true };
globalThis.chrome = {
  runtime: {
    id: 'preview-extension',
    getURL: value => location.origin + '/extension/' + value,
    onMessage: { addListener: fn => channels[registration].push(fn) },
    onInstalled: { addListener() {} },
    sendMessage: message => dispatch(channels.background, message, { id: 'preview-extension', url: sourceUrl, tab: sourceTab })
  },
  storage: { local: storage(local, 'local'), session: storage(session, 'session'),
    onChanged: { addListener: fn => channels.storage.push(fn) } },
  tabs: {
    async get(id) {
      if (id === 1) return sourceTab;
      const win = resultWindows.get(id);
      if (!win || win.closed) throw new Error('Tab closed');
      return { id, url: win.location.href };
    },
    async query() { return [sourceTab]; },
    async create(properties) {
      const win = window.open(properties.url, '_blank');
      if (!win) throw new Error('브라우저에서 검증용 새 탭 열기를 막았습니다.');
      const id = nextTab++;
      resultWindows.set(id, win);
      return { id, url: properties.url };
    },
    async update(id, properties) {
      if (id !== 1) {
        const win = resultWindows.get(id);
        if (properties.url) win.location.href = properties.url;
        if (properties.active) win.focus();
      }
      return { id, url: id === 1 ? sourceUrl : resultWindows.get(id).location.href };
    },
    sendMessage: (id, message) => dispatch(channels.content, message, { id: 'preview-extension' })
  }
};
window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.data?.channel !== 'cp-preview-request') return;
  const { id, message } = event.data;
  try {
    const result = await dispatch(channels.background, message, {
      id: 'preview-extension', url: location.origin + '/extension/view.html'
    });
    event.source.postMessage({ channel: 'cp-preview-response', id, result }, event.origin);
  } catch (error) {
    event.source.postMessage({ channel: 'cp-preview-response', id, error: error.message }, event.origin);
  }
});
await import('/extension/background.js');
registration = 'content';
const content = await (await fetch('/extension/content.js')).text();
new Function('location', 'chrome', content)({ href: sourceUrl }, chrome);
