import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {
  analyticsVerificationTag,
  analyticsVerificationPolicy,
  isAnalyticsPage,
  analyticsPublicOrigin,
} from '../../src/lib/google-analytics.ts';
import {
  analyticsChoiceKey,
  type AnalyticsConsent,
} from '../../src/lib/analytics-consent.ts';

const id = 'G-TEST123456';
function fixture(
  options: { stored?: string; storageFails?: boolean; origin?: string } = {},
) {
  const writes: string[] = [];
  const timers: Array<() => void> = [];
  const listeners = new Map<string, Function>();
  let value = options.stored ?? null;
  let now = Date.now();
  const context: any = {
    location: {
      origin: options.origin ?? analyticsPublicOrigin,
      hostname: 'createch-showcase.pages.dev',
      pathname: '/about/',
      search: '?email=private@example.invalid',
      hash: '#secret',
    },
    document: {
      title: 'About the showcase',
      set cookie(value: string) {
        writes.push(value);
      },
    },
    localStorage: {
      getItem() {
        if (options.storageFails) throw Error('Blocked');
        return value;
      },
      setItem(_key: string, next: string) {
        if (options.storageFails) throw Error('Blocked');
        value = next;
      },
      removeItem() {
        if (options.storageFails) throw Error('Blocked');
        value = null;
      },
    },
    setTimeout(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    addEventListener(name: string, fn: Function) {
      listeners.set(name, fn);
    },
    dispatchEvent() {},
    Event: class {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
    },
    Date: class extends Date {
      static now() {
        return now;
      }
    },
  };
  context.window = context;
  const tag = analyticsVerificationTag(id)!;
  const scripts = [...tag.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  for (const script of scripts) runInNewContext(script, context);
  const controller: AnalyticsConsent = context.createchAnalytics;
  const commands = () =>
    Array.from(context.dataLayer as IArguments[], (args: IArguments) =>
      Array.from(args),
    );
  return {
    context,
    controller,
    commands,
    writes,
    scripts,
    tag,
    timers,
    listeners,
    getStored: () => value,
    setStored: (next: string | null) => {
      value = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const saved = (value: 'granted' | 'denied', delta = 86400000) =>
  JSON.stringify({ version: 1, value, expires: Date.now() + delta });
const events = (f: ReturnType<typeof fixture>) =>
  f.commands().filter((x: unknown[]) => x[0] === 'event');

test('unconfigured or malformed tags cannot emit script, and only public guide routes qualify', () => {
  assert.equal(analyticsVerificationTag(null), null);
  for (const invalid of ['', 'UA-123-4', 'G-123456<script>', 'G-ABCDEF?x=1'])
    assert.throws(() => analyticsVerificationTag(invalid));
  const policy = "default-src 'self'; script-src 'self'; connect-src 'self'";
  assert.equal(analyticsVerificationPolicy(policy, null), policy);
  for (const path of ['/', '/about/', '/projects/public-work/'])
    assert.ok(isAnalyticsPage(path));
  for (const path of [
    '/participant/',
    '/organiser/',
    '/my-visit/',
    '/reminders/',
    '/privacy/',
    '/404/',
    '/projects/../',
  ])
    assert.equal(isAnalyticsPage(path), false);
});

test('first visit disables measurement before config and preserves the verification snippet', () => {
  const f = fixture();
  f.controller.pageView();
  assert.equal(f.context['ga-disable-' + id], true);
  assert.equal(f.controller.current(), null);
  assert.equal(events(f).length, 0);
  assert.equal(f.commands()[0][0], 'consent');
  assert.equal(f.commands()[0][1], 'default');
  assert.equal(f.commands()[0][2].analytics_storage, 'denied');
  assert.equal(f.commands()[1][1].send_page_view, false);
  assert.deepEqual(
    f
      .commands()
      .slice(-2)
      .map((x: unknown[]) => x[0]),
    ['js', 'config'],
  );
  assert.match(
    f.tag.html,
    /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST123456"><\/script>/,
  );
  const policy = analyticsVerificationPolicy(
    "default-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'",
    id,
  );
  for (const script of f.scripts)
    assert.ok(
      policy.includes(
        `'sha256-${createHash('sha256').update(script).digest('base64')}'`,
      ),
    );
  assert.ok(policy.includes('https://region1.google-analytics.com'));
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
});

test('allow sends one clean page view, persists the choice and keeps advertising denied', () => {
  const f = fixture();
  assert.equal(f.controller.choose('granted'), true);
  f.controller.pageView();
  f.controller.choose('granted');
  assert.equal(f.context['ga-disable-' + id], false);
  assert.equal(events(f).length, 1);
  assert.equal(
    events(f)[0][2].page_location,
    analyticsPublicOrigin + '/about/',
  );
  assert.equal(events(f)[0][2].page_referrer, '');
  assert.doesNotMatch(
    JSON.stringify(f.commands()),
    /private@example|#secret|\?email/,
  );
  assert.equal(JSON.parse(f.getStored()!).value, 'granted');
  for (const c of f.commands().filter((x: unknown[]) => x[0] === 'consent')) {
    assert.equal(c[2].ad_storage, 'denied');
    assert.equal(c[2].ad_user_data, 'denied');
    assert.equal(c[2].ad_personalization, 'denied');
  }
});

test('refusal and withdrawal immediately disable measurement and clear only GA cookies', () => {
  const f = fixture();
  f.controller.choose('denied');
  assert.equal(events(f).length, 0);
  f.controller.choose('granted');
  f.controller.choose('denied');
  f.controller.pageView();
  assert.equal(events(f).length, 1);
  assert.equal(f.context['ga-disable-' + id], true);
  assert.equal(JSON.parse(f.getStored()!).value, 'denied');
  assert.ok(f.writes.length > 0);
  assert.ok(f.writes.every((v) => /^_ga(?:_TEST123456)?=; Max-Age=0;/.test(v)));
});

test('saved consent restores; missing, invalid, expired and blocked storage fail closed', () => {
  const granted = fixture({ stored: saved('granted') });
  granted.controller.pageView();
  assert.equal(events(granted).length, 1);
  for (const stored of [
    undefined,
    '{bad',
    saved('denied'),
    saved('granted', -100),
    saved('granted', 181 * 86400000),
  ]) {
    const f = fixture({ stored });
    f.controller.pageView();
    assert.equal(f.context['ga-disable-' + id], true);
    assert.equal(events(f).length, 0);
  }
  const blocked = fixture({ storageFails: true });
  assert.equal(blocked.context['ga-disable-' + id], true);
  assert.equal(blocked.controller.choose('granted'), false);
  blocked.controller.choose('denied');
  assert.equal(blocked.context['ga-disable-' + id], true);
});

test('cross-tab withdrawal, storage clearing and expiry stop measurement', () => {
  const f = fixture({ stored: saved('granted') });
  f.controller.pageView();
  f.setStored(saved('denied'));
  f.listeners.get('storage')!({ key: analyticsChoiceKey });
  assert.equal(f.context['ga-disable-' + id], true);
  f.setStored(null);
  f.listeners.get('storage')!({ key: null });
  assert.equal(f.controller.current(), null);
  f.controller.choose('granted');
  f.advance(181 * 86400000);
  f.timers.at(-1)!();
  assert.equal(f.context['ga-disable-' + id], true);
  assert.equal(f.controller.current(), null);
});

test('localhost and preview hosts never grant live measurement even with saved consent', () => {
  for (const origin of [
    'http://127.0.0.1:4343',
    'https://preview.createch-showcase.pages.dev',
  ]) {
    const f = fixture({ origin, stored: saved('granted') });
    f.controller.choose('granted');
    f.controller.pageView();
    assert.equal(f.context['ga-disable-' + id], true);
    assert.equal(events(f).length, 0);
    assert.equal(
      f.commands().filter((x: unknown[]) => x[0] === 'consent').length,
      0,
    );
  }
});

test('Back/Forward restoration rereads a choice withdrawn on another page', () => {
  const f = fixture({ stored: saved('granted') });
  f.controller.pageView();
  f.setStored(saved('denied'));
  f.listeners.get('pageshow')!({ persisted: true });
  assert.equal(f.context['ga-disable-' + id], true);
  assert.equal(f.controller.current(), 'denied');
  assert.equal(events(f).length, 1);
});
