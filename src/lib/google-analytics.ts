import { createHash } from 'node:crypto';
import {
  analyticsChoiceDays,
  analyticsChoiceKey,
  createAnalyticsConsent,
  analyticsMeasurementId,
  analyticsPublicOrigin,
} from './analytics-consent.ts';

// Public ID issued by the organiser's web stream; never a credential.
export const googleAnalyticsMeasurementId: string | null =
  analyticsMeasurementId;
export { analyticsPublicOrigin };
export const analyticsPublicPaths = [
  '/',
  '/explore/',
  '/programme/',
  '/about/',
  '/poster/',
  '/visit/',
];
export function isAnalyticsPage(path: string) {
  return (
    analyticsPublicPaths.includes(path) ||
    /^\/projects\/[a-z][a-z0-9-]{1,79}\/$/.test(path)
  );
}

export function analyticsVerificationTag(measurementId: string | null) {
  if (measurementId === null) return null;
  if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId))
    throw new Error('Invalid Analytics measurement ID.');
  const bootstrap = `window.createchAnalytics = (${createAnalyticsConsent.toString()})(${JSON.stringify(
    {
      id: measurementId,
      origin: analyticsPublicOrigin,
      key: analyticsChoiceKey,
      days: analyticsChoiceDays,
      live: true,
    },
  )});`;
  // Keep Google's installation snippet intact for Search Console verification.
  const configScript = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${measurementId}');
`;
  const source = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  const scriptHashes = [bootstrap, configScript].map(
    (script) =>
      `'sha256-${createHash('sha256').update(script).digest('base64')}'`,
  );
  return {
    html: `<script>${bootstrap}</script>\n<!-- Google tag (gtag.js) -->\n<script async src="${source}"></script>\n<script>${configScript}</script>`,
    scriptHashes,
  };
}

export function analyticsVerificationPolicy(
  base: string,
  measurementId: string | null,
) {
  const tag = analyticsVerificationTag(measurementId);
  if (!tag) return base;
  const collection =
    'https://www.google-analytics.com https://region1.google-analytics.com';
  return base
    .replace(
      "script-src 'self'",
      `script-src 'self' https://www.googletagmanager.com/gtag/js ${tag.scriptHashes.join(' ')}`,
    )
    .replace("connect-src 'self'", `connect-src 'self' ${collection}`)
    .replace("img-src 'self'", `img-src 'self' ${collection}`);
}
