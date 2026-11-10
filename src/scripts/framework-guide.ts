const root = document.querySelector<HTMLElement>('[data-framework-guide]');
if (root) {
  const panels = [...root.querySelectorAll<HTMLElement>('[data-stack-panel]')];
  const choices = [...root.querySelectorAll<HTMLAnchorElement>('[data-stack-choice]')];
  const methods = [...root.querySelectorAll<HTMLDetailsElement>('[data-method]')];
  const search = root.querySelector<HTMLInputElement>('[data-framework-search]')!;
  const tier = root.querySelector<HTMLSelectElement>('[data-framework-tier]')!;
  const count = root.querySelector<HTMLElement>('[data-framework-count]')!;
  const empty = root.querySelector<HTMLElement>('[data-framework-empty]')!;
  const norm = (text: string) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const index = new Map(methods.map((method) => [method, norm(method.textContent ?? '')]));

  function filter() {
    let visible = 0;
    const query = norm(search.value);
    methods.forEach((method) => {
      const match = (!tier.value || method.dataset.tier === tier.value) && index.get(method)!.includes(query);
      method.classList.toggle('is-filtered', !match);
      if (match) visible++;
    });
    count.textContent = `${count.dataset.label}: ${visible}`;
    empty.classList.toggle('is-active', visible === 0);
  }
  function clearFilter() { search.value = ''; tier.value = ''; filter(); }
  function selectStack(id: string, focus = false) {
    if (!panels.some((panel) => panel.dataset.stackPanel === id)) return;
    panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.stackPanel === id));
    choices.forEach((choice) => {
      if (choice.dataset.stackChoice === id) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    });
    if (focus) document.querySelector<HTMLElement>(`#stack-title-${id}`)?.focus({ preventScroll:true });
  }
  function openHash() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('method-')) {
      const target = methods.find((method) => method.id === hash);
      if (target) {
        clearFilter(); target.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ block:'start' }));
      }
    } else if (hash.startsWith('stack-')) {
      selectStack(hash.slice(6));
      const target = panels.find((panel) => panel.id === hash);
      requestAnimationFrame(() => target?.scrollIntoView({ block:'start' }));
    }
    else if (hash.startsWith('source-')) {
      const target = document.getElementById(hash);
      const disclosure = target?.closest('details');
      if (disclosure) {
        disclosure.open = true;
        requestAnimationFrame(() => target?.scrollIntoView({ block:'start' }));
      }
    }
  }
  choices.forEach((choice) => choice.addEventListener('click', () => selectStack(choice.dataset.stackChoice!, true)));
  root.querySelectorAll<HTMLAnchorElement>('[data-framework-link]').forEach((link) => link.addEventListener('click', () => {
    const target = methods.find((method) => `#${method.id}` === link.hash);
    if (target) { clearFilter(); target.open = true; }
  }));
  search.addEventListener('input', filter);
  tier.addEventListener('change', filter);
  root.querySelector('[data-framework-clear]')?.addEventListener('click', () => { clearFilter(); search.focus(); });
  window.addEventListener('hashchange', openHash);
  selectStack(panels[0]?.dataset.stackPanel ?? '');
  root.dataset.enhanced = 'true';
  filter(); openHash();

  const form = root.querySelector<HTMLFormElement>('[data-workbook]')!;
  const fields = [...form.querySelectorAll<HTMLTextAreaElement>('textarea')];
  const status = form.querySelector<HTMLElement>('[data-plan-status]')!;
  const key = 'framework-guide-plan-v1';
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    fields.forEach((field) => { if (typeof saved[field.name] === 'string') field.value = saved[field.name].slice(0,50000); });
  } catch { storageAvailable = false; status.textContent = form.dataset.unavailable!; }
  let timer: ReturnType<typeof setTimeout>;
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, field.value]))));
      storageAvailable = true;
      status.textContent = form.dataset.saved!;
    } catch { storageAvailable = false; status.textContent = form.dataset.unavailable!; }
  }
  form.addEventListener('submit', (event) => event.preventDefault());
  fields.forEach((field) => field.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(persist,350); }));
  form.querySelector('[data-plan-save]')?.addEventListener('click', () => {
    if (!fields.some((field) => field.value.trim())) { status.textContent = form.dataset.empty!; fields[0]?.focus(); return; }
    const text = [form.dataset.title, ...fields.map((field) => `${field.closest('label')?.querySelector('span')?.textContent?.trim()}\n${field.value.trim() || '—'}`)].join('\n\n');
    const blob = new Blob(['\uFEFF' + text + '\n'], { type:'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = href; link.download = form.dataset.filename!;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href),1000);
    status.textContent = form.dataset.downloaded!;
  });
  form.querySelector('[data-plan-reset]')?.addEventListener('click', () => {
    clearTimeout(timer); fields.forEach((field) => { field.value = ''; });
    try { localStorage.removeItem(key); } catch { storageAvailable = false; }
    status.textContent = storageAvailable ? form.dataset.cleared! : form.dataset.unavailable!;
    fields[0]?.focus();
  });
}
