# Artist hours and signage

Implemented locally on 4 October 2026. This guide does not authorise deployment,
migrations, participant edits, publication or invitations. See BUILD_STATE for
the actual validation results and outstanding release gates.

## Participants

Open a project, then **Your hours**. Choose whole showcase, selected periods,
not attending, or unsure. Selected periods merge into a readable summary while
retaining gaps. Autosave keeps a private draft; **Submit hours for review** freezes
the current version. Submitted, approved and currently public hours are separate.
An unsure/absent response does not immediately remove existing public hours.

If another editor saves first, use **Compare saved hours**. Either reload their
selection or deliberately save yours as the next version. Reloading this form
preserves a storage-denied, same-tab session. There is no persistent private
draft backup in the browser.

**Project QR** uses the verified public profile's slug, title and maker. It may
accurately say the profile is unpublished, the live release predates QR assets,
or withdrawal is pending. An unavailable check offers retry rather than claiming
that the project is unpublished.

## Organisers

**Artist hours → Responses** includes active projects without submissions.
Review the submitted proposal, approved decision and currently live hours
separately. Adjustments need a reason. Assigning positive hours to an unsure or
absent response requires confirmation of a separately agreed arrangement; that
confirmation is stored in the immutable decision. Participant feedback is
separate from organiser notes, which are readable only through the MFA-protected
review-history RPC. The overview and participant RPC never return those notes.

**Coverage** switches between approved, submitted and live ranges. Counts are
projects with planned artist presence, not staffing headcounts. Incompatible
proposals are excluded after an event date/hours/timezone/interval change. Changes
to unrelated event copy do not require participants to choose their hours again.

On **Releases**, choose the approved profile version and an exact hours decision
for every project. Carry forward live hours when a newer proposal is pending,
or select a reviewed replacement/removal. Review and approve the whole release
through the existing publication workflow. A saved decision does not publish.
Older, superseded hours decisions cannot restore removed hours accidentally.

## Printing

After canonical verification, **QR and signage** offers individual SVG/PNG codes,
individual A6 PDFs, one multipage A6 PDF and a ZIP containing the QR image files.
The card preview is generated from the same print layout. Pending withdrawals
disable the bulk pack until a reviewed removal release is verified.

Print one card per A6 page at actual size/100%. Chromium rounds the nominal
105 × 148 mm page slightly; local output measured 105.16 × 148.17 mm. Check the
55 mm QR square and its white margin on the actual stock. Test iPhone and Android
cameras under exhibition lighting and at intended distances before printing the
batch. Those physical checks have not been performed. Hours are deliberately
absent from cards so later attendance changes do not require reprinting.

Use the browser's Save/Download command if a file opens instead of downloading.
Cross-origin delivery relies on asset Content-Disposition headers; it does not
require a broad CORS policy. Local fixture cards are marked SYNTHETIC PREVIEW and
encode `https://createch-preview.invalid`, never a real participant destination.

## Build and authorised rollout

1. Rehearse `202610040001_project_presence.sql` and
   `202610040002_presence_releases.sql` against an isolated copy of the current
   migration chain. Back up using the existing restricted procedure. Local
   PGlite tests executed the chain; full Supabase services were unavailable.
2. Register/review the source including the pinned lockfile and worker change.
   The worker needs Chromium: the workflow now runs
   `npx playwright install --with-deps chromium` after `npm ci`. Windows local
   builds use installed Chrome; `CHROME_PATH` can override it.
3. Apply compatible backend changes before deploying workspace links. Use the
   existing authorised workspace build/descriptor process. Set
   `PUBLIC_PROJECT_ASSET_ORIGIN` to the exact public origin if it differs from
   `https://createch-showcase.pages.dev`. Keep the API and image CSP origins narrow.
4. Prepare an approved version-2 public release. Hours are optional: QR can ship
   before attendance is collected. Existing version-1 live releases show
   “awaiting assets” until this release is canonically verified. Historical
   snapshots remain readable; restoring an old profile with current hours uses
   a new reviewed release rather than silently dropping hours.
5. Inspect the protected candidate, PDF text/layout, exact asset membership,
   private-data checks and download headers. Verify canonical hashes before
   treating the pack as current. Do not use a candidate as final exhibition signs.

Generated assets live only inside each fresh candidate, not tracked `public/`.
The verifier checks membership, deterministic QR bytes, hashes, ZIP contents and
raw private canaries; the local PDF QA additionally extracted text/metadata and
decoded rendered pages. Repeat extraction and physical checks on the actual
approved pack. Output generation fails closed on print-text overflow.

`check`, unit/editorial/portal tests, both workspace browser suites, fixture
builds and focused public browser tests are documented in BUILD_STATE. The broad
public suite still has older navigation/motion assertion failures recorded in
`docs/evidence/presence-qr/public-regressions.json`; it is not a green release gate.
Real provider, physical-camera, screen-reader and genuine browser-zoom checks
remain outstanding. No production action has been performed for this feature.
