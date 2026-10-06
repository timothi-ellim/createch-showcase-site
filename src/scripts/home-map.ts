import { drawAtlasScenes } from '../lib/atlas-scene-renderer';
import type { AtlasView } from '../lib/atlas-geometry';

const home = document.querySelector<HTMLElement>('[data-home-map]');
if (home) {
  const drawing = home.querySelector<HTMLElement>('.home-map-visual')!;
  const controls = home.querySelector<HTMLElement>('[data-home-map-controls]')!;
  let view: AtlasView = '2d';
  let room: string | undefined;
  const previews = [
    ...home.querySelectorAll<HTMLElement>('[data-home-room-preview]'),
  ];
  function preview(id?: string) {
    room = previews.some((el) => el.dataset.homeRoomPreview === id)
      ? id
      : undefined;
    for (const item of previews)
      item.hidden = item.dataset.homeRoomPreview !== room;
    home!.querySelector<HTMLElement>('[data-home-map-prompt]')!.hidden = !!room;
    for (const item of drawing.querySelectorAll<HTMLElement | SVGElement>(
      '[data-room-open]',
    ))
      item.classList.toggle(
        'is-home-room-active',
        item.dataset.roomOpen === room && !!room,
      );
  }
  function links() {
    for (const link of home!.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/explore/"]',
    )) {
      const url = new URL(link.getAttribute('href')!, location.href);
      if (view === '3d') url.searchParams.set('view', '3d');
      else url.searchParams.delete('view');
      link.setAttribute('href', url.pathname + url.search);
    }
  }
  function draw() {
    drawAtlasScenes(drawing, view, 0);
    preview(room);
  }
  const roomFor = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>(
          '[data-room-open], [data-home-room-link], [data-home-room-preview]',
        )
      : null;
  home.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const item = roomFor(event.target);
    if (item)
      preview(
        item.dataset.roomOpen ??
          item.dataset.homeRoomLink ??
          item.dataset.homeRoomPreview,
      );
  });
  home.addEventListener('focusin', (event) => {
    const item = roomFor(event.target);
    if (item)
      preview(
        item.dataset.roomOpen ??
          item.dataset.homeRoomLink ??
          item.dataset.homeRoomPreview,
      );
  });
  home.addEventListener('pointerleave', () => {
    if (!home.contains(document.activeElement)) preview();
  });
  home.addEventListener('focusout', (event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !home.contains(event.relatedTarget)
    )
      preview();
  });
  home.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') preview();
  });
  home.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-home-map-view]');
    if (button) {
      view = button.dataset.homeMapView === '3d' ? '3d' : '2d';
      drawing.dataset.mapView = view;
      for (const option of controls.querySelectorAll<HTMLElement>('button'))
        option.setAttribute('aria-pressed', String(option === button));
      links();
      draw();
      return;
    }
    const floor = event.target.closest<SVGElement>(
      '[data-scene-faces] [data-room-open]',
    );
    if (floor) {
      const link = home.querySelector<HTMLAnchorElement>(
        `[data-home-room-link="${floor.dataset.roomOpen}"]`,
      );
      if (link) location.assign(link.href);
    }
  });
  controls.hidden = false;
  draw();
  new ResizeObserver(draw).observe(
    drawing.querySelector<HTMLElement>('[data-atlas-scene]')!,
  );
}
