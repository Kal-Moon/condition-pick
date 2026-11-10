(() => {
  if (globalThis.__conditionPickDisplayLoaded) return;
  const url = new URL(location.href);
  if (url.origin !== 'https://prod.danawa.com' || url.pathname !== '/list/' ||
      url.searchParams.get('cate') !== '112758') return;
  globalThis.__conditionPickDisplayLoaded = true;
  const workerId = new URLSearchParams(url.hash.slice(1)).get('condition-pick-worker');
  if (workerId) {
    const workerDocument = document;
    const controller = new AbortController();
    let running = true;
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== chrome.runtime.id || message.type !== 'CP_WORKER_PING' || message.id !== workerId) return false;
      respond({ running });
      return false;
    });
    // A user can inspect the worker, but editing it stops collection to avoid mixing conditions.
    const edited = event => { if (event.isTrusted) controller.abort(); };
    document.addEventListener('click', edited, true);
    document.addEventListener('input', edited, true);
    const send = async message => {
      const response = await chrome.runtime.sendMessage({ ...message, id: workerId });
      if (!response?.ok) throw new Error(response?.error || '?? ?? ??? ???? ?????.');
      return response;
    };
    (async () => {
      try {
        let ready;
        for (let attempt = 0; attempt < 30; attempt++) {
          ready = await send({ type: 'CP_WORKER_READY' });
          if (!ready.pending) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!ready?.plan) throw new Error('?? ??? ???? ?????.');
        await globalThis.ConditionPickCollector.run(ready.plan,
          event => send({ type: 'CP_SEARCH_PROGRESS', event }), controller.signal);
        await send({ type: 'CP_SEARCH_FINISH' });
      } catch (error) {
        try { await send({ type: 'CP_SEARCH_FINISH', error: controller.signal.aborted
          ? '?? ??? ?? ??? ??? ??? ??????.' : error.message }); } catch {}
      } finally {
        running = false;
        workerDocument.removeEventListener('click', edited, true);
        workerDocument.removeEventListener('input', edited, true);
      }
    })();
    return;
  }
  let host = null;
  let preferredMode = 'inline';
  const launcher = document.createElement('div');
  launcher.dataset.conditionPick = 'launcher';
  const launchRoot = launcher.attachShadow({ mode: 'closed' });
  launchRoot.innerHTML = `<style>
    :host{all:initial;position:fixed;right:20px;bottom:24px;z-index:2147483646;font:14px/1.5 system-ui;color:#15213a}
    .box{background:#fff;border:1px solid #bac8dd;border-radius:12px;padding:12px;max-width:280px;box-shadow:0 4px 20px #0002}
    button{font:inherit;background:#174c9f;color:white;border:0;border-radius:7px;padding:10px 14px;cursor:pointer}
    p{margin:8px 0;font-size:12px}button:focus-visible{outline:3px solid #e69712;outline-offset:3px}
    [hidden]{display:none}
  </style><div class="box"><button id="open" type="button">??? ??</button>
    <p id="notice" role="status">?? ??? ? ?? ????????</p>
    <button id="fallback" type="button" hidden>?? ??? ??</button></div>`;
  const notice = launchRoot.getElementById('notice');
  const fallback = launchRoot.getElementById('fallback');
  function failed(message) {
    notice.textContent = message;
    fallback.hidden = false;
  }
  async function request(mode, persist = true) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CP_OPEN', mode, persist });
      if (!result.ok || result.fallback) failed(result.error || '???? ?????.');
    } catch { failed('?? ????? ?? ????? ? ???? ????? ???.'); }
  }
  launchRoot.getElementById('open').addEventListener('click', () => request(preferredMode));
  fallback.addEventListener('click', () => request('tab', false));
  document.body.append(launcher);
  chrome.runtime.sendMessage({ type: 'CP_GET' }).then(result => {
    if (result.ok) preferredMode = result.state.preferredMode;
  }).catch(() => failed('??? ??? ??? ???.'));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.conditionPickDisplayV1?.newValue) {
      preferredMode = changes.conditionPickDisplayV1.newValue.preferredMode || 'inline';
    }
  });
  function unmount() {
    if (host) host.remove();
    host = null;
    launcher.hidden = false;
  }
  function mount(mode) {
    const anchor = document.getElementById('productListArea');
    if (mode === 'inline' && !anchor) {
      failed('??? ?? ?? ??? ?? ?????. ?? ??? ??? ? ????.');
      return { ok: false, error: '??? ?? ??? ?? ???? ??? ??? ???????.' };
    }
    const next = document.createElement('section');
    next.dataset.conditionPick = 'view';
    next.setAttribute('aria-label', '??? ?? ???');
    const shadow = next.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = mode === 'panel'
      ? ':host{all:initial;display:block;position:fixed;right:12px;top:20px;width:min(430px,calc(100vw - 24px));height:calc(100vh - 40px);z-index:2147483647;border:1px solid #bbc9df;border-radius:12px;background:#fff;box-shadow:0 6px 30px #0003;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0;background:#fff}'
      : ':host{all:initial;display:block;width:100%;margin:16px 0;border:1px solid #bbc9df;border-radius:12px;background:#fff;overflow:hidden}iframe{display:block;width:100%;height:680px;border:0;background:#fff}';
    const iframe = document.createElement('iframe');
    iframe.title = '??? ? ' + (mode === 'panel' ? '??? ??' : '??? ? ??');
    iframe.src = chrome.runtime.getURL('view.html') + '?surface=' + mode;
    iframe.referrerPolicy = 'no-referrer';
    shadow.append(style, iframe);
    // Insert the new view first. Failure must not destroy the current view.
    try {
      if (mode === 'inline') anchor.before(next);
      else document.body.append(next);
    } catch {
      next.remove();
      failed('?? ??? ???? ?????. ?? ??? ??? ? ????.');
      return { ok: false, error: '???? ?? ??? ???? ?????.' };
    }
    if (host) host.remove();
    host = next;
    launcher.hidden = true;
    fallback.hidden = true;
    notice.textContent = '?? ??? ? ?? ????????';
    return { ok: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (['CP_CAPTURE_OPTIONS', 'CP_APPLY_OPTIONS'].includes(message.type)) {
      const adapter = globalThis.ConditionPickDanawa;
      if (!adapter) {
        sendResponse({ ok: false, error: '?? ?? ??? ?? ????? ??? ?? ????? ???.' });
        return false;
      }
      const task = message.type === 'CP_CAPTURE_OPTIONS'
        ? adapter.capture() : adapter.apply(message.snapshot, message.common);
      task.then(value => sendResponse(message.type === 'CP_CAPTURE_OPTIONS'
        ? { ok: true, snapshot: value } : { ok: true, applied: value }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'CP_MOUNT') {
      if (!['inline', 'panel'].includes(message.mode)) return false;
      sendResponse(mount(message.mode));
    } else if (message.type === 'CP_UNMOUNT') {
      unmount();
      sendResponse({ ok: true });
    }
    return false;
  });
  new MutationObserver(() => {
    if (host && !host.isConnected) {
      host = null;
      launcher.hidden = false;
      failed('??? ??? ???? ??? ??? ?????. ?? ??? ?? ?? ??? ???.');
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
