# Source register

## News and social section — implementation authorised, 13 October 2026

The user instructed: "Add it in. Also I think there should be a clear news and
social section so that visitors notice it, as currently I just scroll past
the links". This authorises the verified Tracy Harwood announcement and a more
prominent local design, superseding the review-only status below.

The homepage section is titled News & social and appears before the supporter
logos, with Tracy's attributed announcement first, followed by Canopy's event
listing and LCB's links. A header/menu item, hero shortcut and footer anchor make
the section findable. Tracy's summary paraphrases the verified post; no social
counts, dates of posting, portraits, screenshots or institutional endorsements
are added. The static card uses the previously verified canonical permalink.
Visit and footer external links remain the two venue/community links. Only
Canopy identifies the event in JSON-LD. No participant or event records change.
Publication remains subject to the existing production approval requirement.

## Tracy Harwood LinkedIn announcement — review only, 13 October 2026

The user supplied https://lnkd.in/p/eZwU7-fY twice and requested an opinion and
implementation plan. These are duplicate URLs, not evidence of two posts.
The public browser page identifies Tracy Harwood as the author and promotes the
28 October showcase at Canopy, featuring doctoral research. Its event link
https://lnkd.in/eG-aQQd7 displays the Canopy event listing as its destination.
No LinkedIn sign-in or account action was needed to read the public post after
dismissing the sign-in prompt. Non-essential cookies were rejected.

The page's canonical URL was read and opened successfully:
https://www.linkedin.com/posts/tgharwood_leicester-createch-activity-7515688098064691200-utxM
Use this clean URL if implemented, without the sharing URL's tracking parameters.
The post is an attributed social announcement, not evidence of independent press
coverage or an institutional endorsement. No reaction counts, relative timestamp,
portrait, quotation or LinkedIn embed is proposed for reuse. Planning only;
no LinkedIn link has been added to application code or published.

## Canopy event listing and LCB links — 13 October 2026

The user supplied and requested these public links on the showcase:
- https://canopy.leicestercreative.business/events/createch-showcase-2026/
- https://linktr.ee/lcbdepot

Browser inspection confirmed Canopy's CreaTech Showcase 2026 listing gives
28 October 2026, 11:00–16:00, Canopy, and links back to the public showcase.
The live LCB Linktree identifies LCB's creative workspaces and includes a link
to that Canopy listing among its events. A direct automated Canopy fetch was
challenged; the ordinary browser page loaded successfully. No booking policy
was inferred from the listing's generic ticket button.

Both URLs are organiser-owned site links, kept once in src/data/event-links.ts.
Only the specific Canopy listing is an Event sameAs reference; LCB's general
profile is not the event's identity. Semantics checked against
https://schema.org/sameAs. No ranking improvement or indexing outcome is claimed.
Participant records, event facts and immutable approved snapshots are unchanged.
Production release approval remains a separate step under AGENTS.md.

## Analytics choices and configuration — 12 October 2026

User instructions: Google Analytics verification and visitor statistics with an
opt-in choice; organising team, Arts & Entertainment, 1–10 employees. Participant
texts must remain unchanged. The earlier discovery/sharing batch still awaits
local review and is not included in this release.

Authenticated Analytics UI evidence: CreaTech Showcase 2026 property 558646839,
web stream 16115171280, public measurement ID G-H3WM611LGJ, website
https://createch-showcase.pages.dev, enhanced measurement switched off.

Primary implementation references checked 12 October 2026:
- https://support.google.com/webmasters/answer/9008080?hl=en
- https://developers.google.com/tag-platform/security/guides/privacy
- https://developers.google.com/tag-platform/security/guides/consent
- https://developers.google.com/analytics/devguides/collection/ga4/reference/config
- https://developers.google.com/tag-platform/security/guides/csp
