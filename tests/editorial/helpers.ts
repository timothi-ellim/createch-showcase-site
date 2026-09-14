import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../../editorial/store.ts';
import {
  createState,
  splitProject,
  bindResponse,
  ingest,
} from '../../editorial/workflow.ts';
import { projectSchema, validate } from '../../src/lib/content-schema.ts';
const catalogue = JSON.parse(
  readFileSync(join(repositoryRoot, 'content/projects.json'), 'utf8'),
);
export const event = JSON.parse(
  readFileSync(join(repositoryRoot, 'content/event.json'), 'utf8'),
);
export const themes = catalogue.themes;
export const fixture = validate(projectSchema, catalogue.projects[0]);
export const secondFixture = validate(projectSchema, catalogue.projects[1]);
export const timestamp = (minute: number) =>
  new Date(Date.UTC(2026, 8, 13, 0, minute)).toISOString();
export function setup() {
  const state = createState(event, themes);
  const { profile, organiser } = splitProject(fixture);
  bindResponse(state, {
    organiser,
    ownerContact: 'synthetic-private@example.invalid',
    formId: 'test-private-form-100',
    responseId: 'test-private-response-100',
  });
  const response = {
    formId: 'test-private-form-100',
    responseId: 'test-private-response-100',
    observedAt: timestamp(1),
    lastSubmittedAt: timestamp(0),
    profile,
  };
  ingest(state, response);
  return { state, response, profile, organiser };
}
