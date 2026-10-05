import { readShortlist, SHORTLIST_STORAGE_KEY } from '../lib/shortlist';
import { drawAtlasScenes } from '../lib/atlas-scene-renderer';
import type { AtlasView } from '../lib/atlas-geometry';
import { atlasLandmarks } from '../lib/atlas-landmarks';

const root = document.querySelector<HTMLElement>('[data-exhibition-map]');
if (root) {
  const q = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const all = <T extends HTMLElement>(selector: string) => [
    ...root.querySelectorAll<T>(selector),
  ];
  const cards = all<HTMLElement>('[data-atlas-project]');
  const panel = q<HTMLElement>('.atlas-detail-panel');
  const directory = q<HTMLElement>('.atlas-directory');
  const savedToggle = q<HTMLInputElement>('[data-map-saved]');
  const roomIds = ['gallery', 'ws09', 'ws10'];
  const origins = new Map<HTMLElement, HTMLElement>();
  let selected: HTMLElement | undefined;
  // Hover previews never write history or replace a visitor's pinned choice.
  let committedProject: string | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedProject: string | undefined;
  let room = 'all';
  let view: AtlasView = '2d';
  let turn = 0;
  let landmarkId: string | undefined;
  const searchInput = q<HTMLInputElement>('#atlas-search');

  for (const card of cards) {
    const placeholder = document.createElement('div');
    placeholder.className = 'atlas-directory-placeholder';
    placeholder.hidden = true;
    const link = document.createElement('a');
    link.href = '#installation-' + card.dataset.atlasProject;
    link.textContent = `${card.querySelector('h3')!.textContent} — selected above`;
    placeholder.append(link);
    card.before(placeholder);
    origins.set(card, placeholder);
    card.querySelector<HTMLButtonElement>('[data-map-room-return]')!.hidden =
      false;
  }

  function savedState() {
    // Access to window.localStorage itself can throw, as well as getItem().
    try {
      return readShortlist(window.localStorage);
    } catch {
      return {
        saved: new Set<string>(),
        available: false,
        notice:
          'Browser storage is unavailable. Your shortlist cannot be loaded or saved. You can still browse every project.',
      };
    }
  }
  function refreshSaved() {
    const state = savedState();
    const active = savedToggle.checked;
    q<HTMLElement>('[data-map-storage]').textContent = state.notice;
    savedToggle.disabled = !state.available;
    if (!state.available) savedToggle.checked = false;
    root!.classList.toggle('atlas-show-saved', active && state.available);
    for (const pin of all<HTMLAnchorElement>('[data-map-pin]')) {
      const saved = state.saved.has(pin.dataset.mapPin!);
      pin.classList.toggle('is-saved', saved);
      pin.dataset.workLabel ??= pin.getAttribute('aria-label') ?? '';
      pin.setAttribute(
        'aria-label',
        `${saved ? 'Saved. ' : ''}${pin.dataset.workLabel}`,
      );
      pin.querySelector<HTMLElement>('.atlas-pin-saved')!.hidden = !saved;
    }
    for (const item of all<HTMLAnchorElement>('[data-select-project]')) {
      const badge = item.querySelector<HTMLElement>('.atlas-list-saved');
      if (badge) badge.hidden = !state.saved.has(item.dataset.selectProject!);
    }
    let placedSaved = 0;
    for (const id of roomIds) {
      const count = cards.filter(
        (card) =>
          card.dataset.atlasRoom === id &&
          state.saved.has(card.dataset.atlasProject!),
      ).length;
      placedSaved += count;
      const label = q<HTMLElement>(`[data-room-saved="${id}"]`);
      label.textContent = `${count} saved`;
      label.hidden = !active || !state.available;
      for (const label of all<HTMLElement>(`[data-room-open="${id}"]`))
        label.classList.toggle('has-saved', count > 0 && active);
    }
    const otherSaved = state.saved.size - placedSaved;
    q<HTMLElement>('[data-map-saved-summary]').textContent =
      active && state.available
        ? placedSaved
          ? `${placedSaved} saved on this map${otherSaved ? ` · ${otherSaved} without a mapped position` : ''}`
          : otherSaved
            ? 'Your saved projects do not have positions on this map.'
            : 'No saved projects yet. Select a work to save it.'
        : '';
  }
  function stateUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    if (room !== 'all') url.searchParams.set('room', room);
    if (committedProject) url.searchParams.set('project', committedProject);
    if (landmarkId) url.searchParams.set('landmark', landmarkId);
    if (savedToggle.checked) url.searchParams.set('saved', '1');
    if (view === '3d') url.searchParams.set('view', '3d');
    if (view === '3d' && turn) url.searchParams.set('angle', String(turn));
    return url.pathname + url.search;
  }
  function render(
    nextRoom: string,
    projectId?: string,
    push = true,
    focus = false,
    nextLandmark?: string,
    transient = false,
  ) {
    clearTimeout(previewTimer);
    clearTimeout(dismissTimer);
    if (selected) {
      const origin = origins.get(selected)!;
      origin.after(selected);
      origin.hidden = true;
      selected.classList.remove('atlas-selected-project');
    }
    selected = projectId
      ? cards.find((card) => card.dataset.atlasProject === projectId)
      : undefined;
    if (!transient) committedProject = selected?.dataset.atlasProject;
    root!.dataset.previewMode = selected
      ? transient
        ? 'hover'
        : 'pinned'
      : 'none';
    room =
      selected?.dataset.atlasRoom ??
      (roomIds.includes(nextRoom) ? nextRoom : 'all');
    const landmark =
      !selected && room === 'all'
        ? atlasLandmarks.find((item) => item.id === nextLandmark)
        : undefined;
    landmarkId = landmark?.id;
    q<HTMLElement>('[data-overview]').hidden = room !== 'all';
    q<HTMLElement>('[data-map-welcome]').hidden = room !== 'all' || !!landmark;
    q<HTMLElement>('[data-landmark-detail]').hidden = !landmark;
    q<HTMLElement>('[data-map-breadcrumb]').hidden = room === 'all';
    q<HTMLElement>('[data-breadcrumb-room]').textContent =
      room === 'gallery' ? 'Gallery' : room.toUpperCase();
    q<HTMLElement>('[data-map-hint]').textContent =
      room === 'all'
        ? 'Choose a room to discover the work inside'
        : committedProject
          ? 'Work selected · Choose another image, or close the preview'
          : matchMedia('(hover: hover) and (pointer: fine)').matches
            ? 'Hover to preview · Click to keep a work open'
            : 'Tap an artwork to meet the artist & explore the work';
    for (const link of all<HTMLElement>('[data-landmark-open]')) {
      if (link.dataset.landmarkOpen === landmarkId)
        link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    if (landmark) {
      q<HTMLElement>('[data-landmark-title]').textContent = landmark.label;
      q<HTMLElement>('[data-landmark-description]').textContent =
        landmark.description;
      q<HTMLElement>('[data-landmark-note]').textContent =
        'note' in landmark ? landmark.note : '';
      const source = q<HTMLAnchorElement>('[data-landmark-source]');
      source.hidden = !('source' in landmark);
      if ('source' in landmark) source.href = landmark.source;
      else source.removeAttribute('href');
    }
    for (const plan of all<HTMLElement>('[data-room-plan]'))
      plan.hidden = plan.dataset.roomPlan !== room;
    for (const detail of all<HTMLElement>('[data-room-detail]'))
      detail.hidden = detail.dataset.roomDetail !== room || !!selected;
    for (const button of all<HTMLButtonElement>('[data-room]'))
      button.setAttribute('aria-pressed', String(button.dataset.room === room));
    for (const pin of all<HTMLAnchorElement>(
      '[data-map-pin], [data-select-project]',
    )) {
      if (
        (pin.dataset.mapPin ?? pin.dataset.selectProject) ===
        selected?.dataset.atlasProject
      )
        pin.setAttribute('aria-current', 'true');
      else pin.removeAttribute('aria-current');
    }
    const label =
      room === 'all'
        ? 'Overview'
        : room === 'gallery'
          ? 'Gallery'
          : room.toUpperCase();
    q<HTMLElement>('[data-map-label]').textContent = `Canopy / ${label}`;
    if (selected) {
      origins.get(selected)!.hidden = false;
      selected.classList.add('atlas-selected-project');
      panel.prepend(selected);
    }
    for (const card of cards) {
      card.querySelector<HTMLElement>('[data-preview-bar]')!.hidden =
        card !== selected;
      card.querySelector<HTMLElement>('[data-preview-state]')!.textContent =
        transient
          ? 'A closer look · Click artwork to keep open'
          : 'Selected work';
    }
    for (const next of all<HTMLElement>('[data-work-next]'))
      next.hidden = !next.closest('.atlas-selected-project');
    root!.dataset.mapView = view;
    for (const button of all<HTMLButtonElement>('[data-map-view]'))
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.mapView === view),
      );
    q<HTMLElement>('[data-camera-controls]').hidden = view !== '3d';
    q<HTMLElement>('[data-projection-label]').textContent =
      view === '3d'
        ? '3D cutaway · Heights illustrative'
        : '2D plan · Not to scale';
    if (
      push &&
      !transient &&
      stateUrl() !== location.pathname + location.search
    )
      history.pushState(null, '', stateUrl());
    for (const card of cards) {
      const link = card.querySelector<HTMLAnchorElement>(
        '[data-atlas-profile]',
      )!;
      const url = new URL(link.href);
      const back = new URL('/map/', location.origin);
      back.searchParams.set('project', card.dataset.atlasProject!);
      if (savedToggle.checked) back.searchParams.set('saved', '1');
      if (view === '3d') back.searchParams.set('view', '3d');
      if (view === '3d' && turn) back.searchParams.set('angle', String(turn));
      url.searchParams.set('from', back.pathname + back.search);
      link.href = url.pathname + url.search;
    }
    q<HTMLElement>('[data-map-status]').textContent =
      projectId && !selected
        ? 'That project has no proposed position in this preview. Browse the directory below.'
        : selected
          ? `${selected.querySelector('h3')!.textContent} by ${selected.querySelector('.atlas-maker')!.textContent}. Proposed in ${label}.`
          : landmark
            ? `${landmark.label}. ${landmark.description}`
            : `${label}${room !== 'all' ? `. ${cards.filter((card) => card.dataset.atlasRoom === room).length} works. Choose an image or an artist.` : '. Choose a space.'}`;
    refreshSaved();
    drawAtlasScenes(root!, view, turn);
    if (focus) {
      const heading =
        selected?.querySelector<HTMLElement>('h3') ??
        (landmark
          ? panel.querySelector<HTMLElement>('[data-landmark-title]')
          : null) ??
        (room !== 'all' ? q<HTMLElement>('[data-map-label]') : null) ??
        panel.querySelector<HTMLElement>('h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        if (matchMedia('(max-width: 960px)').matches)
          heading.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }
  function fromUrl() {
    const params = new URLSearchParams(location.search);
    savedToggle.checked = params.get('saved') === '1';
    view = params.get('view') === '3d' ? '3d' : '2d';
    const angle = params.get('angle') ?? '0';
    turn = /^[0-3]$/.test(angle) ? Number(angle) : 0;
    render(
      params.get('room') ?? 'all',
      params.get('project') ?? undefined,
      false,
      false,
      params.get('landmark') ?? undefined,
    );
  }
  function search() {
    const value = searchInput.value.trim().toLocaleLowerCase();
    const terms = value.split(/\s+/);
    let count = 0;
    for (const result of all<HTMLElement>('[data-search-result]')) {
      const match = terms.every((term) =>
        result.dataset.searchText!.includes(term),
      );
      result.hidden = !match;
      if (match) count++;
    }
    q<HTMLElement>('#atlas-search-results').hidden = !value || !count;
    q<HTMLButtonElement>('[data-search-clear]').hidden = !value;
    q<HTMLElement>('[data-search-count]').textContent = !value
      ? ''
      : count
        ? `${count} ${count === 1 ? 'work' : 'works'} found. Select one to explore.`
        : 'No matches. Try another artist, title or keyword.';
  }
  function clearSearch() {
    searchInput.value = '';
    search();
  }
  searchInput.addEventListener('input', search);
  q<HTMLButtonElement>('[data-search-clear]').addEventListener('click', () => {
    clearSearch();
    searchInput.focus();
  });
  root.addEventListener('click', (event) => {
    if (
      !(event.target instanceof Element) ||
      (event instanceof MouseEvent &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))
    )
      return;
    const projection = event.target.closest<HTMLButtonElement>(
      'button[data-map-view], [data-camera-turn], [data-camera-reset]',
    );
    if (projection) {
      if (projection.dataset.mapView)
        view = projection.dataset.mapView === '3d' ? '3d' : '2d';
      if (projection.dataset.cameraTurn)
        turn = (turn + Number(projection.dataset.cameraTurn) + 4) % 4;
      if (projection.hasAttribute('data-camera-reset')) turn = 0;
      render(room, committedProject, true, false, landmarkId);
      q<HTMLElement>('[data-map-status]').textContent =
        `${view === '3d' ? '3D cutaway' : '2D plan'} selected${view === '3d' ? `. Camera angle ${turn + 1} of 4. Heights are illustrative.` : '.'}`;
      return;
    }
    const navigation = event.target.closest<HTMLElement>(
      '[data-landmark-open], [data-map-overview], [data-discover-work], [data-work-step], [data-preview-close]',
    );
    if (navigation) {
      event.preventDefault();
      clearSearch();
      if (navigation.hasAttribute('data-preview-close')) {
        closePreview(true);
        return;
      }
      if (navigation.dataset.landmarkOpen)
        render('all', undefined, true, true, navigation.dataset.landmarkOpen);
      else if (navigation.hasAttribute('data-map-overview')) {
        render('all');
        const overview = q<HTMLButtonElement>('[data-room="all"]');
        overview.focus({ preventScroll: true });
        overview.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else {
        const choices = navigation.hasAttribute('data-work-step')
          ? cards.filter((card) => card.dataset.atlasRoom === room)
          : cards.filter((card) => card !== selected);
        const index = navigation.dataset.workStep
          ? (choices.indexOf(selected!) +
              Number(navigation.dataset.workStep) +
              choices.length) %
            choices.length
          : Math.floor(Math.random() * choices.length);
        if (choices[index])
          render(room, choices[index].dataset.atlasProject, true, true);
      }
      return;
    }
    const trigger = event.target.closest<HTMLElement>(
      '[data-room], [data-room-open], [data-map-pin], [data-select-project], [data-map-room-return]',
    );
    if (!trigger) return;
    event.preventDefault();
    clearSearch();
    if (trigger.dataset.mapRoomReturn) {
      const id = selected?.dataset.atlasProject;
      dismissedProject = id;
      render(trigger.dataset.mapRoomReturn);
      const pin = root!.querySelector<HTMLElement>(`[data-map-pin="${id}"]`);
      pin?.focus({ preventScroll: true });
      pin?.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else if (trigger.dataset.mapPin || trigger.dataset.selectProject) {
      dismissedProject = undefined;
      render(
        room,
        trigger.dataset.mapPin ?? trigger.dataset.selectProject,
        true,
        true,
      );
    } else
      render(
        trigger.dataset.room ?? trigger.dataset.roomOpen ?? 'all',
        undefined,
        true,
        !!trigger.dataset.roomOpen,
      );
  });
  root.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      event.target === searchInput &&
      searchInput.value
    ) {
      clearSearch();
      return;
    }
    if (event.key === 'Escape' && landmarkId) {
      const previous = root.querySelector<HTMLElement>(
        `[data-overview] [data-landmark-open="${landmarkId}"]`,
      );
      render('all');
      previous?.focus();
      return;
    }
    if (event.key !== 'Escape' || !selected) return;
    closePreview(true);
  });
  savedToggle.addEventListener('change', () =>
    render(room, committedProject, true, false, landmarkId),
  );
  function closePreview(returnFocus = false) {
    const id = selected?.dataset.atlasProject;
    dismissedProject = id;
    const wasPinned = !!committedProject;
    render(room, undefined, wasPinned);
    if (returnFocus && id) {
      const pin = q<HTMLElement>(`[data-map-pin="${id}"]`);
      pin.focus({ preventScroll: true });
      if (matchMedia('(max-width: 960px)').matches)
        pin.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
  function previewWork(pin: HTMLElement, keyboard = false) {
    clearTimeout(previewTimer);
    clearTimeout(dismissTimer);
    const id = pin.dataset.mapPin;
    if (committedProject || !id || dismissedProject === id) return;
    if (selected?.dataset.atlasProject === id) return;
    const show = () => render(room, id, false, false, undefined, true);
    if (keyboard) show();
    else previewTimer = setTimeout(show, 140);
  }
  function scheduleDismiss() {
    clearTimeout(previewTimer);
    clearTimeout(dismissTimer);
    // A generous bridge lets the pointer travel from a marker to its actions.
    dismissTimer = setTimeout(() => {
      if (committedProject || !selected) return;
      const focus = document.activeElement;
      if (panel.contains(focus) || focus?.closest('[data-map-pin]')) return;
      render(room, undefined, false);
    }, 450);
  }
  const highlightWork = (target: EventTarget | null) => {
    const link =
      target instanceof Element
        ? target.closest<HTMLElement>('[data-map-pin], [data-select-project]')
        : null;
    const id = link?.dataset.mapPin ?? link?.dataset.selectProject;
    for (const item of all<HTMLElement>(
      '[data-map-pin], [data-select-project]',
    ))
      item.classList.toggle(
        'is-linked-active',
        !!id && (item.dataset.mapPin ?? item.dataset.selectProject) === id,
      );
  };
  root.addEventListener('pointerover', (event) => {
    highlightWork(event.target);
    if (
      event.pointerType !== 'mouse' ||
      !matchMedia('(hover: hover) and (pointer: fine)').matches
    )
      return;
    if (!(event.target instanceof Element)) return;
    const pin = event.target.closest<HTMLElement>('[data-map-pin]');
    if (pin) previewWork(pin);
    else if (panel.contains(event.target)) clearTimeout(dismissTimer);
  });
  root.addEventListener('pointerout', (event) => {
    highlightWork(event.relatedTarget);
    if (event.pointerType !== 'mouse') return;
    const destination =
      event.relatedTarget instanceof Element ? event.relatedTarget : null;
    const from =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-map-pin]')
        : null;
    if (from && !from.contains(destination)) dismissedProject = undefined;
    if (destination?.closest('[data-map-pin]') || panel.contains(destination))
      return;
    scheduleDismiss();
  });
  root.addEventListener('focusin', (event) => {
    highlightWork(event.target);
    if (!(event.target instanceof Element)) return;
    const pin = event.target.closest<HTMLElement>('[data-map-pin]');
    if (pin && pin.matches(':focus-visible')) previewWork(pin, true);
    if (panel.contains(event.target)) clearTimeout(dismissTimer);
  });
  root.addEventListener('focusout', (event) => {
    highlightWork(event.relatedTarget);
    const destination =
      event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (destination?.closest('[data-map-pin]') || panel.contains(destination))
      return;
    dismissedProject = undefined;
    scheduleDismiss();
  });
  const updateSaved = () => {
    refreshSaved();
    drawAtlasScenes(root, view, turn);
  };
  document.addEventListener('createch:save-feedback', updateSaved);
  window.addEventListener('storage', (event) => {
    if (event.key === SHORTLIST_STORAGE_KEY || event.key === null)
      updateSaved();
  });
  window.addEventListener('popstate', fromUrl);
  window.addEventListener('pageshow', updateSaved);
  for (const img of all<HTMLImageElement>('.atlas-project-art img')) {
    const fail = () => {
      const message = document.createElement('p');
      message.className = 'atlas-image-error';
      message.textContent =
        'Project image unavailable. You can still explore the project below.';
      img.replaceWith(message);
    };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  }
  for (const img of all<HTMLImageElement>('.atlas-artwork img')) {
    const fail = () => {
      if (!img.isConnected) return;
      const text = document.createElement('span');
      text.textContent = 'Image unavailable';
      img.parentElement!.classList.add('atlas-artwork-type');
      img.replaceWith(text);
    };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  }
  root.classList.add('atlas-enhanced');
  q<HTMLElement>('[data-map-controls]').hidden = false;
  q<HTMLElement>('[data-view-controls]').hidden = false;
  q<HTMLElement>('[data-map-search]').hidden = false;
  for (const button of all<HTMLButtonElement>('[data-discover-work]'))
    button.hidden = false;
  fromUrl();
  const resize = new ResizeObserver(() => drawAtlasScenes(root, view, turn));
  for (const scene of all<HTMLElement>('[data-atlas-scene]'))
    resize.observe(scene);
  // Keep the text directory available as an equal route into the catalogue.
  directory.setAttribute('data-map-directory-ready', 'true');
}
