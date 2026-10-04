for (const group of document.querySelectorAll<HTMLElement>(
  '[data-share-links]',
)) {
  const preview = document.body.dataset.preview === 'true';
  const url = preview
    ? new URL(new URL(group.dataset.shareUrl!).pathname, location.origin).href
    : group.dataset.shareUrl!;
  group.querySelector<HTMLInputElement>('input')!.value = url;
  const email = group.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
  email.href = `mailto:?subject=${encodeURIComponent(group.dataset.shareTitle!)}&body=${encodeURIComponent(`${group.dataset.shareText}\n\n${url}`)}`;
  const feedback = group.querySelector<HTMLElement>('[data-share-feedback]')!;
  const fallback = () => {
    group.querySelector<HTMLDetailsElement>('[data-share-fallback]')!.open =
      true;
    const input = group.querySelector<HTMLInputElement>('input')!;
    input.focus();
    input.select();
    feedback.textContent =
      'Automatic sharing is unavailable. The address is selected for you to copy.';
  };
  const copy = group.querySelector<HTMLButtonElement>('[data-share-copy]')!;
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      feedback.textContent =
        document.body.dataset.preview === 'true'
          ? 'Local preview link copied. It only works where this preview is running.'
          : 'Link copied.';
    } catch {
      fallback();
    }
  });
  const share = group.querySelector<HTMLButtonElement>('[data-native-share]')!;
  if (navigator.share) {
    share.hidden = false;
    share.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: group.dataset.shareTitle,
          text: group.dataset.shareText,
          url,
        });
        feedback.textContent = 'Share options closed.';
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          fallback();
      }
    });
  }
}
