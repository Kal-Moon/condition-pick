(() => {
  if (globalThis.ConditionPickCollector) return;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const itemSelector = '[data-testid="ProductListItem"]';
  const navSelector = '[data-testid="ProductListPagination"]';
  const emptyText = '?? ?? ???? ???? ??? ????.';
  const usable = element => Boolean(element && !element.disabled && !element.hidden &&
    element.getAttribute('aria-disabled') !== 'true' && !element.classList.contains('hidden'));
  function areaOf(document) {
    const area = document.getElementById('productListArea');
    if (!area) throw new Error('??? ?? ??? ?? ?????.');
    return area;
  }
  function productUrl(value) {
    try {
      const url = new URL(value);
      const id = url.searchParams.get('pcode');
      if (url.origin !== 'https://prod.danawa.com' || url.pathname !== '/info/' || !/^\d+$/.test(id || '')) return null;
      return { id, url: 'https://prod.danawa.com/info/?pcode=' + id + '&cate=112758' };
    } catch { return null; }
  }
  function currentPage(document) {
    const nav = areaOf(document).querySelector(navSelector);
    if (!nav) return null;
    const current = nav.querySelector('button[aria-current="page"]');
    const match = current?.getAttribute('aria-label')?.match(/^??? (\d+)$/);
    if (!match) throw new Error('?? ?? ???? ???? ?????.');
    return Number(match[1]);
  }
  function readPage(document = globalThis.document) {
    const area = areaOf(document);
    const products = [];
    const items = [...area.querySelectorAll(itemSelector)];
    const empty = clean(area.textContent).includes(emptyText);
    if (!items.length && !empty) throw new Error('?? ??? ?? ???? ??? ???????.');
    if (empty && items.length) throw new Error('?? ?? ??? ???? ????.');
    const page = currentPage(document);
    if (items.length && page === null) throw new Error('??? ?? ??? ???? ?? ??? ??????.');
    for (const item of items) {
      // Ads have separate components; never collect generic /info links or benefit prices.
      if (item.closest('[data-testid="BizAdProductItem"],[aria-label*="??"]')) continue;
      const title = clean(item.querySelector('[data-testid="ProductListTitle"] a')?.textContent);
      const specification = clean(item.querySelector('[data-testid="ProductListSpecs"]')?.textContent);
      const priceArea = item.querySelector('[data-testid="ProductListPriceCompare"]');
      if (!title || !specification || !priceArea) throw new Error('?? ??? ???????? ??? ?? ?????.');
      const links = [...priceArea.querySelectorAll('a[aria-label]')].filter(link => productUrl(link.href));
      if (!links.length) throw new Error('?? ??? ?? ??? ?? ?????.');
      for (const link of links) {
        const source = productUrl(link.href);
        const label = clean(link.getAttribute('aria-label'));
        const match = label.match(/^(.*?)\s+([\d,]+)?$/);
        const configuration = match ? clean(match[1]) : label;
        const price = match ? Number(match[2].replace(/,/g, '')) : null;
        if (!configuration || (price !== null && (!Number.isSafeInteger(price) || price < 0))) {
          throw new Error('?? ??? ??? ???? ?????.');
        }
        products.push({ id: source.id, name: title + ' ? ' + configuration,
          specification, configuration, displayedPrice: price, sourceUrl: source.url,
          capturedAt: new Date().toISOString(), page: page || 1 });
      }
    }
    const nav = area.querySelector(navSelector);
    const next = nav?.querySelector('button[aria-label="??? ' + ((page || 1) + 1) + '"]');
    const group = nav?.querySelector('button[aria-label="?? ??? ??"]');
    return { products, page: page || 1, empty, hasNext: usable(next) || usable(group) };
  }
  function signature(document) {
    const area = document.getElementById('productListArea');
    if (!area) return 'missing';
    return [...area.querySelectorAll(itemSelector)].map(item =>
      clean(item.querySelector('[data-testid="ProductListTitle"]')?.textContent) +
      clean(item.querySelector('[data-testid="ProductListSpecs"]')?.textContent) +
      [...item.querySelectorAll('[data-testid="ProductListPriceCompare"] a')]
        .map(link => link.href + ':' + link.getAttribute('aria-label')).join('|')).join('\n') +
      (clean(area.textContent).includes(emptyText) ? 'empty' : '') +
      [...area.querySelectorAll(navSelector + ' button')].map(button => button.getAttribute('aria-label') + ':' + button.getAttribute('aria-current')).join('|');
  }
  function watch(document, options) {
    const { signal, timeoutMs = 25000, quietMs = 1000, minWaitMs = 1400 } = options;
    let last = signature(document), lastChange = Date.now(), changed = false, sawBusy = false;
    const observer = new document.defaultView.MutationObserver(records => {
      const next = signature(document);
      if (next !== last) { last = next; lastChange = Date.now(); changed = true; }
      if (records.some(record => record.type === 'attributes' && record.attributeName === 'aria-busy' &&
        record.oldValue === 'true' && record.target.closest('#productListArea') ||
        [...record.addedNodes].some(node => node.nodeType === 1 &&
          (node.getAttribute('aria-busy') === 'true' || node.querySelector('[aria-busy="true"]')) &&
          (node.closest('#productListArea') || record.target.closest?.('#productListArea'))))) sawBusy = true;
      if (document.querySelector('#productListArea [aria-busy="true"]')) sawBusy = true;
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['aria-busy', 'aria-current', 'aria-checked', 'aria-label', 'href'] });
    return {
      async settle(expectChange = false, expectedPage = null) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (signal?.aborted) throw new Error('??? ??????.');
          const next = signature(document);
          if (next !== last) { last = next; lastChange = Date.now(); changed = true; }
          const busy = Boolean(document.querySelector('#productListArea [aria-busy="true"]'));
          sawBusy ||= busy;
          if (!busy && Date.now() - start >= minWaitMs && Date.now() - lastChange >= quietMs &&
            (!expectChange || changed || sawBusy)) {
            try {
              const page = readPage(document);
              if (expectedPage === null || page.page === expectedPage) return page;
            } catch { /* Wait for a complete, recognisable list rather than accept old or empty markup. */ }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('?? ??? ?? ??? ???? ?????. ??? ?? ??? ?????.');
      },
      close() { observer.disconnect(); }
    };
  }
  async function nextPage(document, previous, options) {
    const nav = areaOf(document).querySelector(navSelector);
    const target = nav?.querySelector('button[aria-label="??? ' + (previous + 1) + '"]') ||
      nav?.querySelector('button[aria-label="?? ??? ??"]');
    if (!usable(target)) throw new Error('?? ?? ???? ?? ?????.');
    const watcher = watch(document, options);
    try { target.click(); return await watcher.settle(true, previous + 1); }
    finally { watcher.close(); }
  }
  async function firstPage(document, options) {
    // Applying a different filter normally resets to page 1. Handle unchanged filters too.
    let current = currentPage(document);
    for (let count = 0; current !== null && current > 1 && count < 100; count++) {
      const nav = areaOf(document).querySelector(navSelector);
      const target = nav?.querySelector('button[aria-label="??? 1"]') ||
        nav?.querySelector('button[aria-label="?? ??? ??"]');
      if (!usable(target)) throw new Error('? ???? ???? ?????.');
      const watcher = watch(document, options);
      try { target.click(); await watcher.settle(true); } finally { watcher.close(); }
      const next = currentPage(document);
      if (next === null || next >= current) throw new Error('? ??? ??? ???? ?????.');
      current = next;
    }
    if (current !== null && current !== 1) throw new Error('? ????? ??? ? ?? ??????.');
    return readPage(document);
  }
  async function run(plan, emit, signal, document = globalThis.document, timing = {}) {
    const options = { ...timing, signal };
    const adapter = globalThis.ConditionPickDanawa;
    if (!adapter) throw new Error('?? ?? ??? ?? ?????.');
    const readyUntil = Date.now() + (timing.timeoutMs || 25000);
    while (!document.querySelector('input[aria-label="?? ??"]') ||
      ![...document.querySelectorAll('h2')].some(heading => clean(heading.textContent) === '????')) {
      if (signal.aborted) throw new Error('??? ??????.');
      if (Date.now() >= readyUntil) throw new Error('??? ???? ??? ???? ?????.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // One sequential page request at a time; no hidden API calls or concurrent crawling.
    for (const group of plan.groups) {
      if (signal.aborted) throw new Error('??? ??????.');
      await emit({ kind: 'group-start', groupId: group.id });
      const watcher = watch(document, options);
      try {
        const applied = await adapter.apply(group.snapshot, plan.common, document);
        await watcher.settle(applied.filtersChanged);
      } finally { watcher.close(); }
      let page = await firstPage(document, options);
      const seen = new Set();
      for (;;) {
        if (signal.aborted) throw new Error('??? ??????.');
        const key = page.products.map(product => product.id).join(',') || 'empty';
        if (seen.has(key)) throw new Error('?? ?? ???? ???? ??? ??????.');
        seen.add(key);
        await emit({ kind: 'page', groupId: group.id, ...page });
        if (!page.hasNext) break;
        // Bound browser storage and very broad searches; reaching this is partial, never complete.
        if (seen.size >= 200) throw new Error('??? 200???? ??? ??????. ??? ?? ?? ??? ???.');
        page = await nextPage(document, page.page, options);
      }
      await emit({ kind: 'group-complete', groupId: group.id });
    }
  }
  globalThis.ConditionPickCollector = Object.freeze({ readPage, run });
})();
