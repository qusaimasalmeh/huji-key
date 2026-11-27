/** Initializes roving-tabindex, RTL-aware arrow keys, and find-in-page sync on a tablist. */
export function initTablist(
  tablistEl: HTMLElement,
  onSelect?: (panelId: string) => void
): void {
  const tabs = Array.from(tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const activate = (target: HTMLButtonElement, moveFocus: boolean) => {
    for (const tab of tabs) {
      const selected = tab === target;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      const panelId = tab.dataset.panel;
      if (panelId) {
        const panel = tablistEl.ownerDocument.getElementById(panelId);
        if (panel) {
          if (selected) {
            panel.removeAttribute('hidden');
            panel.tabIndex = 0;
          } else {
            panel.setAttribute('hidden', 'until-found');
            panel.removeAttribute('tabindex');
          }
        }
      }
    }
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (moveFocus) target.focus();
    if (target.dataset.panel) onSelect?.(target.dataset.panel);
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab, false));
    const panelId = tab.dataset.panel;
    if (panelId) {
      const panel = tablistEl.ownerDocument.getElementById(panelId);
      panel?.addEventListener('beforematch', () => activate(tab, false));
    }
  }

  tablistEl.addEventListener('keydown', (e) => {
    const currentIdx = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    if (currentIdx === -1) return;
    const isRtl = tablistEl.ownerDocument.documentElement.dir === 'rtl';
    let nextIdx = currentIdx;

    if (e.key === 'ArrowRight') {
      nextIdx = isRtl
        ? (currentIdx - 1 + tabs.length) % tabs.length
        : (currentIdx + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = isRtl
        ? (currentIdx + 1) % tabs.length
        : (currentIdx - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const target = tabs[nextIdx];
    if (target) activate(target, true);
  });
}

/** Syncs aria-invalid, dynamic aria-describedby error IDs, and a polite live announcer. */
export function initAccessibleValidation(root: Document): {
  syncField: (el: HTMLInputElement, announceError?: boolean, forceFlag?: boolean) => void;
  announce: (msg: string) => void;
} {
  const announcer = root.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  root.body.appendChild(announcer);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const flagged = new WeakSet<HTMLInputElement>();

  const announce = (msg: string) => {
    clearTimeout(timer);
    announcer.textContent = '';
    timer = setTimeout(() => {
      announcer.textContent = msg;
    }, 80);
  };

  const linkError = (el: HTMLInputElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const syncField = (el: HTMLInputElement, shouldAnnounce = false, forceFlag = false) => {
    if (forceFlag) flagged.add(el);
    let isUserInvalid = false;
    try {
      isUserInvalid = el.matches(':user-invalid');
    } catch {
      isUserInvalid = !el.validity.valid && flagged.has(el);
    }

    if (isUserInvalid || (flagged.has(el) && !el.validity.valid)) {
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      if (shouldAnnounce && el.dataset.error) {
        const errEl = root.getElementById(el.dataset.error);
        if (errEl?.textContent) announce(errEl.textContent.trim());
      }
    } else {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
    }
  };

  const fields = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-error]'));
  for (const el of fields) {
    el.setAttribute('aria-invalid', 'false');
    el.addEventListener('blur', () => {
      flagged.add(el);
      syncField(el, true);
    });
    el.addEventListener('input', () => {
      if (el.getAttribute('aria-invalid') === 'true') syncField(el, false);
    });
    el.addEventListener('change', () => {
      if (el.getAttribute('aria-invalid') === 'true' || flagged.has(el)) syncField(el, false);
    });
    el.addEventListener('invalid', () => {
      flagged.add(el);
      syncField(el, false);
    });
  }

  return { syncField, announce };
}
