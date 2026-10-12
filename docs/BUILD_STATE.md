# Build state

## Opt-in Analytics — implemented and checked, 12 October 2026

The user chose Search Console verification plus opt-in visitor statistics, using
Arts & Entertainment and an organising team of 1–10 employees. Created GA4 property
558646839 and web stream 16115171280 under the existing Analytics account. Public
measurement ID: G-H3WM611LGJ. Enhanced measurement is off; no ad links were added.

Implementation is isolated in .portal-test/analytics-verification, based on live
source af255636640bd847996a893537fbf75cd9fd2079. The separate discovery/sharing batch
remains local and is excluded. Changes: Analytics consent runtime and tag helpers,
AnalyticsChoice component/client script, shared layout, public-route CSP, privacy
page, focused consent tests, compiled-output discovery assertions and a public-page
comparison helper. Dependencies and participant source content are unchanged.

The production head retains Google's standard snippet after a fail-closed consent
bootstrap. Google's documented ga-disable flag prevents measurement before consent;
ad consent stays denied. Only selected public guide routes load the tag. Query
strings, fragments and referrers are excluded from measured page locations. Private
workspaces, reminder forms, shortlist and preview routes omit the loader. The
privacy page explains that loading Google's verification script still connects the
browser to Google before consent. Choice lasts 180 days; GA cookies at most 90 days.
Withdrawal, cross-tab changes, expiry and Back/Forward restoration are handled.

Actual validation: eight consent unit tests and three discovery tests pass (11/11),
including a real production-mode build at a reserved .invalid test origin. Emitted
inline bytes match CSP hashes and execute in a VM; no unsafe-inline/eval is added.
Final Astro check: 218 files, zero errors, warnings or hints. Approved-public exhibition-preview build: 39 pages.
verify-analytics-preview.py compares all 12 participant bodies byte-for-byte and
all description metadata with saved Release 32 HTML; revision unchanged at
48f769f9e40232472e07d4c9765603fdb26752159b7b759ec4531816db3ca5dc.

Chrome checks exercised decline, keyboard opt-in, saved choice across reload,
withdrawal and settings reopening. At 390px the two buttons are 48px tall and no
horizontal overflow was observed; reopening now scrolls the heading below the
sticky header. Preview has zero Google loader elements and no console errors.
No live Analytics request/receipt, screen-reader speech, zoom, reduced-motion or
JavaScript-disabled browser test is claimed. Static no-JS navigation is retained.
Evidence is under docs/evidence/analytics-verification in the main workspace.
Local preview: http://127.0.0.1:4343/ (privacy: /privacy/).

The user completed organiser sign-in/MFA again. Live baseline is Release 32 with
12 projects, event version 5 and no active jobs. Next: commit reviewed source,
prepare a source-only release with an exact manifest comparison, run the normal
publisher, validate live consent and complete Search Console verification.

## Hours and QR rollout — 4 October 2026, validated for authorised deployment

The organiser explicitly requested publishing the hours and QR tools before the
5 October participant update email. Scoped source preserves release 16's event
and 12 exact approved profiles; Savannah remains excluded. First v2 release has
no attendance decisions. Participants will submit their own hours for review.

Fresh clean-checkout checks: npm ci completed (six existing audit findings;
no automatic dependency upgrades); Astro check 149 files, zero diagnostics;
portal SQL 37/37, editorial 42/42, workspace browser 31/31, participant sign-in
6/6, unit 2/2 and focused public QR/all-route axe tests 6/6 passed. The SQL
rehearsal specifically applies hours migrations after the already hosted
publication-settings/organiser-text migrations and verifies their protections.
An initial parallel check encountered a Windows Vite rename lock; the isolated
rerun passed. A wrapper dropped the requested browser grep option; that broader
run was stopped after encountering known stale navigation assertions, then the
six intended checks ran directly and passed. The historical full-suite backlog
is not claimed green. Physical camera/print and screen-reader checks remain open.

The guarded preview generated 12 A6 cards (105.16 × 148.17 mm), 24 QR images,
individual PDFs, card previews and bulk packs from unchanged approved profiles.
All twelve PDF pages rendered and were inspected; no clipped titles. Workspace
artifact verification passed: 16 HTML pages, 27 files, no project data bundled.
Private editorial backup and function definitions were saved outside the repo;
no active queued/running job was observed. Worker scheduling is temporarily
paused for the compatible migration/source rollout. Next: apply additive
migrations, deploy workspace, register/approve the v2 release through organiser
MFA UI, verify canonical assets, resume processing, then schedule the email.
