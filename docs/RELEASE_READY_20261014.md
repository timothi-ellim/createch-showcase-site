# Homepage release candidate — 14 October 2026

Status: implementation and local verification complete; not published.

## Included changes

- Prominent News & social section with the verified Tracy Harwood, Canopy and LCB links.
- Redesigned supporter acknowledgement and existing logo artwork.
- Homepage motion, pointer feedback and the sculpture retained below the themes.
- Repaired introduction layout at 900px and below; decoration uses an inner wrapper.
- Reading controls stack on narrow screens; sticky reading layouts require sufficient window height.
- Reserved divider space prevents rules crossing headings or introductory text.
- Two primary hero actions; selected projects and participants precede the poster/sharing section.
- Project image links exclude captions and licence links, across Home, Explore and My visit.

Event facts, participant records, approved media, Analytics consent and existing sharing functionality are preserved. No dependencies changed.

## Verification performed

Bundled Node v24.19.0 and the existing lockfile were used.

- `node node_modules/astro/bin/astro.mjs check`: public checkout 236 files; zero errors, warnings or hints. Root 262 files; zero errors/warnings and two pre-existing unused-variable hints in a temporary programme script.
- `node --test tests/editorial/home-interactions.test.ts tests/editorial/interactive-sketch.test.ts tests/editorial/ambient-motion.test.ts tests/editorial/motion-preferences.test.ts tests/editorial/project-reading.test.ts tests/editorial/discovery.test.ts tests/editorial/sharing-pack.test.ts tests/editorial/google-analytics.test.ts`: 33 passed in the public checkout, including the isolated production-mode build at a reserved .invalid origin.
- Root interaction/reading checks: 20 passed; final motion-preference rerun: 3 passed.
- `node .build-candidates/event-links-20261013/rebuild-preview.mjs`: approved-content preview built successfully.
- `python scripts/verify-homepage-release.py --site .build-candidates/event-links-20261013/site --snapshot .build-candidates/sharing-preview/snapshot.json`: 40 HTML pages checked; no nested anchors, interactive controls inside anchors, duplicate IDs or missing same-page anchors. Complete event description preserved; 11 media hashes verified.
- In-app browser: 320, 390, 768, 892, 899, 900, 901, 1024 and 1440px; normal and larger text; no heading/toolbar/passage overlaps or horizontal overflow. Stacked introduction keeps a 40px gap. Divider clearance checked at 320/900/1440px.
- Keyboard chapter navigation, mobile menu Enter navigation/focus, pause/resume and saved pause after reload, keyboard save/reload/remove, all 12 Explore card image links and all seven supporter images checked. No captured browser errors or warnings.
- `git diff --check`: passed (line-ending notices only).
- `node --test tests/release.test.mjs` in root: 2/2 passed after removing the obsolete ban on the approved map label WS09. The initial failure matched only WS09 in an older local fixture build; all private-data marker matches were zero. The same marker scan was then run against the actual 40-page release preview through `verify-homepage-release.py` and passed. Existing root test changes were preserved.

Evidence is in `docs/evidence/homepage-release-20261014/`, including four screenshots and browser measurements. A regression spec was added at `tests/browser/homepage-layout.spec.ts`; its equivalent geometry checks were executed through the in-app browser, not the Playwright CLI.

Real 200%/400% browser zoom was unavailable in the in-app browser: Ctrl+plus left viewport dimensions, device pixel ratio and visual viewport scale unchanged. Screen-reader speech, physical touch, a no-JavaScript browser context and the full axe/Playwright suites were not run. OS reduced motion and denied storage were exercised in the Node tests. Static HTML reading was checked in generated output. These checks do not establish WCAG conformance.

## Publication handoff

Last recorded live release: 34, source `64a987847b3baef588d14b91e8ef0ead14a4042f`.
Approved content revision remains `48f769f9e40232472e07d4c9765603fdb26752159b7b759ec4531816db3ca5dc` (12 projects, 11 original media files).

The source archive and checksum receipt are prepared under `.build-candidates/homepage-release-20261014/` in the public checkout. This is a source release candidate, not a production deployment artifact. Do not upload the local preview: it is noindex, uses local sharing URLs and disables reminder signup.

On explicit approval to publish, use the existing immutable organiser release workflow with this exact source commit, compare the new manifest with Release 34, and preserve all approved participant revisions, schedules, event/policy versions, media, reminders and Analytics settings. Build a fresh production artifact through that workflow, publish, then verify the live content revision, homepage, Explore, About, Visit, sharing and reminder routes. No production approval receipt has been manufactured and no push, release registration, publication or hosting change was made during this preparation.
