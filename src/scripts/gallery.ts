const viewer = document.querySelector<HTMLDialogElement>(
  '[data-artwork-viewer]',
);
if (viewer && typeof viewer.showModal === 'function') {
  const panels = [...viewer.querySelectorAll<HTMLElement>('[data-artwork]')];
  const previous = viewer.querySelector<HTMLButtonElement>(
    '[data-viewer-previous]',
  )!;
  const next = viewer.querySelector<HTMLButtonElement>('[data-viewer-next]')!;
  const close = viewer.querySelector<HTMLButtonElement>('[data-viewer-close]')!;
  const position = viewer.querySelector<HTMLElement>('[data-viewer-position]')!;
  let selection = panels;
  let index = 0;
  let opener: HTMLElement | null = null;

  function available() {
    const results = document.querySelector('#project-results, #shortlist');
    if (!results) return panels;
    const ids = new Set(
      [...results.querySelectorAll<HTMLElement>('[data-project-card]')]
        .filter((card) => !card.hidden)
        .map((card) => card.dataset.id),
    );
    return panels.filter((panel) => ids.has(panel.dataset.artwork));
  }
  function render() {
    const active = selection[index];
    panels.forEach((panel) => {
      panel.hidden = panel !== active;
    });
    previous.disabled = selection.length < 2;
    next.disabled = selection.length < 2;
    position.textContent = `${index + 1} / ${selection.length} · ${active.getAttribute('aria-label')}`;
    const link = active.querySelector<HTMLAnchorElement>(
      '[data-viewer-project]',
    )!;
    const url = new URL(link.href);
    if (document.querySelector('#project-results, #shortlist')) {
      const card = [
        ...document.querySelectorAll<HTMLElement>(
          '#project-results [data-project-card], #shortlist [data-project-card]',
        ),
      ].find((item) => item.dataset.id === active.dataset.artwork);
      if (card)
        url.searchParams.set(
          'from',
          `${location.pathname}${location.search}#${card.id}`,
        );
    }
    link.href = url.href;
    const img = active.querySelector<HTMLImageElement>('img');
    if (img) {
      const loading = !img.complete;
      const state = active.querySelector<HTMLElement>(
        '[data-viewer-image-state]',
      );
      if (state) state.hidden = !loading;
      img.closest('figure')?.setAttribute('aria-busy', String(loading));
      img.loading = 'eager';
    }
  }
  function move(step: number) {
    index = (index + step + selection.length) % selection.length;
    render();
  }
  for (const trigger of document.querySelectorAll<HTMLButtonElement>(
    '[data-open-gallery], [data-open-artwork]',
  )) {
    trigger.hidden = false;
    trigger.addEventListener('click', () => {
      selection = available();
      if (!selection.length) return;
      index = Math.max(
        0,
        selection.findIndex(
          (panel) => panel.dataset.artwork === trigger.dataset.openArtwork,
        ),
      );
      opener = trigger;
      render();
      viewer.showModal();
      document.documentElement.classList.add('artwork-open');
      close.focus();
    });
  }
  const updateAvailability = () => {
    const empty = available().length === 0;
    document
      .querySelectorAll<HTMLButtonElement>('[data-open-gallery]')
      .forEach((button) => {
        button.disabled = empty;
      });
  };
  document.addEventListener('createch:filters-changed', updateAvailability);
  updateAvailability();
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Tab') {
      const controls = [
        ...viewer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href]',
        ),
      ].filter((control) => control.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  viewer.addEventListener('close', () => {
    document.documentElement.classList.remove('artwork-open');
    if (opener?.getClientRects().length) opener.focus({ preventScroll: true });
    else {
      const fallback = document.querySelector<HTMLElement>(
        '#shortlist [data-project-card]:not([hidden]) [data-save], #shortlist-empty:not([hidden]) a, #result-count',
      );
      fallback?.focus({ preventScroll: true });
    }
  });
  window.addEventListener('pagehide', () => {
    if (viewer.open) viewer.close();
  });
  viewer.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const loaded = () => {
      img.closest('figure')?.setAttribute('aria-busy', 'false');
      const state = img
        .closest('figure')
        ?.querySelector<HTMLElement>('[data-viewer-image-state]');
      if (state) state.hidden = true;
    };
    img.addEventListener('load', loaded);
    const fail = () => {
      if (img.dataset.failed) return;
      img.dataset.failed = 'true';
      loaded();
      img.hidden = true;
      const message = document.createElement('p');
      message.textContent =
        'Image unavailable. You can still read the project below.';
      img.before(message);
    };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}
