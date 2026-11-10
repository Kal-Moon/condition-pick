(() => {
  if (globalThis.ConditionPickDanawa) return;
  const clean = value => String(value || '').replace(/CM\s*??\s*??\s*:\s*/g, '').replace(/\s+/g, ' ').trim();
  const checked = element => element.getAttribute('aria-checked') === 'true' || element.checked === true;
  const checkboxSelector = '[role="checkbox"][id],input[type="checkbox"][id]';
  let running = false;

  function rootOf(document) {
    const heading = [...document.querySelectorAll('h2')].find(element => clean(element.textContent) === '????');
    for (let node = heading?.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node.querySelector(checkboxSelector) && node.querySelector('input[aria-label="?? ??"]') &&
          !node.querySelector('#productListArea')) return node;
    }
    throw new Error('??? ???? ??? ?? ??? ??? ??????. ???? ????? ???.');
  }
  function groupOf(element, root) {
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      const first = node.firstElementChild;
      if (!first || first === element || first.contains(element) ||
          first.matches(checkboxSelector) || first.querySelector(checkboxSelector)) continue;
      const name = clean(first.textContent);
      if (name && name.length <= 80 && node.querySelector(checkboxSelector)) {
        return { name, row: node, container: node.parentElement };
      }
    }
    throw new Error('?? ??? ???? ?????. ?? ??? ??? ???? ?????.');
  }
  function entries(document, root = rootOf(document)) {
    const labels = new Map([...root.querySelectorAll('label[for]')].map(label => [label.htmlFor, label]));
    return [...root.querySelectorAll(checkboxSelector)].map(element => {
      const labelElement = labels.get(element.id);
      const label = clean(element.getAttribute('aria-label')) || clean(labelElement?.textContent) ||
        clean(labelElement?.querySelector('img[alt]')?.getAttribute('alt'));
      if (!label) throw new Error('??? ?? ? ?? ??? ?? ??? ??????.');
      const group = groupOf(element, root);
      return { element, label, group: group.name, container: group.container,
        key: element.id.replace(/-\d+$/, ''), selected: checked(element) };
    });
  }
  function shippingOf(document) {
    return [...document.querySelectorAll('[role="switch"]')].find(element =>
      clean(element.getAttribute('aria-label')) === '?????' ||
      clean(element.closest('label')?.textContent).startsWith('?????'));
  }
  function priceOf(root) {
    const read = label => {
      const input = root.querySelector('input[aria-label="' + label + '"]');
      if (!input) throw new Error('?? ???? ?? ?????.');
      const digits = input.value.replace(/[,\s?]/g, '');
      if (!digits) return null;
      if (!/^\d+$/.test(digits)) throw new Error('?? ???? ??? ???.');
      const value = Number(digits);
      if (!Number.isSafeInteger(value)) throw new Error('?? ???? ?? ???.');
      return value;
    };
    return { min: read('?? ??'), max: read('?? ??') };
  }
  async function waitFor(predicate, timeout = 1200) {
    const until = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() >= until) throw new Error('?? ?? ??? ???? ??????.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  async function prepare(document) {
    const deadline = Date.now() + 16000;
    const expanded = [];
    let expandedTop = false;
    let topButton;
    try {
      let root = rootOf(document);
      topButton = [...root.querySelectorAll('button')].find(button => clean(button.textContent) === '?? ????');
      if (topButton) {
        const count = root.querySelectorAll(checkboxSelector).length;
        topButton.click();
        expandedTop = true;
        await waitFor(() => rootOf(document).querySelectorAll(checkboxSelector).length !== count ||
          clean(topButton.textContent) === '?? ????');
      }
      for (let index = 0; index < 100; index++) {
        root = rootOf(document);
        const button = [...root.querySelectorAll('button[aria-label]')].find(button =>
          /^?? ?? \d+? ???$/.test(button.getAttribute('aria-label')));
        if (!button) break;
        if (Date.now() > deadline) throw new Error('?? ??? ?? ??????. ????? ?? ? ?? ??? ???.');
        const options = entries(document, root);
        const group = options.find(option => option.container?.contains(button));
        if (!group) throw new Error('?? ??? ??? ???? ?????.');
        const before = root.querySelectorAll(checkboxSelector).length;
        button.click();
        expanded.push(group.group);
        await waitFor(() => !button.isConnected || button.getAttribute('aria-expanded') === 'true' ||
          rootOf(document).querySelectorAll(checkboxSelector).length !== before);
      }
      if ([...rootOf(document).querySelectorAll('button[aria-label]')].some(button =>
        /^?? ?? \d+? ???$/.test(button.getAttribute('aria-label')))) {
        throw new Error('?? ?? ??? ?? ?? ???? ?????.');
      }
      return { restore };
    } catch (error) {
      restore();
      throw error;
    }
    function restore() {
      // Only collapse controls expanded by this operation; filter values are untouched.
      try {
        for (const name of expanded.reverse()) {
          const option = entries(document).find(option => option.group === name);
          option?.container?.querySelector('button[aria-label="?? ?? ??"]')?.click();
        }
        if (expandedTop) {
          const button = [...rootOf(document).querySelectorAll('button')].find(button => clean(button.textContent) === '?? ????');
          button?.click();
        }
      } catch { /* A page navigation may have removed the filter root. */ }
    }
  }
  function snapshot(document) {
    const root = rootOf(document);
    const shipping = shippingOf(document);
    if (!shipping) throw new Error('??? ?? ??? ???? ?????.');
    return {
      schema: 1, site: 'danawa', category: '112758',
      sourceUrl: 'https://prod.danawa.com/list/?cate=112758',
      capturedAt: new Date().toISOString(),
      options: entries(document, root).filter(option => option.selected)
        .map(({ key, label, group }) => ({ key, label, group })),
      price: priceOf(root), includeShipping: checked(shipping)
    };
  }
  async function capture(document = globalThis.document) {
    if (running) throw new Error('?? ?? ??? ?? ????.');
    running = true;
    let prepared;
    try {
      prepared = await prepare(document);
      return snapshot(document);
    } finally {
      prepared?.restore();
      running = false;
    }
  }
  const identity = option => option.group + '\u0000' + option.label;
  function resolveTargets(document, saved) {
    const current = entries(document);
    const targets = [];
    for (const option of saved.options) {
      const exact = current.filter(candidate => candidate.key === option.key && identity(candidate) === identity(option));
      const matches = exact.length ? exact : current.filter(candidate => identity(candidate) === identity(option));
      if (matches.length !== 1) throw new Error('??? ??? ??? ?? ?????: ' + option.group + ' / ' + option.label);
      if (matches[0].element.disabled) throw new Error('?? ??? ? ?? ?????: ' + option.label);
      targets.push(matches[0]);
    }
    return targets;
  }
  async function setOptions(document, saved, deadline = Date.now() + 12000) {
    const targetIds = new Set(resolveTargets(document, saved).map(identity));
    const before = entries(document);
    const changes = [
      ...before.filter(option => option.selected && !targetIds.has(identity(option))),
      ...before.filter(option => !option.selected && targetIds.has(identity(option)))
    ];
    for (const change of changes) {
      if (Date.now() > deadline) throw new Error('?? ?? ??? ??? ??????.');
      const target = entries(document).find(option => identity(option) === identity(change));
      const desired = targetIds.has(identity(change));
      if (!target) throw new Error('?? ? ??? ??????.');
      if (checked(target.element) !== desired) {
        target.element.click();
        await waitFor(() => {
          const fresh = entries(document).find(option => identity(option) === identity(change));
          return fresh && checked(fresh.element) === desired;
        });
      }
    }
  }
  async function setPrice(document, price) {
    const root = rootOf(document);
    const previous = priceOf(root);
    if (previous.min === price.min && previous.max === price.max) return;
    const prototype = document.defaultView.HTMLInputElement.prototype;
    for (const [label, value] of [['?? ??', price.min], ['?? ??', price.max]]) {
      const input = root.querySelector('input[aria-label="' + label + '"]');
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value === null ? '' : String(value));
      input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
      input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    }
    // React-controlled inputs commit their change handlers before the search click.
    await new Promise(resolve => setTimeout(resolve, 0));
    const maxInput = rootOf(document).querySelector('input[aria-label="?? ??"]');
    const button = [...maxInput.parentElement.querySelectorAll('button')].find(button => clean(button.textContent) === '??');
    if (!button) throw new Error('?? ?? ??? ?? ?????.');
    button.click();
    await waitFor(() => { const current = priceOf(rootOf(document)); return current.min === price.min && current.max === price.max; });
  }
  async function setShipping(document, include) {
    // Result refreshes can temporarily replace the toolbar containing the shipping switch.
    await waitFor(() => shippingOf(document), 5000);
    const control = shippingOf(document);
    if (!control) throw new Error('??? ?? ??? ?? ?????.');
    if (checked(control) !== include) {
      control.click();
      await waitFor(() => { const current = shippingOf(document); return current && checked(current) === include; });
    }
  }
  async function apply(saved, common, document = globalThis.document) {
    if (running) throw new Error('?? ?? ??? ?? ????.');
    if (!saved || saved.schema !== 1 || saved.site !== 'danawa' || saved.category !== '112758' ||
        !Array.isArray(saved.options) || saved.options.length > 256 ||
        !saved.price || typeof common?.includeShipping !== 'boolean') throw new Error('??? ??? ??? ??? ???.');
    const validPrice = value => value === null || (Number.isSafeInteger(value) && value >= 0);
    if (![saved.price.min, saved.price.max, common.budget ?? null].every(validPrice)) throw new Error('?? ??? ??? ???.');
    const upper = [saved.price.max, common.budget].filter(value => value !== null && value !== undefined);
    const price = { min: saved.price.min, max: upper.length ? Math.min(...upper) : null };
    if (price.min !== null && price.max !== null && price.min > price.max) throw new Error('??? ?? ??? ?? ??? ?????.');
    running = true;
    let prepared, original, changed = false;
    try {
      prepared = await prepare(document);
      const targets = new Set(resolveTargets(document, saved).map(identity));
      original = snapshot(document);
      // Preflight both selected and cleared controls before any filter change.
      if (entries(document).some(option => option.element.disabled && option.selected !== targets.has(identity(option)))) {
        throw new Error('?? ??? ? ?? ??? ?? ???? ?????.');
      }
      const shipping = shippingOf(document);
      if (shipping.disabled && checked(shipping) !== common.includeShipping) throw new Error('??? ??? ?? ??? ? ????.');
      if (original.price.min !== price.min || original.price.max !== price.max) {
        const input = rootOf(document).querySelector('input[aria-label="?? ??"]');
        const search = [...input.parentElement.querySelectorAll('button')].find(button => clean(button.textContent) === '??');
        if (!search || search.disabled) throw new Error('?? ?? ??? ??? ? ?? ???? ?????.');
      }
      changed = true;
      await setOptions(document, saved);
      await setPrice(document, price);
      await setShipping(document, common.includeShipping);
      const actual = snapshot(document);
      const expected = saved.options.map(identity).sort();
      if (JSON.stringify(actual.options.map(identity).sort()) !== JSON.stringify(expected)) throw new Error('?? ?? ?? ??? ???? ????.');
      return { appliedAt: new Date().toISOString(), options: actual.options, price: actual.price,
        includeShipping: actual.includeShipping, searchComplete: false,
        filtersChanged: JSON.stringify(original.options.map(identity).sort()) !== JSON.stringify(expected) ||
          JSON.stringify(original.price) !== JSON.stringify(actual.price) || original.includeShipping !== actual.includeShipping };
    } catch (error) {
      if (changed && original) {
        try {
          await setOptions(document, original, Date.now() + 5000);
          await setPrice(document, original.price);
          await setShipping(document, original.includeShipping);
          error.message += ' ?? ???? ??????.';
        } catch { error.message += ' ?? ??? ?? ???? ?????. ???? ?? ??? ??? ???.'; }
      }
      throw error;
    } finally {
      prepared?.restore();
      running = false;
    }
  }
  globalThis.ConditionPickDanawa = Object.freeze({ capture, apply });
})();
