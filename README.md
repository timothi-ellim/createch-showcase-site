# CreaTech Showcase

Astro and TypeScript public exhibition guide and invitation-only participant workspace for CreaTech Showcase 2026.

This repository contains application code, database migrations and synthetic test fixtures. Participant records, organiser source documents, credentials and private development history are excluded.

## Development

Use the Node version in .nvmrc, then run npm ci, npm run check and npm run build:local. Local previews contain labelled fictional projects. Never deploy local-dist.

The separate participant workspace build is npm run build:portal-staging. It requires the exact hosted staging URL, a publishable browser key and PUBLIC_PORTAL_ENVIRONMENT=staging. Its output is portal-dist. No participant data or public catalogue is bundled in that build.

The public exhibition build remains fail-closed until an approved snapshot and matching release approval are supplied. Later participant edits remain private until an organiser approves their exact version and a release is verified.

## Operations

The portal worker runs only through workflow_dispatch on main. Its credentials belong in the createch-portal GitHub environment. Public workflow logs and artifacts must never contain draft data, account credentials or invitation codes. Hosted editing, background processing and publication have separate readiness checks; the existence of this repository does not establish that those checks passed.
