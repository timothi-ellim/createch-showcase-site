for (const group of document.querySelectorAll<HTMLElement>('[data-copy-text]')) {
  const button = group.querySelector<HTMLButtonElement>('[data-copy-text-button]')!;
  const area = group.querySelector<HTMLTextAreaElement>('textarea')!;
  const status = group.querySelector<HTMLElement>('[data-copy-text-status]')!;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(area.value); status.textContent = 'Text copied. It includes the live website link.'; }
    catch { area.focus(); area.select(); status.textContent = 'Automatic copying is unavailable. The text is selected for you to copy.'; }
  });
}
