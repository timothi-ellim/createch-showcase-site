import { readFileSync } from 'node:fs';
import eventRecord from '../../content/event.json';
import catalogue from '../../content/projects.json';
import { freezeSnapshot, readSnapshot } from '../lib/content-schema';
export type { PublicProject } from '../lib/content-schema';
export type Theme = 'image' | 'world' | 'relation';

// Astro reads only a strict, hash-verified public snapshot. The private editorial
// record is never imported into application code or serialized into the browser.
const snapshotPath = process.env.CREATECH_SNAPSHOT;
export const snapshot = snapshotPath
  ? readSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')))
  : freezeSnapshot({
      schemaVersion: 1,
      publicationStatus: 'synthetic-local-only',
      event: eventRecord,
      themes: catalogue.themes,
      projects: catalogue.projects,
    });
export const isSynthetic =
  snapshot.publicationStatus === 'synthetic-local-only';
export const isPreview = import.meta.env.MODE !== 'production' || isSynthetic;
export const contentRevision = snapshot.revision;
export const projects = snapshot.projects;
export const themes = snapshot.themes;
export const event = snapshot.event;
export const address = `${event.venue.name}, ${event.venue.streetAddress}, ${event.venue.city}, ${event.venue.postalCode}`;
export const timeLabel = `${event.startTime}–${event.endTime} (UK time)`;
export const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
