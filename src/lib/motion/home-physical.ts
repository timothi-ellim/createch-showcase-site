import { canMove, track } from './preferences';
import { effect } from './physical';
import '../../styles/home-physical.css';

// The homepage transfers input into decorative frames and background geometry.
// All reading, hit areas, artwork and navigation remain in their original places.
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const enabled = () =>
  canMove() &&
  document.documentElement.dataset.motionLevel === 'full' &&
  !document.querySelector('dialog[open]');
const zones = '.hero, .home-themes, .news-social, .home-projects, .welcome-paths';
const plates = new Map<Element, HTMLElement>();
for (const surface of document.querySelectorAll<HTMLElement>(
  '.exhibition-window, .featured-grid .project-card, .theme-tile, .welcome-paths a, .news-links a',
)) {
  surface.dataset.homeSurface = '';
  const plate = document.createElement('span');
  plate.className = 'home-response-plate';
  plate.setAttribute('aria-hidden', 'true');
  surface.append(plate);
  plates.set(surface, plate);
}
let last: Element | null = null;
let pendingPress = 0;
const cancelPress = () => {
  if (pendingPress) cancelAnimationFrame(pendingPress);
  pendingPress = 0;
};
const clear = () => { last = null; };
track(clear);
document.addEventListener('pointercancel', clear);
window.addEventListener('blur', clear);
document.addEventListener('pointercancel', cancelPress);
document.addEventListener('keydown', cancelPress);
window.addEventListener('blur', cancelPress);
window.addEventListener('pagehide', cancelPress);
document.addEventListener('createch:motion-policy', cancelPress);
document.addEventListener('visibilitychange', cancelPress);

function respond(target: Element, press: boolean) {
  if (!enabled()) return;
  const zone = target.closest(zones);
  if (!zone) return;
  const candidates = [...plates].filter(([surface]) => zone.contains(surface))
    .map(([surface, plate]) => ({ surface, plate, rect: surface.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > 0 && rect.top < innerHeight);
  for (const { surface, plate } of candidates) {
    const direct = surface.contains(target);
    effect(plate, [
      { boxShadow: '0 0 0 0px currentColor', opacity: 0 },
      { boxShadow: `${press ? 3 : 7}px ${press ? 3 : 9}px 0 0px currentColor`, opacity: direct ? 0.8 : 0.45, offset: 0.24 },
      { boxShadow: '-1px -1px 0 0px currentColor', opacity: 0.3, offset: 0.68 },
      { boxShadow: '0 0 0 0px currentColor', opacity: 0 },
    ], 'home-frame', press ? 460 : 650, direct ? 0 : 65);
  }
  const ring = zone.querySelector('.backdrop-ring');
  if (ring) effect(ring, [
    { scale: '1', rotate: '0deg', opacity: 0.25 },
    { scale: press ? '0.9' : '1.16', rotate: '9deg', opacity: 0.65, offset: 0.25 },
    { scale: '1.025', rotate: '-2deg', opacity: 0.35, offset: 0.7 },
    { scale: '1', rotate: '0deg', opacity: 0.25 },
  ], 'home-ring', 780);
  const grid = zone.querySelector('.backdrop-grid');
  if (grid) effect(grid, [
    { opacity: 0.45 }, { opacity: 1, offset: 0.25 }, { opacity: 0.45 },
  ], 'home-grid', 650);
}
document.addEventListener('pointerover', (event) => {
  if (event.pointerType === 'touch' || !fine.matches || !(event.target instanceof Element)) return;
  const target = event.target.closest('a, button');
  if (target === last) return;
  last = target;
  if (target) respond(target, false);
});
document.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) clear();
  else if (last && event.relatedTarget instanceof Node && !last.contains(event.relatedTarget)) clear();
});
document.addEventListener('pointerdown', (event) => {
  cancelPress();
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const target = event.target.closest('a, button');
  if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
  // Native focus first settles all existing motion. Start the held-press
  // response on the next frame, only while this target is still active.
  pendingPress = requestAnimationFrame(() => {
    pendingPress = 0;
    if (target.matches(':active')) respond(target, true);
  });
});

// A broad seam carries the section boundary across the page. Only this
// decoration reveals; content is never hidden, staggered or scroll-hijacked.
const sections = document.querySelectorAll<HTMLElement>(
  '.home-map, .home-about, .news-social, .home-projects, .home-themes, .interactive-sketch',
);
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const section = entry.target as HTMLElement;
    section.dataset.homeArrived = '';
    const seam = section.querySelector('.home-section-seam');
    if (seam) effect(seam, [
      { transform: 'scaleX(.04)', opacity: 0.25 },
      { transform: 'scaleX(1)', opacity: 0.9, offset: 0.75 },
      { transform: 'scaleX(1)', opacity: 0.45 },
    ], 'home-seam', 800);
    observer.unobserve(section);
  }
}, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
for (const section of sections) {
  section.dataset.homeSection = '';
  const seam = document.createElement('span');
  seam.className = 'home-section-seam';
  seam.setAttribute('aria-hidden', 'true');
  section.append(seam);
  observer.observe(section);
}
window.addEventListener('pagehide', () => observer.disconnect());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) for (const section of sections) {
    if (!section.hasAttribute('data-home-arrived')) observer.observe(section);
  }
});
