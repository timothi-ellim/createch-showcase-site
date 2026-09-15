import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml as e, renderProjectBody } from '../lib/project-renderer';
import { checkPortalEnvironment, draftView } from '../lib/portal-contract';
import {
  installParticipantSignIn,
  newAttemptKey,
} from '../lib/participant-sign-in';
import type {
  ParticipantFields,
  PortalDraft,
  RevisionPreview,
  ProjectSummary,
  PortalContext,
} from '../lib/portal-contract';

const root = document.querySelector<HTMLElement>('[data-portal]')!;
const content = root.querySelector<HTMLElement>('[data-private-content]')!;
const status = root.querySelector<HTMLElement>('[data-portal-status]')!;
const login = root.querySelector<HTMLElement>('[data-login]')!;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
let client: SupabaseClient,
  identity: string | null = null,
  context: PortalContext;
let draft: PortalDraft | null = null,
  dirty = false,
  busy = false,
  requestId = crypto.randomUUID(),
  factorId = '';
const objectUrls = new Set<string>();
let tabStorageAvailable = true;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function say(message: string, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
  const localStatus = content.querySelector<HTMLElement>(
    '[data-editor-status]',
  );
  if (localStatus) {
    localStatus.textContent = message;
    localStatus.dataset.error = String(error);
  }
  document.dispatchEvent(
    new CustomEvent('createch:status-feedback', {
      detail: { target: localStatus ?? status, error },
    }),
  );
}
function clearPrivate() {
  clearTimeout(autosaveTimer);
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  content.replaceChildren();
  content.hidden = true;
  $('[data-private-nav]').hidden = true;
  $('[data-mfa]').hidden = true;
  draft = null;
  dirty = false;
  identity = null;
  factorId = '';
  $('[data-mfa-setup]').replaceChildren();
}
function urlFor(blob: Blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}
const messages: Record<string, string> = {
  SESSION_EXPIRED:
    'Your session expired. Your text is still here. Sign in again to save.',
  PROJECT_IDENTIFIER_TAKEN:
    'That page identifier is already in use. Choose another; the existing project has not changed.',
  INVALID_PROJECT_DETAILS:
    'Enter a title, contributor name, theme and a valid page identifier.',
  REQUEST_CONFLICT:
    'This request was already used with different details. Refresh before starting a new request.',
  DRAFT_CONFLICT:
    'A newer draft was saved elsewhere. Your text is still here. Compare it before reloading.',
  ACCESS_DENIED:
    'Access is unavailable for this account or project. Your public page has not changed.',
  MFA_REQUIRED: 'Verify your authenticator code before this organiser action.',
  STALE_REVIEW:
    'This review has changed. Refresh and review the current version before deciding.',
  STALE_RELEASE:
    'This release is no longer eligible. Prepare a new release with current approvals and exclusions.',
  EDITING_CLOSED:
    'Editing is currently closed. Your public page has not changed.',
  UPLOAD_LIMIT:
    'This project has reached its daily upload limit. Keep your selected image or contact the organiser.',
  RETRY_NOT_AVAILABLE:
    'Automatic retry is not available. An organiser must review the failed attempt.',
  RECOVERY_REVIEW_REQUIRED:
    'The previous deployment may have started. Recovery needs an owner to check the hosted target.',
};
async function rpc<T = any>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let result;
  try {
    result = await client.rpc(name, args).abortSignal(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  const { data, error } = result;
  if (error) {
    const code = Object.keys(messages).find((c) => error.message.includes(c));
    if (
      error.code === 'PGRST301' ||
      error.code === 'PGRST303' ||
      /JWT.*expired/i.test(error.message)
    ) {
      login.hidden = false;
      say(
        'Your session expired. Your text is still here. Sign in again to save.',
        true,
      );
      login.scrollIntoView({ block: 'start' });
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(code || 'REQUEST_FAILED');
  }
  return data as T;
}
async function act(fn: () => Promise<void>, saving = false) {
  if (busy) return;
  busy = true;
  root.setAttribute('aria-busy', 'true');
  content
    .querySelectorAll<HTMLButtonElement>(
      '[data-editor-actions] button, [data-remove-image]',
    )
    .forEach((b) => {
      b.disabled = true;
    });
  try {
    await fn();
  } catch (error) {
    const code = (error as Error).message;
    say(
      messages[code] ||
        (saving
          ? 'Saving could not be confirmed. Your text is still here. Please try again.'
          : 'The request could not be completed. Please try again.'),
      true,
    );
    if (code === 'DRAFT_CONFLICT') showConflict();
  } finally {
    busy = false;
    root.setAttribute('aria-busy', 'false');
    content
      .querySelectorAll<HTMLButtonElement>(
        '[data-editor-actions] button, [data-remove-image]',
      )
      .forEach((b) => {
        b.disabled = false;
      });
  }
}
const button = (text: string, attr: string = '', kind = 'dark') =>
  `<button type="button" class="button ${kind}" ${attr}>${e(text)}</button>`;
const link = (text: string, url: string) =>
  `<a class="text-link" href="${e(url)}">${e(text)} ↗</a>`;
const state = (value: string) =>
  ({
    draft: 'Draft',
    queued: 'Checks queued',
    running: 'Checks running',
    succeeded: 'Ready for review',
    approved: 'Approved · Awaiting publication',
    changes_requested: 'Changes requested',
    failed: 'Needs attention',
    prepared: 'Prepared · Not queued',
    building: 'Building',
    deployed_unverified: 'Publication checks running',
    verified_live: 'Verified live',
    recovery_required: 'Recovery required',
    revoked: 'Approval revoked',
  })[value] || 'Pending';
function field(
  name: string,
  label: string,
  value: string,
  max: number,
  large = false,
  required = false,
) {
  const help = `f-${name}-help`;
  return `<label for="f-${name}">${e(label)}</label>${large ? `<textarea id="f-${name}" name="${name}" maxlength="${max}" aria-describedby="${help}" ${required ? 'required' : ''}>${e(value)}</textarea>` : `<input id="f-${name}" name="${name}" value="${e(value)}" maxlength="${max}" aria-describedby="${help}" ${required ? 'required' : ''} />`}<p id="${help}" class="field-help" data-count-for="f-${name}">${required ? 'Required to submit. ' : ''}Up to ${max} characters.</p>`;
}
function readFields(): ParticipantFields {
  const form = $<HTMLFormElement>('[data-editor-form]'),
    values = new FormData(form);
  const text = (name: string) => String(values.get(name) || '');
  return {
    title: text('title'),
    maker: text('maker'),
    invitation: text('invitation'),
    description: text('description'),
    visitorAction: text('visitorAction'),
    encounters: values.getAll('encounters') as ParticipantFields['encounters'],
    assetId: draft?.fields.assetId || null,
    alt: text('alt'),
    credit: text('credit'),
    links: [0, 1, 2]
      .map((i) => ({
        label: text(`link-label-${i}`),
        url: text(`link-url-${i}`),
      }))
      .filter((l) => l.url || l.label),
    videoUrl: text('videoUrl') || null,
    processNote: text('processNote'),
    accessProposal: text('accessProposal'),
    permission: values.has('permission'),
    termsVersion: 'public-profile-v1',
  };
}
async function save() {
  clearTimeout(autosaveTimer);
  if (!draft) throw new Error('REQUEST_FAILED');
  const fields = readFields();
  say('Saving draft…');
  const saved = await rpc<{ version: number; updatedAt: string }>(
    'save_project_draft',
    {
      p_project: draft.projectId,
      p_expected_version: draft.version,
      p_fields: fields,
    },
  );
  draft = {
    ...draft,
    fields,
    version: saved.version,
    updatedAt: saved.updatedAt,
  };
  dirty = JSON.stringify(readFields()) !== JSON.stringify(fields);
  const savedAt = content.querySelector<HTMLElement>('[data-saved-at]');
  if (savedAt && Number.isFinite(Date.parse(saved.updatedAt))) {
    savedAt.textContent = `Last saved ${new Date(saved.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (your local time)`;
  }
  requestId = crypto.randomUUID();
  say(
    dirty
      ? 'Draft saved. Newer typed changes are still unsaved.'
      : 'Draft saved. Your public page has not changed.',
  );
}
function showConflict() {
  const box = content.querySelector<HTMLElement>('[data-conflict]');
  if (box) {
    box.hidden = false;
    box.scrollIntoView({ block: 'start' });
  }
}
async function dispatch(jobId: string) {
  const { error } = await client.functions.invoke('dispatch-job', {
    body: { jobId },
  });
  if (error)
    say(
      'Submitted and queued. The worker could not be contacted; use Retry checks or ask the organiser to retry dispatch.',
    );
  return !error;
}
async function showDashboard() {
  const projects = await rpc<ProjectSummary[]>('get_my_projects');
  if (
    import.meta.env.PUBLIC_PARTICIPANT_AUTH_V2 === 'true' &&
    !context.organiser &&
    projects.length === 1 &&
    !projects[0].withdrawn
  ) {
    await navigateParticipant(
      `/participant/editor/?project=${encodeURIComponent(projects[0].id)}`,
    );
    return;
  }
  content.innerHTML = `<div class="reading-panel">${projects.length ? projects.map((p) => `<article class="portal-card"><h2>${e(p.title)}</h2><p class="badge">${p.withdrawn ? 'Withdrawal requested' : state(p.status)}</p>${p.liveRevision ? '<p>A previously verified version is published.</p>' : '<p>No verified public version yet.</p>'}${p.feedback ? `<p>${e(p.feedback)}</p>` : ''}<div class="portal-actions">${link('Edit project', `/participant/editor/?project=${p.id}`)}${p.latestRevision ? link('View submitted version', `/participant/preview/?revision=${p.latestRevision}`) : ''}</div></article>`).join('') : '<h2>No assigned projects</h2><p>You are signed in, but no project is assigned to this account. Use your existing organiser contact for help.</p>'}</div>`;
  say('Your assigned projects are up to date.');
}
async function navigateParticipant(path: string) {
  if (tabStorageAvailable) {
    location.replace(path);
    return;
  }
  const url = new URL(path, location.origin);
  const surfaces: Record<string, string> = {
    '/participant/': 'dashboard',
    '/participant/editor/': 'editor',
    '/participant/preview/': 'preview',
  };
  const surface = surfaces[url.pathname];
  if (url.origin !== location.origin || !surface)
    throw new Error('REQUEST_FAILED');
  history.replaceState(null, '', url);
  root.dataset.portal = surface;
  const title =
    surface === 'editor'
      ? 'Edit your project'
      : surface === 'preview'
        ? 'Submitted version'
        : 'Your projects';
  root.querySelector('h1')!.textContent = title;
  document.title = title + ' | CreaTech';
  await load();
}
function renderEditor() {
  clearTimeout(autosaveTimer);
  if (!draft) return;
  const f = draft.fields,
    m = draft.metadata;
  content.innerHTML = `<div class="reading-panel"><p class="metadata">Organiser-confirmed details: ${e(m.room || 'Location not confirmed')} · ${e(m.schedule || 'Timing not confirmed')}. Access notes: ${e(m.accessNotes || 'Not confirmed')}. These fields are read-only.</p>
 <div class="conflict" data-conflict hidden><h2>A newer draft exists</h2><p>Your typed text is preserved below. Compare with the latest saved draft before choosing to reload.</p>${button('Compare saved draft', 'data-compare')}${button('Reload saved draft and discard my unsaved text', 'data-reload', 'secondary')}<div data-conflict-comparison></div></div>
 <nav class="editor-sections" aria-label="Editing sections"><a href="#work-fields">Your work</a><a href="#image-fields">Image</a><a href="#experience-fields">Visitor experience</a><a href="#optional-fields">Links & detail</a><a href="#permission-fields">Review & submit</a></nav>
 <form data-editor-form><fieldset id="work-fields"><legend>Your work</legend><p class="field-help">You can save an unfinished draft. Complete the required fields before submitting for review.</p>${field('title', 'Project title', f.title || '', 120, false, true)}${field('maker', 'Public contributor name', f.maker || '', 100, false, true)}${field('invitation', 'Short invitation', f.invitation || '', 200, true, true)}${field('description', 'About the work', f.description || '', 2000, true, true)}</fieldset>
 <fieldset><legend>Main image</legend><label for="image-upload">Choose a main image</label><input id="image-upload" type="file" accept="image/png,image/jpeg,image/webp" /><p class="field-help">PNG, JPEG or WebP, up to 5 MB. Convert HEIC before uploading. Uploading does not approve an image.</p><div data-image-state>${f.assetId ? '<p>An image is selected for this draft.</p>' : '<p>No image selected.</p>'}</div>${button('Remove image from draft', 'data-remove-image', 'secondary')}${field('alt', 'Image alternative text', f.alt || '', 300, true)}${field('credit', 'Image credit', f.credit || '', 200)}</fieldset>
 <fieldset><legend>Visitor experience</legend>${field('visitorAction', 'What visitors can do', f.visitorAction || '', 700, true, true)}<div class="checks">${['Look / listen', 'Participate'].map((v) => `<label><input type="checkbox" name="encounters" value="${v}" ${f.encounters?.includes(v as 'Participate') ? 'checked' : ''} />${v}</label>`).join('')}</div>${field('accessProposal', 'Proposed access or sensory correction', f.accessProposal || '', 700, true)}<p class="field-help">A proposal is reviewed before it changes confirmed public information.</p></fieldset>
 <fieldset><legend>Links and optional detail</legend>${[0, 1, 2].map((i) => `${field(`link-label-${i}`, `Link ${i + 1} label`, f.links?.[i]?.label || '', 100)}<label for="link-url-${i}">Link ${i + 1} address (HTTPS)</label><input id="link-url-${i}" name="link-url-${i}" type="url" pattern="https://.*" maxlength="2000" value="${e(f.links?.[i]?.url || '')}" />`).join('')}${field('videoUrl', 'Public video link (HTTPS)', f.videoUrl || '', 2000)}${field('processNote', 'Behind the work', f.processNote || '', 800, true)}</fieldset>
 <div class="checks"><label><input name="permission" type="checkbox" ${f.permission ? 'checked' : ''} />I have permission to submit this text and image for public display, with the credit above. I understand this exact version will be reviewed before publication (public-profile-v1).</label></div>
 <div class="editor-actionbar" data-editor-actions><p data-editor-status>Loaded your saved draft.</p><div class="portal-actions">${button('Save draft', 'data-save-draft')}${button('Preview', 'data-preview-draft', 'secondary')}${button('Submit for review', 'data-submit', 'secondary')}</div><div data-submit-result></div></div></form></div><div data-draft-preview hidden class="detail section" tabindex="-1" aria-label="Draft preview"></div>`;
  const form = $<HTMLFormElement>('[data-editor-form]');
  const sections = form.querySelectorAll('fieldset');
  [
    'work-fields',
    'image-fields',
    'experience-fields',
    'optional-fields',
  ].forEach((id, i) => {
    sections[i].id = id;
  });
  form.querySelector<HTMLElement>(':scope > .checks')!.id = 'permission-fields';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void act(save, true);
  });
  function updateCounts() {
    form.querySelectorAll<HTMLElement>('[data-count-for]').forEach((help) => {
      const input = document.getElementById(help.dataset.countFor!) as
        HTMLInputElement | HTMLTextAreaElement;
      help.textContent = `${input.required ? 'Required to submit. ' : ''}${input.value.length} of ${input.maxLength} characters`;
    });
  }
  updateCounts();
  const editorIdentity = identity;
  const editorProject = draft.projectId;
  function queueAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (
        !form.isConnected ||
        !dirty ||
        identity !== editorIdentity ||
        draft?.projectId !== editorProject ||
        !login.hidden ||
        content.querySelector<HTMLElement>('[data-conflict]')?.hidden === false
      )
        return;
      if (busy) {
        queueAutosave();
        return;
      }
      // Same version-checked draft RPC as manual Save. Never submits or publishes.
      void act(async () => {
        await save();
        if (dirty) queueAutosave();
      }, true);
    }, 2000);
  }
  const autosaveNote = document.createElement('p');
  autosaveNote.className = 'field-help';
  autosaveNote.textContent =
    'Draft changes save automatically after a short pause. You can also choose Save draft. Submitting for review is a separate step.';
  form.prepend(autosaveNote);
  const savedTime = document.createElement('p');
  savedTime.className = 'small';
  savedTime.dataset.savedAt = '';
  form.querySelector('[data-editor-actions]')?.append(savedTime);
  form.addEventListener('input', () => {
    dirty = true;
    updateCounts();
    say('Unsaved changes.');
    queueAutosave();
  });
  $('[data-save-draft]').onclick = () => act(save, true);
  $('[data-preview-draft]').onclick = () => {
    if (!draft) return;
    const box = $('[data-draft-preview]');
    box.innerHTML =
      button('Back to editing', 'data-close-preview', 'secondary') +
      '<p class="notice">Draft preview · Not submitted · Main image is checked after submission.</p>' +
      renderProjectBody(draftView({ ...draft, fields: readFields() }), {
        privatePreview: true,
        synthetic: context.environment === 'local',
      });
    box.hidden = false;
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: 'auto' });
    document.dispatchEvent(
      new CustomEvent('createch:preview-feedback', { detail: { target: box } }),
    );
    $('[data-close-preview]').onclick = () => {
      box.hidden = true;
      $('[data-preview-draft]').focus();
    };
  };
  $('[data-submit]').onclick = () =>
    act(async () => {
      if (!form.reportValidity()) {
        say('Complete the highlighted required field before submitting.', true);
        return;
      }
      if (!readFields().permission) {
        say('Confirm the permission declaration before submitting.', true);
        return;
      }
      if (dirty) {
        say('Save your changes before submitting this version.', true);
        return;
      }
      say('Submitting for review… Your public page stays the same.');
      const result = await rpc<{ revisionId: string; jobId: string }>(
        'submit_project_revision',
        {
          p_project: draft!.projectId,
          p_expected_version: draft!.version,
          p_request: requestId,
        },
      );
      say('Submitted for review. Your current public page stays the same.');
      $('[data-submit-result]').innerHTML = link(
        'View this submitted version',
        `/participant/preview/?revision=${result.revisionId}`,
      );
      if (!(await dispatch(result.jobId)))
        say(
          'Submitted for review. Your current public page stays the same. Checks have not started. Open “View this submitted version” below, then choose “Retry checks”.',
        );
    });
  $('[data-compare]').onclick = () =>
    act(async () => {
      const newer = await rpc<PortalDraft>('get_project_draft', {
        p_project: draft!.projectId,
      });
      $('[data-conflict-comparison]').innerHTML =
        `<h3>Latest saved draft</h3><pre>${e(JSON.stringify(newer.fields, null, 2))}</pre>`;
    });
  $('[data-reload]').onclick = () =>
    act(async () => {
      draft = await rpc<PortalDraft>('get_project_draft', {
        p_project: draft!.projectId,
      });
      dirty = false;
      renderEditor();
      say('Loaded the latest saved draft.');
    });
  $('[data-remove-image]').onclick = () => {
    draft!.fields.assetId = null;
    dirty = true;
    $('[data-image-state]').textContent =
      'Image removed from this draft. Save to keep this change.';
    say('Image removed from this draft. Save to keep this change.');
  };
  $<HTMLInputElement>('#image-upload').onchange = () =>
    act(async () => {
      const file = $<HTMLInputElement>('#image-upload').files?.[0];
      if (!file) return;
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 5_000_000
      ) {
        say(
          'Choose a PNG, JPEG or WebP file up to 5 MB. The previous image is unchanged.',
          true,
        );
        return;
      }
      say('Uploading image privately… Keep this page open.');
      const reserved = await rpc<{ assetId: string; path: string }>(
        'reserve_upload',
        { p_project: draft!.projectId, p_type: file.type, p_bytes: file.size },
      );
      const { error } = await client.storage
        .from('source-uploads')
        .upload(reserved.path, file, { upsert: false, contentType: file.type });
      if (error) {
        say(
          'Image upload failed. The previous image is still selected. Try again.',
          true,
        );
        return;
      }
      draft!.fields.assetId = reserved.assetId;
      dirty = true;
      const image = document.createElement('img');
      image.src = urlFor(file);
      image.alt = 'Local unvalidated image preview';
      $('[data-image-state]').replaceChildren(image);
      say(
        'Image uploaded privately. Save the draft, then submit it for checks.',
      );
    });
}
async function previewMarkup(preview: RevisionPreview) {
  const urls = new Map<string, string>();
  for (const media of preview.media || []) {
    const { data, error } = await client.storage
      .from('prepared-media')
      .download(media.path);
    if (error) throw new Error('REQUEST_FAILED');
    urls.set(media.src, urlFor(data));
  }
  return preview.prepared
    ? renderProjectBody(preview.prepared, {
        privatePreview: true,
        synthetic: context.environment === 'local',
        mediaUrls: urls,
      })
    : '<p>This submitted version has not passed validation yet. It cannot be approved.</p>';
}
async function showPreview(review = false) {
  const id = new URLSearchParams(location.search).get('revision');
  if (!id) throw new Error('REQUEST_FAILED');
  const preview = await rpc<RevisionPreview>('get_revision_preview', {
    p_revision: id,
  });
  const body = await previewMarkup(preview);
  content.innerHTML = `<section class="reading-panel"><h2>Submitted version</h2><p class="badge">${state(preview.decision || preview.jobStatus)}</p><p>${e(preview.feedback || 'No review feedback yet.')}</p><p class="small">Revision ${e(id)}<br />Application source: ${e(preview.sourceCommit || 'Awaiting validation')}</p><div class="portal-actions">${link('Continue editing', `/participant/editor/?project=${preview.projectId}`)}${button('Refresh status', 'data-refresh', 'secondary')}${!preview.prepared ? button('Retry checks', 'data-retry-checks', 'secondary') : ''}</div></section>${review && preview.prepared ? `<section class="reading-panel"><h2>Exact changes</h2><p>Review this prepared snapshot and its image before deciding. Later drafts remain private.</p>${diff(preview.previous, preview.prepared)}<p class="small">Snapshot ${e(preview.digest)}</p><label for="feedback">Participant-visible feedback</label><textarea id="feedback" maxlength="2000"></textarea><label for="private-note">Private organiser note</label><textarea id="private-note" maxlength="4000"></textarea><div class="portal-actions">${button('Approve this version', 'data-decision="approved"')}${button('Request changes', 'data-decision="changes_requested"', 'secondary')}</div></section>` : ''}<div class="detail section">${body}</div>`;
  $('[data-refresh]').onclick = () =>
    act(async () => {
      await showPreview(review);
      say('Submission status updated.');
    });
  const retry = content.querySelector<HTMLElement>('[data-retry-checks]');
  if (retry)
    retry.onclick = () =>
      act(async () => {
        if (preview.jobStatus === 'failed')
          await rpc('retry_job', { p_job: preview.jobId });
        if (await dispatch(preview.jobId))
          say('Checks are queued. Refresh to see their outcome.');
        else
          say(
            'Your submission is saved, but checks could not start. Choose “Retry checks” again in a moment.',
            true,
          );
      });
  content.querySelectorAll<HTMLElement>('[data-decision]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          await rpc('decide_revision', {
            p_revision: id,
            p_digest: preview.digest,
            p_expected_version: preview.decisionVersion,
            p_decision: b.dataset.decision,
            p_feedback: $<HTMLTextAreaElement>('#feedback').value,
            p_note: $<HTMLTextAreaElement>('#private-note').value,
          });
          say(
            b.dataset.decision === 'approved'
              ? 'Approved this exact version. Waiting for publication.'
              : 'Changes requested. The submitted text is unchanged.',
          );
          await showPreview(true);
        })),
  );
}
function diff(previous: unknown, next: unknown) {
  const a = (previous || {}) as Record<string, unknown>,
    b = (next || {}) as Record<string, unknown>;
  return (
    Object.keys(b)
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map(
        (k) =>
          `<h3>${e(k)}</h3><div class="diff"><div><strong>Previously live</strong><p>${e(typeof a[k] === 'object' ? JSON.stringify(a[k]) : (a[k] ?? 'Not previously published'))}</p></div><div><strong>Submitted version</strong><p>${e(typeof b[k] === 'object' ? JSON.stringify(b[k]) : b[k])}</p></div></div>`,
      )
      .join('') || '<p>No content changes from the verified page.</p>'
  );
}
async function showQueue() {
  const queue = await rpc<any[]>('get_review_queue');
  content.innerHTML = `<div class="reading-panel"><h2>Review queue</h2>${button('Refresh queue', 'data-refresh', 'secondary')}${queue.length ? queue.map((r) => `<article class="portal-card"><h3>${e(r.title)}</h3><p class="badge">${state(r.decision || r.jobStatus)}</p>${link('Review version', `/organiser/review/?revision=${r.revisionId}`)}</article>`).join('') : '<p>No submitted versions yet.</p>'}</div>`;
  $('[data-refresh]').onclick = () => act(showQueue);
}
async function showReleases() {
  const releases = await rpc<any[]>('get_releases'),
    queue = await rpc<any[]>('get_review_queue');
  content.innerHTML = `<section class="reading-panel"><h2>Prepare a complete release</h2><p>Select every intended project. Previously live projects must remain selected unless explicitly withdrawn. A source-only release keeps the same approved content.</p><form data-release-form><label for="source-commit">Reviewed application version</label><select id="source-commit" required><option value="">Choose a reviewed version</option>${context.sources.map((s) => `<option value="${e(s)}">${e(s)}</option>`).join('')}</select><div class="checks">${queue
    .filter((r) => r.decision === 'approved')
    .map(
      (r) =>
        `<label><input type="checkbox" name="revision" value="${e(r.revisionId)}" />${e(r.title)} · ${e(r.revisionId.slice(0, 8))}</label>`,
    )
    .join(
      '',
    )}</div><button class="button dark">Prepare release for review</button></form></section><section class="reading-panel"><h2>Release history</h2>${button('Refresh releases', 'data-refresh', 'secondary')}${releases.map((r) => `<article class="portal-card"><h3>Release ${e(r.sequence)}</h3><p class="badge">${state(r.status)}${r.live ? ' · Last verified release' : ''}</p><p>Source ${e(r.manifest.sourceCommit)} · ${r.manifest.projects.length} projects</p><p class="small">Manifest ${e(r.digest)}</p><details><summary>Inspect exact release content and removals</summary><pre>${e(JSON.stringify(r.manifest, null, 2))}</pre></details><div class="portal-actions">${r.status === 'prepared' ? button('Approve and queue this release', `data-publish="${e(r.id)}"`) : ''}${r.status === 'queued' ? button('Retry dispatch', `data-dispatch="${e(r.jobId)}"`, 'secondary') : ''}${r.status === 'failed' ? button('Retry failed release', `data-retry="${e(r.jobId)}"`, 'secondary') : ''}</div>${r.errorCode ? `<p>Needs attention: ${e(r.errorCode)}. The last verified release is recorded separately.</p>` : ''}${r.status === 'recovery_required' ? '<p>A deployment may have started. The activation lock is retained. Follow the owner recovery runbook before retrying.</p>' : ''}</article>`).join('') || '<p>No releases prepared yet.</p>'}</section>`;
  $<HTMLFormElement>('[data-release-form]').onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      await rpc('prepare_release', {
        p_source_commit: $<HTMLSelectElement>('#source-commit').value,
        p_revisions: new FormData(
          event.currentTarget as HTMLFormElement,
        ).getAll('revision'),
      });
      await showReleases();
      say(
        'Release prepared. Review the exact content and removals before approving.',
      );
    });
  };
  $('[data-refresh]').onclick = () => act(showReleases);
  content.querySelectorAll<HTMLElement>('[data-publish]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          const r = releases.find((r) => r.id === b.dataset.publish);
          const job = await rpc<string>('approve_and_queue_release', {
            p_release: r.id,
            p_digest: r.digest,
          });
          await dispatch(job);
          await showReleases();
          say(
            'Exact release approved and queued. It is not yet verified live.',
          );
        })),
  );
  content.querySelectorAll<HTMLElement>('[data-dispatch],[data-retry]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          const job = b.dataset.dispatch || b.dataset.retry!;
          if (b.dataset.retry) await rpc('retry_job', { p_job: job });
          await dispatch(job);
          await showReleases();
        })),
  );
}
async function showPeople() {
  const people = await rpc<any[]>('get_people'),
    projects = await rpc<ProjectSummary[]>('get_my_projects');
  content.innerHTML = `<section class="reading-panel"><h2>Project memberships</h2><p>Assignments use verified account identities. Revoking access takes effect on the next authorised request.</p>${people.map((p) => `<article class="portal-card"><h3>${e(p.project)}</h3><p>Account ${e(p.userId)}</p><p>${p.active ? 'Active membership' : 'Membership revoked'}</p>${button(p.active ? 'Revoke membership' : 'Restore membership', `data-member="${e(p.projectId)}" data-user="${e(p.userId)}" data-active="${!p.active}"`, 'secondary')}</article>`).join('') || '<p>No memberships yet.</p>'}</section><section class="reading-panel"><h2>Project withdrawals</h2><p>A withdrawal request excludes a project from the next release. Publish and verify the removal before describing it as removed from the public site.</p>${projects.map((p) => `<article class="portal-card"><h3>${e(p.title)}</h3>${button(p.withdrawn ? 'Lift withdrawal for review' : 'Request withdrawal', `data-exclude="${p.id}" data-withdrawn="${!p.withdrawn}"`, 'secondary')}</article>`).join('')}</section>${context.owner ? `<section class="reading-panel"><h2>Editing window</h2>${button(context.editingOpen ? 'Close participant editing' : 'Reopen participant editing', 'data-editing-window', 'secondary')}</section>` : ''}`;
  if (context.owner) {
    const createPanel = document.createElement('section');
    createPanel.className = 'reading-panel';
    createPanel.innerHTML = `<h2>Create a private project</h2><p>Create the project before assigning its participant. This saves an unfinished draft; it does not send an email or publish a page.</p><form data-create-project><label for="new-project-id">Page identifier</label><input id="new-project-id" required pattern="[a-z][a-z0-9-]{1,79}" maxlength="80" aria-describedby="new-project-id-help" /><p id="new-project-id-help" class="field-help">Use lowercase letters, numbers and hyphens, starting with a letter. This becomes the page address and stays fixed.</p>${field('new-project-title', 'New project title', '', 120, false, true)}${field('new-project-maker', 'New project contributor', '', 100, false, true)}<label for="new-project-theme">Project theme</label><select id="new-project-theme" required><option value="">Choose a theme</option><option value="image">Image</option><option value="world">World</option><option value="relation">Relation</option></select><button class="button dark">Create private project</button></form>`;
    content.prepend(createPanel);
    const creationRequest = crypto.randomUUID();
    $<HTMLFormElement>('[data-create-project]').onsubmit = (event) => {
      event.preventDefault();
      void act(async () => {
        await rpc('create_project', {
          p_request: creationRequest,
          p_public_id: $<HTMLInputElement>('#new-project-id').value.trim(),
          p_title: $<HTMLInputElement>('#f-new-project-title').value.trim(),
          p_maker: $<HTMLInputElement>('#f-new-project-maker').value.trim(),
          p_theme: $<HTMLSelectElement>('#new-project-theme').value,
        });
        await showPeople();
        say(
          'Private project created. Assign an account below when ready. No email was sent.',
        );
      });
    };
  }
  if (import.meta.env.PUBLIC_PARTICIPANT_AUTH_V2 === 'true') {
    const recovery = document.createElement('section');
    recovery.className = 'reading-panel';
    recovery.innerHTML = `<h2>Send a fresh sign-in code</h2><p>Recover an existing account without changing its project assignment. You will see the recipient before sending.</p>${[...new Map(people.filter((p) => p.active).map((p) => [p.userId, p])).values()].map((p) => `<p>${e(p.project)} ${button('Send a fresh sign-in code', `data-resend-user="${e(p.userId)}"`, 'secondary')}</p>`).join('')}`;
    content.append(recovery);
    recovery.querySelectorAll<HTMLElement>('[data-resend-user]').forEach(
      (b) =>
        (b.onclick = () =>
          act(async () => {
            const recipient = await rpc<{ email: string }>(
              'auth_resend_recipient',
              { p_user: b.dataset.resendUser },
            );
            if (
              !window.confirm(
                `Send a fresh sign-in code to ${recipient.email}? Their existing project assignment stays the same.`,
              )
            )
              return;
            const { data, error } = await client.functions.invoke(
              'participant-auth-resend',
              {
                body: {
                  userId: b.dataset.resendUser,
                  attemptKey: (b.dataset.authAttempt ||= newAttemptKey()),
                },
              },
            );
            if (!error) delete b.dataset.authAttempt;
            if (error || data?.status !== 'accepted') {
              say(
                'A new code is not confirmed. Check the cooldown or delivery record before sending again.',
                true,
              );
              return;
            }
            say(
              'Fresh code accepted by the mail service. Inbox delivery is not confirmed.',
            );
          })),
    );
  }
  content.querySelectorAll<HTMLElement>('[data-member]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          await rpc('set_membership', {
            p_project: b.dataset.member,
            p_user: b.dataset.user,
            p_active: b.dataset.active === 'true',
          });
          await showPeople();
          say('Membership updated.');
        })),
  );
  content.querySelectorAll<HTMLElement>('[data-exclude]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          await rpc('set_project_exclusion', {
            p_project: b.dataset.exclude,
            p_withdrawn: b.dataset.withdrawn === 'true',
          });
          await showPeople();
          say(
            'Publication policy updated. Prepare a new release to apply it publicly.',
          );
        })),
  );
  const toggle = content.querySelector<HTMLElement>('[data-editing-window]');
  if (toggle)
    toggle.onclick = () =>
      act(async () => {
        await rpc('set_editing_open', { p_open: !context.editingOpen });
        context = await rpc('portal_context');
        await showPeople();
      });
  const panel = document.createElement('section');
  panel.className = 'reading-panel';
  panel.innerHTML = `<h2>Invite an approved participant</h2><p>This sends an invitation email and assigns the selected project. Confirm the recipient and assignment before sending. The participant must verify the invitation code before requesting ordinary sign-in codes.</p><form data-provision><label for="recipient">Approved recipient email</label><input id="recipient" type="email" required maxlength="254" autocomplete="off" /><label for="assigned-project">Assigned project</label><select id="assigned-project" required><option value="">Choose a project</option>${projects.map((p) => `<option value="${e(p.id)}">${e(p.title)}</option>`).join('')}</select><label class="invitation-choice"><input type="checkbox" required /> I have checked this recipient and authorise sending the invitation</label><button class="button dark">Create access and send invitation</button></form><p data-provision-result></p>`;
  content.append(panel);
  const provisioningRequest = crypto.randomUUID();
  $<HTMLFormElement>('[data-provision]').onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      const { data, error } = await client.functions.invoke(
        'provision-participant',
        {
          body: {
            requestId: provisioningRequest,
            email: $<HTMLInputElement>('#recipient').value.trim(),
            projectId: $<HTMLSelectElement>('#assigned-project').value,
            sendInvitation: true,
          },
        },
      );
      if (error || data?.code !== 'ACCOUNT_PROVISIONED') {
        say(
          'Invitation or account creation is unconfirmed. An email may have been sent. Ask the owner to review this request before retrying.',
          true,
        );
        return;
      }
      await showPeople();
      say(
        'Participant access created and invitation accepted by the mail service. Receipt and mailbox verification are not yet confirmed.',
      );
    });
  };
  await showAdministration(projects, people);
}
async function showAdministration(projects: ProjectSummary[], people: any[]) {
  const admin = await rpc<any>('get_event_administration');
  const assignPanel = document.createElement('section');
  assignPanel.className = 'reading-panel';
  const accountIds = [
    ...new Set([
      identity,
      ...people.map((p) => p.userId),
      ...admin.roles.filter((r: any) => r.active).map((r: any) => r.userId),
    ]),
  ].filter(Boolean);
  assignPanel.innerHTML = `<h2>Assign an existing account</h2><p>Select a checked account already known to this workspace. New participants use the invitation form.</p><form data-assign-existing><label for="existing-project">Project to assign</label><select id="existing-project" required><option value="">Choose a project</option>${projects.map((p) => `<option value="${e(p.id)}">${e(p.title)}</option>`).join('')}</select><label for="existing-account">Existing participant account</label><select id="existing-account" required><option value="">Choose an account</option>${accountIds.map((id) => `<option value="${e(id)}">${id === identity ? 'My signed-in account' : e(id)}</option>`).join('')}</select><button class="button dark">Assign existing account</button></form>`;
  content.append(assignPanel);
  $<HTMLFormElement>('[data-assign-existing]').onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      await rpc('set_membership', {
        p_project: $<HTMLSelectElement>('#existing-project').value,
        p_user: $<HTMLSelectElement>('#existing-account').value,
        p_active: true,
      });
      await showPeople();
      say('Project assigned to the selected account. No email was sent.');
    });
  };
  const panel = document.createElement('section');
  panel.className = 'reading-panel';
  panel.innerHTML = `<h2>Publication settings</h2><p>Changes here require a new reviewed release. Enter confirmed public information only.</p><details><summary>Project placement and access information</summary><label for="metadata-project">Project to update</label><select id="metadata-project"><option value="">Choose a project</option>${projects.map((p) => `<option value="${e(p.id)}">${e(p.title)}</option>`).join('')}</select><div data-metadata-form></div></details><details><summary>Event contact and visitor information</summary><form data-event-form>${field('event-contact', 'Public contact email', admin.event.config.publicContact?.email || '', 254)}${field('event-access', 'Confirmed venue access information', admin.event.config.confirmedVenueAccessInformation || '', 2000, true)}${field('event-booking', 'Confirmed visitor registration link', admin.event.config.visitorRegistrationUrl || '', 1000)}<label><input id="portal-ready" type="checkbox" ${admin.event.config.participantEditingRoute === 'supabase-portal' ? 'checked' : ''} />The Supabase participant route has been verified for this environment</label><button class="button dark">Save event information for review</button></form></details><details><summary>Image permissions</summary><p>Revocation invalidates releases that use the image. A verified removal release is still required.</p>${admin.assets.map((a: any) => `<p>${e(a.project)} · ${e(a.id)} ${a.revoked ? 'Permission revoked' : button('Revoke image permission', `data-revoke-asset="${e(a.id)}"`, 'secondary')}</p>`).join('') || '<p>No uploaded images.</p>'}</details>${
    context.owner
      ? `<details><summary>Owner: organiser roles and reviewed application versions</summary><p>Only grant a role to an account whose identity and responsibilities have been checked. Your own role cannot be removed here.</p>${admin.roles.map((r: any) => `<p>${e(r.userId)} · ${e(r.role)} · ${r.active ? 'Active' : 'Inactive'} ${r.userId !== identity ? button(r.active ? 'Revoke role' : 'Restore role', `data-role-user="${e(r.userId)}" data-role="${e(r.role)}" data-role-active="${!r.active}"`, 'secondary') : ''}</p>`).join('')}<form data-grant-role><label for="role-user">Existing account</label><select id="role-user" required><option value="">Choose a checked account</option>${[
          ...new Set(people.map((p) => p.userId)),
        ]
          .filter((id) => id !== identity)
          .map((id) => `<option value="${e(id)}">${e(id)}</option>`)
          .join(
            '',
          )}</select><label for="role-kind">Role</label><select id="role-kind"><option value="organiser">Organiser</option><option value="owner">Backup owner</option></select><button class="button dark">Grant selected role</button></form><form data-register-source><label for="reviewed-source">Reviewed Git commit (40 characters)</label><input id="reviewed-source" required pattern="[a-f0-9]{40}" maxlength="40" autocomplete="off" /><button class="button dark">Register reviewed application version</button></form></details>`
      : ''
  }`;
  content.append(panel);
  $<HTMLSelectElement>('#metadata-project').onchange = () =>
    act(async () => {
      const id = $<HTMLSelectElement>('#metadata-project').value;
      if (!id) {
        $('[data-metadata-form]').replaceChildren();
        return;
      }
      const current = await rpc<PortalDraft>('get_project_draft', {
          p_project: id,
        }),
        m = current.metadata;
      $('[data-metadata-form]').innerHTML =
        `<form data-metadata-edit><label for="metadata-theme">Theme</label><select id="metadata-theme">${['image', 'world', 'relation'].map((t) => `<option value="${t}" ${m.theme === t ? 'selected' : ''}>${e(t)}</option>`).join('')}</select>${field('metadata-room', 'Confirmed location', String(m.room || ''), 200)}${field('metadata-duration', 'Confirmed duration', String(m.duration || ''), 200)}${field('metadata-schedule', 'Confirmed programme time', String(m.schedule || ''), 300)}${field('metadata-access', 'Confirmed project access notes', String(m.accessNotes || ''), 2000, true)}<button class="button dark">Save placement and access information</button></form>`;
      $<HTMLFormElement>('[data-metadata-edit]').onsubmit = (event) => {
        event.preventDefault();
        void act(async () => {
          const value = (s: string) =>
            $<HTMLInputElement>(s).value.trim() || null;
          await rpc('update_project_metadata', {
            p_project: id,
            p_expected_version: current.metadataVersion,
            p_fields: {
              ...m,
              theme: value('#metadata-theme'),
              room: value('#f-metadata-room'),
              duration: value('#f-metadata-duration'),
              schedule: value('#f-metadata-schedule'),
              accessNotes: value('#f-metadata-access'),
            },
          });
          await showPeople();
          say(
            'Project information version saved. A fresh submission and exact review are required.',
          );
        });
      };
    });
  $<HTMLFormElement>('[data-event-form]').onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      const value = (s: string) => $<HTMLInputElement>(s).value.trim() || null,
        contact = value('#f-event-contact'),
        booking = value('#f-event-booking');
      if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))
        throw new Error('REQUEST_FAILED');
      if (booking && new URL(booking).protocol !== 'https:')
        throw new Error('REQUEST_FAILED');
      await rpc('record_event_config', {
        p_expected_version: admin.event.version,
        p_config: {
          ...admin.event.config,
          publicContact: contact
            ? { label: 'Contact the organisers', email: contact }
            : null,
          confirmedVenueAccessInformation: value('#f-event-access'),
          visitorRegistrationUrl: booking,
          arrivalInformation: value('#f-event-arrival'),
          registrationPolicy: value('#f-event-policy'),
          publicSiteUrl: value('#f-event-origin'),
          participantEditingRoute: $<HTMLInputElement>('#portal-ready').checked
            ? 'supabase-portal'
            : 'not-configured',
        },
        p_themes: admin.event.themes,
      });
      await showPeople();
      say(
        'Event information saved for review. The public site has not changed.',
      );
    });
  };
  $<HTMLFormElement>('[data-event-form]')
    .querySelector('button')!
    .insertAdjacentHTML(
      'beforebegin',
      field(
        'event-arrival',
        'Confirmed arrival information',
        admin.event.config.arrivalInformation || '',
        3000,
        true,
      ) +
        field(
          'event-policy',
          'Confirmed entry and booking policy',
          admin.event.config.registrationPolicy || '',
          3000,
          true,
        ) +
        field(
          'event-origin',
          'Approved public website origin',
          admin.event.config.publicSiteUrl || '',
          1000,
        ),
    );
  panel.querySelectorAll<HTMLElement>('[data-revoke-asset]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          await rpc('revoke_asset', { p_asset: b.dataset.revokeAsset });
          await showPeople();
          say(
            'Image permission revoked. Prepare and verify a removal release.',
          );
        })),
  );
  panel.querySelectorAll<HTMLElement>('[data-role-user]').forEach(
    (b) =>
      (b.onclick = () =>
        act(async () => {
          await rpc('set_event_role', {
            p_user: b.dataset.roleUser,
            p_role: b.dataset.role,
            p_active: b.dataset.roleActive === 'true',
          });
          await showPeople();
          say('Account role updated.');
        })),
  );
  const roles = panel.querySelector<HTMLFormElement>('[data-grant-role]');
  if (roles)
    roles.onsubmit = (event) => {
      event.preventDefault();
      void act(async () => {
        await rpc('set_event_role', {
          p_user: $<HTMLSelectElement>('#role-user').value,
          p_role: $<HTMLSelectElement>('#role-kind').value,
          p_active: true,
        });
        await showPeople();
        say('Selected account role granted.');
      });
    };
  const source = panel.querySelector<HTMLFormElement>('[data-register-source]');
  if (source)
    source.onsubmit = (event) => {
      event.preventDefault();
      void act(async () => {
        await rpc('register_reviewed_source', {
          p_commit: $<HTMLInputElement>('#reviewed-source').value,
        });
        context = await rpc('portal_context');
        say('Reviewed source registered. Prepare a release to select it.');
      });
    };
}
async function load() {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    login.hidden = false;
    content.hidden = true;
    say('Sign in using your invited email address.');
    return;
  }
  if (identity && identity !== data.user.id) clearPrivate();
  identity = data.user.id;
  context = await rpc<PortalContext>('portal_context');
  if (context.environment !== import.meta.env.PUBLIC_PORTAL_ENVIRONMENT) {
    clearPrivate();
    throw new Error('REQUEST_FAILED');
  }
  login.hidden = true;
  $('[data-private-nav]').hidden = false;
  root
    .querySelectorAll<HTMLElement>('[data-organiser-link]')
    .forEach((el) => (el.hidden = !context.organiser));
  const surface = root.dataset.portal;
  if (
    ['queue', 'review', 'releases', 'people'].includes(surface!) &&
    !context.organiser
  ) {
    clearPrivate();
    say('This account does not have organiser access.', true);
    return;
  }
  if (context.organiser) {
    const { data: aal } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    $('[data-mfa]').hidden = aal?.currentLevel === 'aal2';
  }
  content.hidden = false;
  if (draft && dirty) {
    say('Signed in again. Your unsaved text is still here. Save when ready.');
    return;
  }
  switch (surface) {
    case 'login':
      await navigateParticipant('/participant/');
      return;
    case 'dashboard':
      await showDashboard();
      break;
    case 'editor': {
      const id = new URLSearchParams(location.search).get('project');
      if (!id) throw new Error('REQUEST_FAILED');
      draft = await rpc<PortalDraft>('get_project_draft', { p_project: id });
      renderEditor();
      say('Loaded your saved draft.');
      break;
    }
    case 'preview':
      await showPreview();
      break;
    case 'queue':
      await showQueue();
      break;
    case 'review':
      await showPreview(true);
      break;
    case 'releases':
      await showReleases();
      break;
    case 'people':
      await showPeople();
      break;
  }
  if (surface !== 'editor') say('Workspace loaded.');
}
async function start() {
  // Never accept or retain credentials or return destinations in browser URLs.
  const cleanUrl = new URL(location.href);
  cleanUrl.hash = '';
  for (const name of [
    'email',
    'code',
    'token',
    'token_hash',
    'access_token',
    'refresh_token',
    'next',
  ])
    cleanUrl.searchParams.delete(name);
  if (cleanUrl.href !== location.href) history.replaceState(null, '', cleanUrl);
  const url = import.meta.env.PUBLIC_SUPABASE_URL,
    key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    env = import.meta.env.PUBLIC_PORTAL_ENVIRONMENT;
  if (!url || !key || !env) {
    say(
      'The participant editor is not connected yet. Use your existing organiser contact for help.',
    );
    return;
  }
  try {
    checkPortalEnvironment(url, env, location.origin);
  } catch {
    say(
      'Editor configuration needs organiser attention. Sign-in is unavailable.',
      true,
    );
    return;
  }
  let storage: Storage | undefined;
  try {
    sessionStorage.setItem('createch-auth-check', '1');
    sessionStorage.removeItem('createch-auth-check');
    storage = sessionStorage;
  } catch {
    tabStorageAvailable = false;
    say(
      'Session storage is unavailable. Sign-in will last only while this page stays open.',
    );
  }
  const memory = new Map<string, string>();
  if (!tabStorageAvailable) {
    root.addEventListener('click', (event) => {
      const a = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!a) return;
      const url = new URL(a.href);
      if (
        url.origin !== location.origin ||
        !/^\/participant\/(?:editor\/|preview\/)?$/.test(url.pathname)
      )
        return;
      event.preventDefault();
      if (
        dirty &&
        !window.confirm('Leave this draft without saving your latest changes?')
      )
        return;
      clearTimeout(autosaveTimer);
      draft = null;
      dirty = false;
      void act(() => navigateParticipant(url.href));
    });
  }
  client = createClient(url, key, {
    auth: {
      storage: storage || {
        getItem: (k) => memory.get(k) || null,
        setItem: (k, v) => {
          memory.set(k, v);
        },
        removeItem: (k) => {
          memory.delete(k);
        },
      },
      persistSession: true,
      detectSessionInUrl: false,
      autoRefreshToken: true,
    },
  });
  if (import.meta.env.PUBLIC_PARTICIPANT_AUTH_V2 === 'true') {
    installParticipantSignIn(root, client, say, () => act(load));
  } else {
    let cooldown = 0;
    $<HTMLFormElement>('[data-email-form]').onsubmit = (event) => {
      event.preventDefault();
      void act(async () => {
        if (Date.now() < cooldown) return;
        const email = $<HTMLInputElement>('#email').value.trim();
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (error) {
          say(
            'A code could not be requested. If this is your first visit, use the invitation code already sent by the organiser. Otherwise check the address or wait before retrying.',
            true,
          );
          return;
        }
        cooldown = Date.now() + 60000;
        $<HTMLInputElement>('#first-invitation').checked = false;
        $('[data-code-form]').hidden = false;
        say(
          'If this address has been invited, a code will be sent. Check your email.',
        );
        $<HTMLInputElement>('#email-code').focus();
        const b = $<HTMLButtonElement>('[data-send-code]');
        b.disabled = true;
        const timer = setInterval(() => {
          const seconds = Math.max(
            0,
            Math.ceil((cooldown - Date.now()) / 1000),
          );
          b.textContent = seconds ? `Resend in ${seconds}s` : 'Send email code';
          if (!seconds) {
            b.disabled = false;
            clearInterval(timer);
          }
        }, 1000);
      });
    };
    $<HTMLFormElement>('[data-code-form]').onsubmit = (event) => {
      event.preventDefault();
      void act(async () => {
        if (!$<HTMLInputElement>('#email').reportValidity()) return;
        const { error } = await client.auth.verifyOtp({
          email: $<HTMLInputElement>('#email').value.trim(),
          token: $<HTMLInputElement>('#email-code').value.trim(),
          type: $<HTMLInputElement>('#first-invitation').checked
            ? 'invite'
            : 'email',
        });
        $<HTMLInputElement>('#email-code').value = '';
        if (error) {
          say(
            'That code could not be verified. Use a fresh code and try again.',
            true,
          );
          return;
        }
        $<HTMLInputElement>('#first-invitation').checked = false;
        await load();
      });
    };
  }
  $('[data-signout]').onclick = () =>
    act(async () => {
      if (
        dirty &&
        !window.confirm('You have unsaved changes. Sign out and discard them?')
      )
        return;
      const { error } = await client.auth.signOut({ scope: 'local' });
      clearPrivate();
      $('[data-private-nav]').hidden = true;
      $('[data-mfa]').hidden = true;
      login.hidden = false;
      say(
        error
          ? 'Local private view cleared. Sign-out could not be confirmed; close this tab.'
          : 'Signed out. Private content cleared.',
        !!error,
      );
    });
  $('[data-mfa-start]').onclick = () =>
    act(async () => {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw new Error();
      const existing = data.totp.find((f) => f.status === 'verified');
      if (existing) {
        factorId = existing.id;
        $('[data-mfa-setup]').replaceChildren();
      } else if (
        data.all.some((f) => f.id === factorId && f.status === 'unverified') &&
        $('[data-mfa-setup] img')
      ) {
        // Keep the same visible enrolment when this button is clicked again.
      } else {
        // A refresh loses the QR secret. Replace only this app's unfinished
        // enrolments; never remove a verified factor or another app's factor.
        for (const factor of data.all.filter(
          (f) =>
            f.factor_type === 'totp' &&
            f.status === 'unverified' &&
            f.friendly_name === 'CreaTech organiser',
        )) {
          const { error } = await client.auth.mfa.unenroll({
            factorId: factor.id,
          });
          if (error) throw new Error();
        }
        const result = await client.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'CreaTech organiser',
        });
        if (result.error) throw new Error();
        factorId = result.data.id;
        const image = document.createElement('img');
        image.alt = 'Scan this QR code in your authenticator app';
        // supabase-js already returns an SVG data URL, ready for img.src.
        image.src = result.data.totp.qr_code;
        $('[data-mfa-setup]').replaceChildren(image);
      }
      $('[data-mfa-form]').hidden = false;
      $<HTMLInputElement>('#mfa-code').focus();
    });
  $<HTMLFormElement>('[data-mfa-form]').onsubmit = (event) => {
    event.preventDefault();
    void act(async () => {
      const { error } = await client.auth.mfa.challengeAndVerify({
        factorId,
        code: $<HTMLInputElement>('#mfa-code').value,
      });
      $<HTMLInputElement>('#mfa-code').value = '';
      if (error) {
        say('Authenticator code could not be verified.', true);
        return;
      }
      $('[data-mfa-setup]').replaceChildren();
      await load();
      say('Organiser access verified.');
    });
  };
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && identity) {
      login.hidden = false;
      say(
        'Your session ended. Sign in again to continue. Unsaved text stays on this page.',
        true,
      );
    }
    if (session?.user.id && identity && session.user.id !== identity) {
      clearPrivate();
      say('Account changed. Previous private content cleared.');
    }
  });
  await act(load);
  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
  window.addEventListener('pagehide', () => {
    clearPrivate();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
}
void start();
