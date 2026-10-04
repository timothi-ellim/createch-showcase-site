document
  .querySelectorAll<HTMLElement>('[data-event-reader]')
  .forEach((reader) => {
    const control = reader.querySelector<HTMLButtonElement>(
      '[data-reading-size]',
    );
    control?.addEventListener('click', () => {
      const larger = !reader.hasAttribute('data-large-text');
      reader.toggleAttribute('data-large-text', larger);
      control.setAttribute('aria-pressed', String(larger));
    });
    if (control) control.hidden = false;
    const passages = [
      ...reader.querySelectorAll<HTMLElement>('[data-reading-passage]'),
    ];
    const links = [
      ...reader.querySelectorAll<HTMLAnchorElement>('.reading-chapters a'),
    ];
    const setCurrent = (index: number) => {
      passages.forEach((passage, position) =>
        passage.toggleAttribute('data-reading-current', position === index),
      );
      links.forEach((link, position) => {
        if (position === index) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };
    // Native links retain scrolling, focus and history with or without JavaScript.
    links.forEach((link, index) =>
      link.addEventListener('click', () => setCurrent(index)),
    );
    if ('IntersectionObserver' in window) {
      const visible = new Set<Element>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          }
          const marker = window.innerHeight * 0.32;
          const atMarker = passages.findIndex((passage) => {
            const bounds = passage.getBoundingClientRect();
            return bounds.top <= marker && bounds.bottom > marker;
          });
          const current =
            atMarker !== -1
              ? atMarker
              : passages.findIndex((passage) => visible.has(passage));
          if (current !== -1) setCurrent(current);
        },
        { rootMargin: '-18% 0px -42% 0px', threshold: 0 },
      );
      passages.forEach((passage) => observer.observe(passage));
      window.addEventListener('pagehide', () => observer.disconnect());
      window.addEventListener('pageshow', () =>
        passages.forEach((passage) => observer.observe(passage)),
      );
    }
  });
