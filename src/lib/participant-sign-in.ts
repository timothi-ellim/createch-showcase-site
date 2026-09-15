import type { SupabaseClient } from '@supabase/supabase-js';

export function newAttemptKey() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
/** Tab-scoped code journey; provider sessions remain managed by the existing SDK. */
export function installParticipantSignIn(
  root: HTMLElement,
  client: SupabaseClient,
  say: (message: string, error?: boolean) => void,
  signedIn: () => Promise<void>,
) {
  const get = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const email = get<HTMLInputElement>('#email'),
    code = get<HTMLInputElement>('#email-code');
  const emailForm = get<HTMLFormElement>('[data-email-form]'),
    codeForm = get<HTMLFormElement>('[data-code-form]');
  const send = get<HTMLButtonElement>('[data-send-code]'),
    resend = get<HTMLButtonElement>('[data-resend-code]');
  let attempt = '',
    attemptStartedAt = 0,
    attemptInput = '',
    requestCompleted = false,
    busy = false,
    retryAt = 0,
    timer: ReturnType<typeof setInterval> | undefined;
  const controls = () =>
    root.querySelectorAll<HTMLButtonElement>('[data-login] button');
  function cooldown(seconds: number) {
    retryAt = Date.now() + seconds * 1000;
    clearInterval(timer);
    const tick = () => {
      const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      send.disabled = resend.disabled = busy || left > 0;
      resend.textContent = left
        ? `Send a new code in ${left}s`
        : 'Send a new code';
      if (!left) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  async function call(name: string, body: object) {
    const { data, error } = await client.functions.invoke(name, {
      body,
      timeout: 30000,
    });
    if (error) {
      const response = (error as any).context;
      if (response instanceof Response && response.status === 429) {
        cooldown(
          Math.min(
            3600,
            Math.max(60, Number(response.headers.get('retry-after')) || 60),
          ),
        );
        throw Error(
          'Please wait before trying again. You can request a new code when the countdown ends.',
        );
      }
      if (response instanceof Response && response.status === 401)
        throw Error(
          'That code could not be verified. Check the latest email or request a new code.',
        );
      throw Error(
        'Sign-in is temporarily unavailable. Please try again shortly or contact the organiser.',
      );
    }
    return data;
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    controls().forEach((b) => (b.disabled = true));
    try {
      await work();
    } catch (error) {
      say((error as Error).message, true);
    } finally {
      busy = false;
      controls().forEach((b) => (b.disabled = false));
      if (Date.now() < retryAt)
        cooldown(Math.ceil((retryAt - Date.now()) / 1000));
    }
  }
  async function start(mode: 'send' | 'existing-code') {
    if (!email.reportValidity() || (mode === 'send' && Date.now() < retryAt))
      return;
    // Reuse this key on transport retry; sending a new code is an explicit action.
    const input = `${mode}:${email.value.trim().toLowerCase()}`;
    if (!attempt || attemptInput !== input) {
      attempt = newAttemptKey();
      attemptStartedAt = Date.now();
      attemptInput = input;
      requestCompleted = false;
    }
    const result = await call('participant-auth-request', {
      email: email.value.trim(),
      attemptKey: attempt,
      mode,
    });
    if (result?.status !== 'check_email')
      throw Error('Sign-in could not be started. Please try again.');
    requestCompleted = true;
    emailForm.hidden = true;
    codeForm.hidden = false;
    get('[data-code-address]').textContent = email.value.trim();
    if (mode === 'send') cooldown(Math.max(60, result.retryAfterSeconds || 60));
    say(
      mode === 'send'
        ? 'If this address has access, a code will arrive shortly. Use the latest code.'
        : 'Enter the code from your email. No new code was requested.',
    );
    code.focus();
  }
  emailForm.onsubmit = (event) => {
    event.preventDefault();
    void action(() => start('send'));
  };
  get<HTMLButtonElement>('[data-existing-code]').onclick = () => {
    attempt = '';
    void action(() => start('existing-code'));
  };
  resend.onclick = () => {
    if (Date.now() < retryAt) return;
    if (requestCompleted) attempt = '';
    code.value = '';
    void action(() => start('send'));
  };
  get<HTMLButtonElement>('[data-change-email]').onclick = () => {
    attempt = '';
    code.value = '';
    emailForm.hidden = false;
    codeForm.hidden = true;
    email.focus();
  };
  code.addEventListener('input', () => {
    code.value = code.value.replace(/\s/g, '');
  });
  codeForm.onsubmit = (event) => {
    event.preventDefault();
    void action(async () => {
      if (!code.reportValidity()) return;
      // The code lasts 24 hours, but the server's verification attempt lasts
      // 15 minutes. Refresh only the attempt, never send another email here.
      if (!attempt || Date.now() - attemptStartedAt >= 14 * 60 * 1000) {
        attempt = '';
        requestCompleted = false;
      }
      if (!attempt || !requestCompleted) await start('existing-code');
      say('Checking your code…');
      const result = await call('participant-auth-verify', {
        attemptKey: attempt,
        code: code.value.replace(/\s/g, ''),
      });
      if (!result?.session?.access_token || !result.session.refresh_token)
        throw Error('The sign-in response was incomplete. Request a new code.');
      const { error } = await client.auth.setSession(result.session);
      code.value = '';
      attempt = '';
      if (error)
        throw Error('Your session could not be opened. Request a new code.');
      await signedIn();
      emailForm.hidden = false;
      codeForm.hidden = true;
    });
  };
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      attempt = '';
      code.value = '';
    },
    { once: true },
  );
}
