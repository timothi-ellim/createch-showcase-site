// Supplementary previews; all facility information also exists in linked text.
for (const marker of document.querySelectorAll<HTMLElement>(
  '.atlas-facility',
)) {
  marker.addEventListener('pointerleave', () =>
    marker.classList.remove('is-tooltip-dismissed'),
  );
  marker.addEventListener('focusout', () =>
    marker.classList.remove('is-tooltip-dismissed'),
  );
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape')
    for (const marker of document.querySelectorAll('.atlas-facility'))
      marker.classList.add('is-tooltip-dismissed');
});
