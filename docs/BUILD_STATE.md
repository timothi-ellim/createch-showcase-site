# Build state

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
