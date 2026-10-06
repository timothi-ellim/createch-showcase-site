const form = document.querySelector<HTMLFormElement>('[data-reminder-form]');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  if (button.disabled) return;
  const error = document.querySelector<HTMLElement>('[data-reminder-error]')!;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Sending your request…';
  form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(new FormData(form) as any),
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.state !== 'received')
      throw new Error(
        data.message || 'We couldn’t complete your request. Please try again.',
      );
    document.querySelector<HTMLElement>(
      '[data-reminder-form-content]',
    )!.hidden = true;
    const received = document.querySelector<HTMLElement>(
      '[data-reminder-received]',
    )!;
    received.hidden = false;
    document
      .querySelector('[data-reminder-step="1"]')
      ?.removeAttribute('aria-current');
    document
      .querySelector('[data-reminder-step="2"]')
      ?.setAttribute('aria-current', 'step');
    form.reset();
    received.focus();
  } catch (reason) {
    error.textContent =
      reason instanceof Error &&
      !['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError'].includes(
        reason.name,
      )
        ? reason.message
        : 'We couldn’t confirm your request. Your email is still here—please try again, or add the event to your calendar.';
    error.hidden = false;
    error.focus();
  } finally {
    button.disabled = false;
    button.textContent = 'Send my confirmation link →';
    form.removeAttribute('aria-busy');
  }
});
