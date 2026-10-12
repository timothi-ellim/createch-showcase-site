export const analyticsChoiceKey = 'createch-analytics-choice-v1';
export const analyticsChoiceDays = 180;
export const analyticsMeasurementId = 'G-H3WM611LGJ';
export const analyticsPublicOrigin = 'https://createch-showcase.pages.dev';

/** Self-contained so the same tested code can run before Google's head snippet. */
export function createAnalyticsConsent(config: {
  id: string;
  origin: string;
  key: string;
  days: number;
  live: boolean;
}) {
  const host = window as unknown as Window & {
    [key: `ga-disable-${string}`]: boolean;
    dataLayer?: unknown[];
  };
  const live = config.live && location.origin === config.origin;
  const disableKey = `ga-disable-${config.id}` as const;
  host[disableKey] = true;
  host.dataLayer = host.dataLayer || [];
  function command(..._args: unknown[]) {
    host.dataLayer!.push(arguments);
  }
  const lifetime = config.days * 86400000;
  type Choice = { version: 1; value: 'granted' | 'denied'; expires: number };
  let choice: Choice | null = null;
  let viewed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function read(): Choice | null {
    try {
      const value = JSON.parse(localStorage.getItem(config.key) || 'null');
      if (
        value?.version === 1 &&
        ['granted', 'denied'].includes(value.value) &&
        Number.isFinite(value.expires) &&
        value.expires > Date.now() &&
        value.expires <= Date.now() + lifetime
      )
        return value;
    } catch {
      /* Storage may be blocked. Measurement stays off. */
    }
    return null;
  }

  function clearCookies() {
    const names = ['_ga', `_ga_${config.id.slice(2)}`];
    for (const name of names) {
      for (const domain of [
        '',
        `; Domain=${location.hostname}`,
        `; Domain=.${location.hostname}`,
      ]) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain}`;
      }
    }
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (choice)
      expiryTimer = setTimeout(
        () => {
          if (choice && choice.expires <= Date.now()) {
            apply(null);
            window.dispatchEvent(new Event('createch:analytics-choice'));
          } else scheduleExpiry();
        },
        Math.min(choice.expires - Date.now(), 2147483647),
      );
  }

  function pageView() {
    if (!live || choice?.value !== 'granted' || host[disableKey] || viewed)
      return;
    if (choice.expires <= Date.now()) {
      apply(null);
      return;
    }
    viewed = true;
    command('event', 'page_view', {
      send_to: config.id,
      page_location: location.origin + location.pathname,
      page_title: document.title,
      page_referrer: '',
    });
  }

  function apply(next: Choice | null, initial = false) {
    choice = next;
    const allowed = live && choice?.value === 'granted';
    // Disable first: denied consent alone can still allow cookieless pings.
    host[disableKey] = !allowed;
    if (live)
      command('consent', initial ? 'default' : 'update', {
        analytics_storage: allowed ? 'granted' : 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
    if (choice?.value !== 'granted') clearCookies();
    scheduleExpiry();
  }

  apply(read(), true);
  if (live)
    command('set', {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: location.origin + location.pathname,
      page_referrer: '',
      ignore_referrer: true,
      campaign_source: '',
      campaign_medium: '',
      campaign_name: '',
      campaign_id: '',
      campaign_term: '',
      campaign_content: '',
      cookie_domain: 'none',
      cookie_expires: 90 * 86400,
      cookie_update: false,
      cookie_flags: 'SameSite=Lax;Secure',
    });

  window.addEventListener('storage', (event) => {
    if (event.key !== config.key && event.key !== null) return;
    apply(read());
    pageView();
    window.dispatchEvent(new Event('createch:analytics-choice'));
  });
  window.addEventListener('pageshow', (event) => {
    // A Back/Forward restoration may revive a page from before withdrawal.
    if (event.persisted || (choice && choice.expires <= Date.now())) {
      apply(read());
      pageView();
      window.dispatchEvent(new Event('createch:analytics-choice'));
    }
  });

  return {
    live,
    current: () => choice?.value ?? null,
    pageView,
    choose(value: 'granted' | 'denied') {
      const next: Choice = {
        version: 1,
        value,
        expires: Date.now() + lifetime,
      };
      apply(next);
      let saved = false;
      try {
        localStorage.setItem(config.key, JSON.stringify(next));
        saved = true;
      } catch {
        try {
          localStorage.removeItem(config.key);
        } catch {
          /* Explain in UI. */
        }
      }
      pageView();
      return saved;
    },
  };
}

export type AnalyticsConsent = ReturnType<typeof createAnalyticsConsent>;
