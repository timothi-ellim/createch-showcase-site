const page = document.querySelector<HTMLElement>('[data-explore-page]');
if (page && page.querySelector('[data-explore-mode="map"]')) {
  const links = [
    ...page.querySelectorAll<HTMLAnchorElement>('[data-explore-mode]'),
  ];
  const panels = [
    ...page.querySelectorAll<HTMLElement>('[data-explore-panel]'),
  ];
  function show(mode: string) {
    for (const panel of panels)
      panel.hidden = panel.dataset.explorePanel !== mode;
    for (const link of links) {
      if (link.dataset.exploreMode === mode)
        link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    page!.dataset.exploreView = mode;
    document.dispatchEvent(new CustomEvent('createch:explore-view-changed'));
  }
  function fromUrl() {
    const params = new URLSearchParams(location.search);
    const mapContext = [
      'room',
      'project',
      'view',
      'angle',
      'landmark',
      'saved',
    ].some((key) => params.has(key));
    const mapHash =
      /^(#explore-map|#atlas-|#directory-|#installation-|#landmark-)/.test(
        location.hash,
      );
    show(
      mapHash
        ? 'map'
        : /^(#explore-projects|#project-)/.test(location.hash) || params.get('mode') === 'projects'
        ? 'projects'
        : params.get('mode') === 'map' || mapContext
          ? 'map'
          : 'projects',
    );
  }
  for (const link of links)
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      const mode = link.dataset.exploreMode!;
      const url = new URL(location.href);
      url.searchParams.set('mode', mode);
      url.hash = '';
      if (url.href !== location.href) history.pushState(null, '', url);
      show(mode);
    });
  // Anchors remain useful when JavaScript is unavailable. With enhancement,
  // directory/project fragment links can also reveal their containing view.
  window.addEventListener('hashchange', () => {
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    const panel = target?.closest<HTMLElement>('[data-explore-panel]');
    if (panel) {
      show(panel.dataset.explorePanel!);
      target?.scrollIntoView({ block: 'start' });
    }
  });
  window.addEventListener('popstate', fromUrl);
  fromUrl();
}
