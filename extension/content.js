(() => {
  if (globalThis.__conditionPickDisplayLoaded) return;
  const url = new URL(location.href);
  if (url.origin !== 'https://prod.danawa.com' || url.pathname !== '/list/' ||
      url.searchParams.get('cate') !== '112758') return;
  globalThis.__conditionPickDisplayLoaded = true;
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
  </style><div class="box"><button id="open" type="button">조건픽 열기</button>
    <p id="notice" role="status">표시 시제품 · 실제 검색 미연결</p>
    <button id="fallback" type="button" hidden>별도 탭에서 보기</button></div>`;
  const notice = launchRoot.getElementById('notice');
  const fallback = launchRoot.getElementById('fallback');
  function failed(message) {
    notice.textContent = message;
    fallback.hidden = false;
  }
  async function request(mode, persist = true) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CP_OPEN', mode, persist });
      if (!result.ok || result.fallback) failed(result.error || '표시하지 못했습니다.');
    } catch { failed('확장 프로그램을 다시 불러왔다면 이 페이지를 새로고침해 주세요.'); }
  }
  launchRoot.getElementById('open').addEventListener('click', () => request(preferredMode));
  fallback.addEventListener('click', () => request('tab', false));
  document.body.append(launcher);
  chrome.runtime.sendMessage({ type: 'CP_GET' }).then(result => {
    if (result.ok) preferredMode = result.state.preferredMode;
  }).catch(() => failed('조건픽 연결을 확인해 주세요.'));
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
      failed('다나와 상품 목록 영역을 찾지 못했습니다. 별도 탭에서 확인할 수 있습니다.');
      return { ok: false, error: '다나와 상품 목록이 로딩 중이거나 페이지 구조가 변경되었습니다.' };
    }
    const next = document.createElement('section');
    next.dataset.conditionPick = 'view';
    next.setAttribute('aria-label', '조건픽 표시 시제품');
    const shadow = next.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = mode === 'panel'
      ? ':host{all:initial;display:block;position:fixed;right:12px;top:20px;width:min(430px,calc(100vw - 24px));height:calc(100vh - 40px);z-index:2147483647;border:1px solid #bbc9df;border-radius:12px;background:#fff;box-shadow:0 6px 30px #0003;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0;background:#fff}'
      : ':host{all:initial;display:block;width:100%;margin:16px 0;border:1px solid #bbc9df;border-radius:12px;background:#fff;overflow:hidden}iframe{display:block;width:100%;height:680px;border:0;background:#fff}';
    const iframe = document.createElement('iframe');
    iframe.title = '조건픽 · ' + (mode === 'panel' ? '오른쪽 패널' : '페이지 안 결과');
    iframe.src = chrome.runtime.getURL('view.html') + '?surface=' + mode;
    iframe.referrerPolicy = 'no-referrer';
    shadow.append(style, iframe);
    // Insert the new view first. Failure must not destroy the current view.
    try {
      if (mode === 'inline') anchor.before(next);
      else document.body.append(next);
    } catch {
      next.remove();
      failed('표시 영역을 추가하지 못했습니다. 별도 탭에서 확인할 수 있습니다.');
      return { ok: false, error: '페이지에 표시 영역을 추가하지 못했습니다.' };
    }
    if (host) host.remove();
    host = next;
    launcher.hidden = true;
    fallback.hidden = true;
    notice.textContent = '표시 시제품 · 실제 검색 미연결';
    return { ok: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
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
      failed('다나와 화면이 갱신되어 조건픽 표시가 닫혔습니다. 다시 열거나 별도 탭을 이용해 주세요.');
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
