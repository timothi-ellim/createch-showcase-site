const KEY = 'createch-shortlist-v1';
const sampleLabel = document.body.dataset.synthetic === 'true' ? 'sample ' : '';
const buttons = [
  ...document.querySelectorAll<HTMLButtonElement>('[data-save]'),
];
const knownIds = new Set(buttons.map((button) => button.dataset.save!));
const shortlist = document.querySelector('#shortlist');
let saved = new Set<string>();
let storageAvailable = true;
let notice = '';
let undoSaved: Set<string> | null = null;
let timer: ReturnType<typeof setTimeout>;

function announce(message: string) {
  const status = document.querySelector<HTMLElement>('#status');
  if (!status) return;
  clearTimeout(timer);
  status.textContent = message;
  timer = setTimeout(() => {
    status.textContent = '';
  }, 6500);
}
function readStorage() {
  notice = '';
  storageAvailable = true;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id) => typeof id === 'string') ||
      parsed.length > 1000
    )
      throw new SyntaxError('Invalid shortlist');
    saved = new Set(parsed);
  } catch (error) {
    saved = new Set();
    if (error instanceof SyntaxError)
      notice =
        'Your saved list could not be read. No projects are shown as saved. Save a project or clear the list to start again.';
    else {
      storageAvailable = false;
      notice =
        'Browser storage is unavailable. Your shortlist cannot be loaded or saved. You can still browse every project.';
    }
  }
}
function renderSaved() {
  for (const button of buttons) {
    const selected = saved.has(button.dataset.save!);
    button.hidden = false;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute(
      'aria-label',
      `${selected ? 'Remove' : 'Save'} ${button.dataset.title} ${selected ? 'from' : 'to'} my visit`,
    );
    button.textContent = selected
      ? '✓ Saved · Remove'
      : button.classList.contains('save-button')
        ? '＋ Save'
        : 'Save to my visit';
  }
  document
    .querySelectorAll<HTMLElement>('[data-saved-count]')
    .forEach((count) => {
      count.textContent = saved.size ? String(saved.size) : '';
    });
  if (!shortlist) return;
  const unavailable = [...saved].filter((id) => !knownIds.has(id));
  const cards = [
    ...shortlist.querySelectorAll<HTMLElement>('[data-project-card]'),
  ];
  let visible = 0;
  for (const card of cards) {
    card.hidden = !saved.has(card.dataset.id!);
    if (!card.hidden) visible++;
  }
  document.querySelector<HTMLElement>('#shortlist-empty')!.hidden = visible > 0;
  document.querySelector<HTMLElement>('.shortlist-toolbar')!.hidden = false;
  document.querySelector<HTMLElement>('#shortlist-count')!.textContent =
    `${visible} saved ${visible === 1 ? 'project' : 'projects'}`;
  document.querySelector<HTMLElement>('#storage-notice')!.textContent = [
    notice,
    unavailable.length
      ? `${unavailable.length} saved ${unavailable.length === 1 ? 'project is' : 'projects are'} no longer in this catalogue. You can remove unavailable entries and keep your other saves.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  document.querySelector<HTMLButtonElement>('[data-clear-saved]')!.disabled =
    !saved.size && !notice;
  document.querySelector<HTMLButtonElement>('[data-print]')!.disabled =
    visible === 0;
  document.querySelector<HTMLElement>('[data-remove-unavailable]')!.hidden =
    unavailable.length === 0;
  document.querySelector<HTMLElement>('[data-shortlist-undo]')!.hidden =
    undoSaved === null;
  updateProjectLinks();
}
function updateProjectLinks() {
  if (!shortlist && !document.querySelector('#filters')) return;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    '[data-project-link]',
  )) {
    const card = link.closest<HTMLElement>('[data-project-card]')!;
    const destination = new URL(link.href);
    destination.searchParams.set(
      'from',
      `${location.pathname}${location.search}#${card.id}`,
    );
    link.href = destination.href;
  }
}
function focusShortlist() {
  const nextButton = [
    ...document.querySelectorAll<HTMLButtonElement>('#shortlist [data-save]'),
  ].find((item) => !item.closest<HTMLElement>('[data-project-card]')!.hidden);
  (
    nextButton ??
    document.querySelector<HTMLAnchorElement>('#shortlist-empty a')
  )?.focus();
}
function writeSaved(next: Set<string>, message: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
    saved = next;
    storageAvailable = true;
    notice = '';
    renderSaved();
    announce(message);
    return true;
  } catch {
    storageAvailable = false;
    notice =
      'Your change was not saved: browser storage is unavailable or full. You can still browse projects.';
    renderSaved();
    announce(notice);
    return false;
  }
}
readStorage();
renderSaved();
if (!storageAvailable || notice) announce(notice);
for (const button of buttons)
  button.addEventListener('click', () => {
    const next = new Set(saved);
    const previous = new Set(saved);
    const id = button.dataset.save!;
    const removing = next.delete(id);
    if (!removing) next.add(id);
    const changed = writeSaved(
      next,
      removing
        ? `Project removed from your shortlist.${shortlist ? ' Undo is available on this page.' : ''}`
        : 'Project saved on this device. This is not a booking.',
    );
    document.dispatchEvent(
      new CustomEvent('createch:save-feedback', {
        detail: {
          target: changed ? button : null,
          saved: changed && !removing,
        },
      }),
    );
    if (changed && removing && shortlist) {
      undoSaved = previous;
      renderSaved();
      focusShortlist();
    }
  });
document.querySelector('[data-clear-saved]')?.addEventListener('click', () => {
  const previous = new Set(saved);
  if (
    writeSaved(
      new Set(),
      `Your shortlist has been cleared from this browser.${previous.size ? ' Undo is available on this page.' : ''}`,
    )
  ) {
    undoSaved = previous.size ? previous : null;
    renderSaved();
    focusShortlist();
  }
});
document
  .querySelector('[data-remove-unavailable]')
  ?.addEventListener('click', () => {
    const previous = new Set(saved);
    if (
      writeSaved(
        new Set([...saved].filter((id) => knownIds.has(id))),
        'Unavailable entries removed. Your other saved projects are unchanged.',
      )
    ) {
      undoSaved = previous;
      renderSaved();
      focusShortlist();
    }
  });
document.querySelector('[data-undo-saved]')?.addEventListener('click', () => {
  if (
    undoSaved &&
    writeSaved(undoSaved, 'Your previous shortlist has been restored.')
  ) {
    undoSaved = null;
    renderSaved();
    focusShortlist();
  }
});
document
  .querySelector('[data-print]')
  ?.addEventListener('click', () => window.print());
window.addEventListener('storage', (event) => {
  if (event.key === KEY || event.key === null) {
    undoSaved = null;
    readStorage();
    renderSaved();
    const focusedCard = document.activeElement?.closest<HTMLElement>(
      '[data-project-card]',
    );
    if (shortlist && focusedCard?.hidden) focusShortlist();
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    undoSaved = null;
    readStorage();
    renderSaved();
  }
});

const filters = document.querySelector<HTMLFormElement>('#filters');
if (filters) {
  filters.hidden = false;
  const search = document.querySelector<HTMLInputElement>('#search')!;
  const params = new URLSearchParams(location.search);
  let theme = ['image', 'world', 'relation'].includes(params.get('theme') ?? '')
    ? params.get('theme')!
    : 'all';
  let encounter = ['Look / listen', 'Participate'].includes(
    params.get('encounter') ?? '',
  )
    ? params.get('encounter')!
    : 'all';
  search.value = params.get('q') ?? '';
  const normalizeSearch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const clearSearch = filters.querySelector<HTMLButtonElement>(
    '[data-clear-search]',
  )!;
  function applyFilters(animateChange = false) {
    let count = 0;
    const query = normalizeSearch(search.value);
    document
      .querySelectorAll<HTMLElement>('#project-results [data-project-card]')
      .forEach((card) => {
        const match =
          (theme === 'all' || card.dataset.theme === theme) &&
          (encounter === 'all' ||
            card.dataset.encounters?.split('|').includes(encounter)) &&
          normalizeSearch(card.dataset.search ?? '').includes(query);
        card.hidden = !match;
        if (match) count++;
      });
    filters!
      .querySelectorAll<HTMLButtonElement>('[data-theme-filter]')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.themeFilter === theme),
        ),
      );
    filters!
      .querySelectorAll<HTMLButtonElement>('[data-encounter-filter]')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.encounterFilter === encounter),
        ),
      );
    document.querySelector('#result-count')!.textContent =
      `${count} ${sampleLabel}${count === 1 ? 'project' : 'projects'}`;
    clearSearch.hidden = !search.value;
    const surprise =
      document.querySelector<HTMLButtonElement>('[data-surprise]');
    if (surprise) surprise.disabled = count === 0;
    const jump = document.querySelector<HTMLAnchorElement>(
      '[data-view-results]',
    );
    if (jump)
      jump.textContent = count
        ? `View ${count} ${count === 1 ? 'project' : 'projects'} ↓`
        : 'See no-results advice ↓';
    document.querySelector<HTMLElement>('#no-results')!.hidden = count > 0;
    const url = new URL(location.href);
    for (const [key, value] of [
      ['theme', theme],
      ['encounter', encounter],
      ['q', search.value.trim()],
    ]) {
      if (value && value !== 'all') url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.replaceState(null, '', url);
    updateProjectLinks();
    document.dispatchEvent(
      new CustomEvent('createch:filters-changed', {
        detail: { animate: animateChange },
      }),
    );
  }
  function viewResults() {
    document.querySelector<HTMLElement>('#result-count')?.focus();
    document.querySelector('#result-count')?.scrollIntoView({ block: 'start' });
  }
  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    viewResults();
  });
  document
    .querySelector('[data-view-results]')
    ?.addEventListener('click', (event) => {
      event.preventDefault();
      viewResults();
    });
  filters
    .querySelectorAll<HTMLButtonElement>('[data-theme-filter]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        theme = button.dataset.themeFilter!;
        applyFilters(true);
      }),
    );
  filters
    .querySelectorAll<HTMLButtonElement>('[data-encounter-filter]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        encounter = button.dataset.encounterFilter!;
        applyFilters(true);
      }),
    );
  search.addEventListener('input', () => applyFilters());
  clearSearch.addEventListener('click', () => {
    search.value = '';
    applyFilters();
    search.focus();
  });
  function reset() {
    theme = 'all';
    encounter = 'all';
    search.value = '';
    applyFilters();
  }
  filters.addEventListener('reset', (event) => {
    event.preventDefault();
    reset();
  });
  document
    .querySelector('[data-reset-filters]')
    ?.addEventListener('click', () => {
      reset();
      search.focus();
    });
  applyFilters();
  document.querySelector('[data-surprise]')?.addEventListener('click', () => {
    const matches = [
      ...document.querySelectorAll<HTMLElement>(
        '#project-results [data-project-card]',
      ),
    ].filter((card) => !card.hidden);
    const link =
      matches[
        Math.floor(Math.random() * matches.length)
      ]?.querySelector<HTMLAnchorElement>('h2 a, h3 a');
    if (link) location.assign(link.href);
  });
}
const backLink = document.querySelector<HTMLAnchorElement>(
  '[data-back-to-results]',
);
if (backLink) {
  try {
    const source = new URLSearchParams(location.search).get('from');
    if (source && source.length < 2500) {
      const target = new URL(source, location.origin);
      if (
        target.origin === location.origin &&
        ['/explore/', '/my-visit/'].includes(target.pathname)
      ) {
        backLink.href = target.pathname + target.search + target.hash;
        backLink.textContent =
          target.pathname === '/my-visit/'
            ? '← Back to my visit'
            : '← Back to your results';
      }
    }
  } catch {
    /* Keep the ordinary browse-all link when context is invalid. */
  }
}
if (location.hash.startsWith('#project-')) {
  const returnCard = document.getElementById(location.hash.slice(1));
  if (returnCard?.matches('[data-project-card]') && !returnCard.hidden) {
    requestAnimationFrame(() => returnCard.focus());
  }
}
const copyButton =
  document.querySelector<HTMLButtonElement>('[data-copy-link]');
if (copyButton) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.origin + location.pathname);
      announce(
        document.body.dataset.preview === 'true'
          ? 'Project link copied. This local preview link only works where the preview is running.'
          : 'Project link copied.',
      );
    } catch {
      document.querySelector<HTMLElement>('[data-copy-fallback]')!.hidden =
        false;
      const input = document.querySelector<HTMLInputElement>('#project-url')!;
      input.value = location.origin + location.pathname;
      input.focus();
      input.select();
      announce(
        'Automatic copying is unavailable. The project address is selected for you to copy.',
      );
    }
  });
}
document
  .querySelectorAll<HTMLImageElement>(
    '.project-media img, .process-gallery img',
  )
  .forEach((img) => {
    function failed() {
      const parent = img.closest('.project-media');
      const message = document.createElement('p');
      message.textContent = 'Project image unavailable.';
      if (parent) parent.replaceChildren(message);
      else img.replaceWith(message);
    }
    img.addEventListener('error', failed, { once: true });
    if (img.complete && img.naturalWidth === 0) failed();
  });
