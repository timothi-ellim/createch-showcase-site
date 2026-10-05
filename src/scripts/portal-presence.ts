import { escapeHtml as e } from '../lib/project-renderer';
import {
  eventSlots,
  hoursLabel,
  modeLabel,
  selectionWindows,
  type PresenceEvent,
  type PresenceRecord,
  type PresenceDecision,
  type PresenceSelection,
} from '../lib/presence';

export interface WorkspaceAPI {
  rpc: <T = any>(name: string, args?: Record<string, unknown>) => Promise<T>;
  act: (fn: () => Promise<void>, saving?: boolean) => Promise<void>;
  say: (message: string, error?: boolean) => void;
  dirty: (value: boolean) => void;
  busy: () => boolean;
}
export const projectNav = (project: string, current: string) =>
  `<nav class="project-workspace-nav" aria-label="This project">${[
    ['editor', 'Project profile'],
    ['presence', 'Booth availability'],
    ['qr', 'Project QR'],
  ]
    .map(
      ([route, label]) =>
        `<a href="/participant/${route}/?project=${encodeURIComponent(project)}" ${current === route ? 'aria-current="page"' : ''}>${label}</a>`,
    )
    .join('')}</nav>`;
// Keep historical responses intact. The new interface edits booth time slots;
// the existing whole_event representation remains compatible with saved records.
function boothSelection(
  event: PresenceEvent,
  selection: PresenceSelection | null,
): PresenceSelection {
  if (
    selection?.mode === 'whole_event' ||
    (selection?.mode === 'selected_slots' &&
      selection.slots.length === eventSlots(event).length)
  )
    return { mode: 'whole_event', slots: [] };
  return {
    mode: 'selected_slots',
    slots:
      selection?.mode === 'selected_slots'
        ? [...selection.slots].sort((a, b) => a - b)
        : [],
  };
}
export function presenceControls(
  event: PresenceEvent,
  selection: PresenceSelection | null,
  prefix = 'presence',
): string {
  return `<fieldset class="presence-slots" data-slot-fieldset><legend>Choose your booth times</legend><p id="${prefix}-help" class="field-help">Tick each ${event.presenceSlotMinutes ?? 30}-minute period you will be at your booth or installation. Leave breaks and time exploring unticked. All times are UK time.</p><div class="presence-shortcuts"><button type="button" class="button secondary" data-select-all-hours>Select all hours</button><button type="button" class="text-button" data-clear-hours>Clear selection</button></div><div class="presence-slot-grid presence-booth-grid">${eventSlots(
    event,
  )
    .map(
      (slot, i) =>
        `<label class="presence-choice"><input type="checkbox" name="${prefix}-slot" value="${i}" ${selection?.mode === 'whole_event' || selection?.slots.includes(i) ? 'checked' : ''} aria-label="${slot.start}–${slot.end}" aria-describedby="${prefix}-help"/><span>${slot.start}<span aria-hidden="true"> – </span>${slot.end}</span></label>`,
    )
    .join('')}</div></fieldset>`;
}
function readSelection(
  form: HTMLElement,
  prefix = 'presence',
): PresenceSelection | null {
  const inputs = [
    ...form.querySelectorAll<HTMLInputElement>(`input[name="${prefix}-slot"]`),
  ];
  if (!inputs.length) return null;
  const slots = inputs.filter((x) => x.checked).map((x) => Number(x.value));
  return slots.length === inputs.length
    ? { mode: 'whole_event', slots: [] }
    : { mode: 'selected_slots', slots };
}
function bindShortcuts(form: HTMLElement) {
  for (const [selector, checked] of [
    ['[data-select-all-hours]', true],
    ['[data-clear-hours]', false],
  ] as const) {
    form.querySelector<HTMLButtonElement>(selector)!.onclick = () => {
      form
        .querySelectorAll<HTMLInputElement>('input[name$="-slot"]')
        .forEach((input) => {
          input.checked = checked;
        });
      form.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }
}
const reviewLabel = (r: PresenceRecord) => {
  if (!r.latest)
    return r.draft ? 'Draft saved — not submitted' : 'No submission';
  if (r.latest.scheduleKey !== r.scheduleKey) return 'Needs reconfirmation';
  if (r.latest.decision?.decision === 'changes_requested')
    return 'Changes requested';
  if (!r.latest.decision) return 'Needs review';
  if (r.live?.decisionId === r.latest.decision.id) return 'Published';
  return 'Approved — awaiting release';
};
function publicStatus(r: PresenceRecord) {
  return r.live?.windows.length
    ? `Currently on the website: ${hoursLabel(r.live.windows)}. A new draft does not change these hours.`
    : 'No booth availability is currently published for this project.';
}
export async function mountPresenceEditor(
  host: HTMLElement,
  api: WorkspaceAPI,
  project: string,
): Promise<() => void> {
  let record = await api.rpc<PresenceRecord>('get_presence', {
    p_project: project,
  });
  let version = record.draft?.version ?? 0,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    replacement: (() => void) | undefined;
  let request = crypto.randomUUID(),
    submittedVersion = -1;
  const changedEvent =
    !!record.draft && record.draft.scheduleKey !== record.scheduleKey;
  let saved = boothSelection(
    record.event,
    changedEvent ? null : (record.draft?.selection ?? null),
  );
  const legacyResponse =
    !changedEvent &&
    record.draft &&
    ['not_attending', 'unsure'].includes(record.draft.selection.mode);
  host.innerHTML = `${projectNav(project, 'presence')}<section class="reading-panel presence-editor"><p class="eyebrow">${e(record.title)}</p><h2>When can visitors find you at your booth?</h2><p class="presence-event">${e(record.event.dateLabel)} · ${e(record.event.startTime)}–${e(record.event.endTime)} · UK time</p><p>Everyone is expected to attend in person. Select when you will be at your booth or installation and available to talk with visitors.</p><p class="presence-explainer"><strong>Unticked times are for breaks or roaming.</strong> They do not mean you are absent from the showcase.</p>${changedEvent ? '<p class="notice">The showcase hours changed. Please choose your booth times again; your previous submission has been preserved.</p>' : ''}${legacyResponse ? '<p class="notice">Your earlier response did not include booth times. Select your availability below; your previous submission is preserved until you submit again.</p>' : ''}${record.latest?.decision?.feedback ? `<p class="notice">${e(record.latest.decision.feedback)}</p>` : ''}
 <form data-presence-form novalidate>${presenceControls(record.event, saved)}<p id="presence-error" class="presence-error" role="alert"></p><div class="presence-summary"><h3>Your booth availability</h3><p data-presence-summary aria-live="polite"></p><p class="small" data-presence-total></p><p class="small">Your choices autosave privately. Submit them for organiser review before they can appear on your public project page.</p></div><div data-presence-conflict hidden><h3>A newer draft exists</h3><p>Your selection is still here.</p><button type="button" class="button secondary" data-compare-presence>Compare saved hours</button><div data-presence-comparison></div></div><div data-editor-actions class="presence-actions"><p data-editor-status role="status">${record.draft && !changedEvent ? 'Loaded your saved draft.' : 'Tick your booth times to begin.'}</p><div class="portal-actions"><button class="button dark" type="submit">Submit booth times for review</button><button class="button secondary" type="button" data-save-presence>Save draft</button></div></div></form><details class="presence-public-status"><summary>Submission and public status</summary><p data-presence-review>${e(reviewLabel(record))}</p><p class="small" data-presence-live>${e(publicStatus(record))}</p></details></section>`;
  const form = host.querySelector<HTMLFormElement>('[data-presence-form]')!,
    error = form.querySelector<HTMLElement>('#presence-error')!;
  const draftStatus = document.createElement('p');
  draftStatus.className = 'small';
  draftStatus.dataset.presenceDraft = '';
  form.querySelector('[data-editor-actions]')!.before(draftStatus);
  const showDraftStatus = () => {
    draftStatus.textContent =
      version > (record.latest?.draftVersion ?? 0)
        ? record.latest
          ? 'New changes saved — not submitted. Your previous submission is unchanged.'
          : 'Draft saved — not submitted for review.'
        : '';
  };
  showDraftStatus();
  function update() {
    const selection = readSelection(form);
    const summary = selection
      ? hoursLabel(selectionWindows(record.event, selection, false))
      : '';
    form.querySelector<HTMLElement>('[data-presence-summary]')!.textContent =
      summary || 'No booth times selected yet.';
    const count = form.querySelectorAll(
      'input[type="checkbox"]:checked',
    ).length;
    const total = count * (record.event.presenceSlotMinutes ?? 30);
    const duration = [
      Math.floor(total / 60) ? `${Math.floor(total / 60)} hr` : '',
      total % 60 ? `${total % 60} min` : '',
    ]
      .filter(Boolean)
      .join(' ');
    form.querySelector<HTMLElement>('[data-presence-total]')!.textContent =
      count
        ? `${count} of ${eventSlots(record.event).length} periods selected · ${duration} at your booth`
        : 'Select at least one period. Contact the organiser if you need help arranging booth cover.';
    error.textContent = '';
    api.dirty(JSON.stringify(selection) !== JSON.stringify(saved));
  }
  function valid(complete: boolean) {
    const selection = readSelection(form);
    try {
      if (!selection) throw new Error();
      selectionWindows(record.event, selection, complete);
      return selection;
    } catch {
      error.textContent =
        'Select at least one time period when visitors can find you at your booth.';
      form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
      throw new Error('FIELD_VALIDATION_SHOWN');
    }
  }
  async function save() {
    clearTimeout(timer);
    const selection = valid(false);
    let result: { version: number; updatedAt: string };
    try {
      result = await api.rpc('save_presence_draft', {
        p_project: project,
        p_expected_version: version,
        p_event_version: record.eventVersion,
        p_selection: selection,
      });
    } catch (err) {
      if ((err as Error).message === 'DRAFT_CONFLICT')
        form.querySelector<HTMLElement>('[data-presence-conflict]')!.hidden =
          false;
      throw err;
    }
    if (disposed) return;
    if (result.version !== version) {
      request = crypto.randomUUID();
      submittedVersion = -1;
    }
    version = result.version;
    saved = selection;
    showDraftStatus();
    const stillDirty =
      JSON.stringify(readSelection(form)) !== JSON.stringify(saved);
    api.dirty(stillDirty);
    api.say(
      stillDirty
        ? 'Hours saved. Your newer selection is still unsaved.'
        : `Private hours saved at ${new Date(result.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (your local time). Not submitted.`,
    );
  }
  const performSave = () => api.act(save, true);
  function autosave() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (disposed) return;
      if (api.busy()) {
        autosave();
        return;
      }
      void performSave();
    }, 1200);
  }
  form.addEventListener('change', () => {
    update();
    api.say('Unsaved hours changes.');
    autosave();
  });
  bindShortcuts(form);
  form.querySelector<HTMLButtonElement>('[data-save-presence]')!.onclick = () =>
    void performSave();
  form.onsubmit = (ev) => {
    ev.preventDefault();
    clearTimeout(timer);
    void api.act(async () => {
      const selection = valid(true);
      if (JSON.stringify(saved) !== JSON.stringify(selection)) await save();
      if (JSON.stringify(readSelection(form)) !== JSON.stringify(saved)) {
        api.say(
          'Your selection changed while saving. Check it and submit again.',
        );
        return;
      }
      if (submittedVersion !== version) {
        await api.rpc('submit_presence', {
          p_project: project,
          p_expected_version: version,
          p_request: request,
        });
        submittedVersion = version;
      }
      record = await api.rpc<PresenceRecord>('get_presence', {
        p_project: project,
      });
      showDraftStatus();
      host.querySelector<HTMLElement>('[data-presence-review]')!.textContent =
        reviewLabel(record);
      api.say(
        'Booth times submitted for review. Your current public page stays the same until review and publication.',
      );
    });
  };
  form.querySelector<HTMLButtonElement>('[data-compare-presence]')!.onclick =
    () =>
      void api.act(async () => {
        const latest = await api.rpc<PresenceRecord>('get_presence', {
          p_project: project,
        });
        const box = form.querySelector<HTMLElement>(
          '[data-presence-comparison]',
        )!;
        box.innerHTML = `<p>Saved elsewhere: ${e(latest.draft ? modeLabel(latest.draft.selection.mode) + ' · ' + hoursLabel(selectionWindows(latest.event, latest.draft.selection, false)) : 'No draft')}.</p><p>Your current selection remains in the form above.</p><button type="button" class="button secondary" data-use-my-hours>Save my selection as the next version</button><button type="button" class="text-button" data-reload-hours>Reload saved hours and discard my selection</button>`;
        box.querySelector<HTMLButtonElement>('[data-use-my-hours]')!.onclick =
          () =>
            void api.act(async () => {
              if (latest.scheduleKey !== record.scheduleKey)
                throw new Error('PRESENCE_EVENT_CHANGED');
              version = latest.draft?.version ?? 0;
              record.eventVersion = latest.eventVersion;
              await save();
              form.querySelector<HTMLElement>(
                '[data-presence-conflict]',
              )!.hidden = true;
            });
        box.querySelector<HTMLButtonElement>('[data-reload-hours]')!.onclick =
          () =>
            void api.act(async () => {
              clearTimeout(timer);
              disposed = true;
              api.dirty(false);
              replacement = await mountPresenceEditor(host, api, project);
            });
      });
  update();
  if (record.withdrawn)
    form
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')
      .forEach((el) => {
        el.disabled = true;
        el.setAttribute('data-permanently-disabled', '');
      });
  return () => {
    disposed = true;
    clearTimeout(timer);
    replacement?.();
  };
}

export async function showPresenceOverview(
  host: HTMLElement,
  api: WorkspaceAPI,
) {
  const records = await api.rpc<PresenceRecord[]>('get_presence_overview');
  host.innerHTML = `<section class="reading-panel"><h2>Artist hours</h2><p>Track submitted plans separately from what visitors can currently see. Counts describe projects with planned artist presence, not staffing levels.</p><div class="portal-actions"><button type="button" class="button dark" data-hours-view="responses" aria-pressed="true">Responses</button><button type="button" class="button secondary" data-hours-view="coverage" aria-pressed="false">Coverage</button></div><div data-responses><label for="hours-filter">Show responses</label><select id="hours-filter"><option value="all">All projects</option>${['No submission', 'Draft saved — not submitted', 'Needs review', 'Needs reconfirmation', 'Changes requested', 'Approved — awaiting release', 'Published'].map((v) => `<option>${v}</option>`).join('')}</select><p data-response-count role="status"></p><div class="hours-response-list">${records.map((r) => `<article class="hours-response" data-response-state="${e(reviewLabel(r))}"><div><h3>${e(r.title)}</h3><p>${e(r.maker)}</p></div><dl><div><dt>Response</dt><dd>${e(r.latest ? modeLabel(r.latest.selection.mode) : r.draft ? 'Draft saved — not submitted' : 'No response')}</dd></div><div><dt>Submitted hours</dt><dd>${e(r.latest ? hoursLabel(r.latest.windows) || 'No positive hours proposed' : '—')}</dd></div><div><dt>Live hours</dt><dd>${e(hoursLabel(r.live?.windows ?? []) || 'None published')}</dd></div><div><dt>Review</dt><dd>${e(reviewLabel(r))}</dd></div></dl>${r.latest ? `<a class="text-link" href="/organiser/presence-review/?project=${r.projectId}&revision=${r.latest.id}">Review hours for ${e(r.title)} ↗</a>` : '<p class="small">Waiting for submission</p>'}</article>`).join('') || '<p>No active projects.</p>'}</div></div><div data-coverage hidden><label for="coverage-source">Schedule to show</label><select id="coverage-source"><option value="approved">Approved for release</option><option value="submitted">Latest submitted proposals</option><option value="live">Verified live hours</option></select><p data-coverage-context></p><div data-coverage-table></div></div></section>`;
  const filter = host.querySelector<HTMLSelectElement>('#hours-filter')!;
  const filterRows = () => {
    let n = 0;
    host
      .querySelectorAll<HTMLElement>('[data-response-state]')
      .forEach((el) => {
        el.hidden =
          filter.value !== 'all' && el.dataset.responseState !== filter.value;
        if (!el.hidden) n++;
      });
    host.querySelector<HTMLElement>('[data-response-count]')!.textContent =
      `${n} ${n === 1 ? 'project' : 'projects'}${n ? '' : '. Choose All projects to clear the filter.'}`;
  };
  filter.onchange = filterRows;
  filterRows();
  const source = host.querySelector<HTMLSelectElement>('#coverage-source')!;
  function coverage() {
    const event = records[0]?.event;
    const target = host.querySelector<HTMLElement>('[data-coverage-table]')!;
    if (!event) {
      target.textContent = 'No active projects.';
      return;
    }
    const ranges = records.map((r) =>
      source.value === 'live'
        ? (r.live?.windows ?? [])
        : source.value === 'submitted'
          ? r.latest?.scheduleKey === r.scheduleKey
            ? r.latest.windows
            : []
          : r.approved?.scheduleKey === r.scheduleKey
            ? r.approved.windows
            : [],
    );
    const slots = eventSlots(event);
    const has = (row: number, slot: { start: string; end: string }) =>
      ranges[row].some((w) => w.start <= slot.start && w.end >= slot.end);
    host.querySelector<HTMLElement>('[data-coverage-context]')!.textContent =
      `${source.selectedOptions[0].text}. ${event.dateLabel}, UK time. Incompatible proposals are excluded; published hours are shown as actually released.`;
    target.innerHTML = `<div class="coverage-scroll" role="region" aria-label="Artist hours table" tabindex="0"><table class="coverage-table"><caption>Projects with planned artist presence by time period</caption><thead><tr><th scope="col">Project</th>${slots.map((s) => `<th scope="col">${s.start}<br/>${s.end}</th>`).join('')}</tr></thead><tbody>${records.map((r, i) => `<tr><th scope="row">${e(r.title)}</th>${slots.map((s) => `<td class="${has(i, s) ? 'covered' : ''}">${has(i, s) ? 'Yes' : '—'}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Projects present</th>${slots.map((s) => `<td>${records.filter((_, i) => has(i, s)).length}</td>`).join('')}</tr></tfoot></table></div><ul class="coverage-text">${records.map((r, i) => `<li><strong>${e(r.maker || r.title)}</strong>: ${e(hoursLabel(ranges[i]) || 'No hours in this view')}</li>`).join('')}</ul>`;
  }
  source.onchange = coverage;
  coverage();
  host.querySelectorAll<HTMLButtonElement>('[data-hours-view]').forEach(
    (b) =>
      (b.onclick = () => {
        const cover = b.dataset.hoursView === 'coverage';
        host.querySelector<HTMLElement>('[data-responses]')!.hidden = cover;
        host.querySelector<HTMLElement>('[data-coverage]')!.hidden = !cover;
        host.querySelectorAll('[data-hours-view]').forEach((x) => {
          x.setAttribute('aria-pressed', String(x === b));
          x.classList.toggle('dark', x === b);
          x.classList.toggle('secondary', x !== b);
        });
      }),
  );
}

export async function showPresenceReview(
  host: HTMLElement,
  api: WorkspaceAPI,
  project: string,
  revision: string | null,
) {
  const r = await api.rpc<
    PresenceRecord & {
      reviewHistory: (PresenceDecision & {
        note: string;
        confirmedPositiveOverride: boolean;
      })[];
    }
  >('get_presence_review', {
    p_project: project,
  });
  if (!r.latest || (revision && revision !== r.latest.id))
    throw new Error('STALE_REVIEW');
  const submitted = r.latest;
  host.innerHTML = `<section class="reading-panel"><a class="text-link" href="/organiser/presence/">← All artist hours</a><h2>${e(r.title)}</h2><p>${e(r.maker)} · ${e(r.event.dateLabel)} · UK time</p><p class="small">Submission ${e(submitted.id)} · ${e(new Date(submitted.submittedAt).toLocaleString())}</p>${submitted.scheduleKey !== r.scheduleKey ? '<p class="notice">The event hours changed. Request reconfirmation or remove incompatible public hours.</p>' : ''}<div class="presence-review-columns"><section><h3>Submitted proposal</h3><p>${e(modeLabel(submitted.selection.mode))}</p><p>${e(hoursLabel(submitted.windows) || 'No positive hours proposed')}</p></section><section><h3>Approved for next release</h3><p>${e(r.approved ? hoursLabel(r.approved.windows) || 'Remove public hours' : 'No decision yet')}</p></section><section><h3>Currently live</h3><p>${e(hoursLabel(r.live?.windows ?? []) || 'No hours published')}</p></section></div><form data-presence-review-form><details><summary>Adjust public hours</summary><p>The submitted proposal is preserved. Explain an adjustment below.</p>${presenceControls(r.event, submitted.scheduleKey === r.scheduleKey ? submitted.selection : null, 'review')}</details><label for="presence-feedback">Feedback for the participant</label><textarea id="presence-feedback" maxlength="2000"></textarea><label for="presence-reason">Reason for adjusting or removing hours</label><textarea id="presence-reason" maxlength="2000"></textarea><label class="presence-choice"><input type="checkbox" id="presence-confirmed"/><span>I have separately confirmed any positive hours that replace an unsure or not-attending response.</span></label><label for="presence-note">Private organiser note</label><textarea id="presence-note" maxlength="4000"></textarea><div data-editor-actions><p data-editor-status role="status"></p><div class="portal-actions"><button type="button" class="button dark" data-decision="approved">Approve as submitted</button><button type="button" class="button secondary" data-adjust>Approve adjusted hours</button><button type="button" class="button secondary" data-decision="changes_requested">Request changes</button><button type="button" class="text-button" data-decision="removed">Remove public hours</button></div></div></form></section>`;
  const form = host.querySelector<HTMLFormElement>('form')!;
  if (r.reviewHistory.length) {
    const history = document.createElement('details');
    history.className = 'presence-review-history';
    history.innerHTML = `<summary>Previous reviews (${r.reviewHistory.length})</summary><ol>${r.reviewHistory.map((d) => `<li><h3>Decision ${d.version}: ${e(d.decision.replace('_', ' '))}</h3><p>${e(hoursLabel(d.windows) || 'No public hours in this decision')}</p>${d.feedback ? `<p><strong>Participant feedback:</strong> ${e(d.feedback)}</p>` : ''}${d.reason ? `<p><strong>Reason:</strong> ${e(d.reason)}</p>` : ''}${d.confirmedPositiveOverride ? '<p>Positive hours were separately confirmed with the participant.</p>' : ''}${d.note ? `<p><strong>Private organiser note:</strong> ${e(d.note)}</p>` : ''}</li>`).join('')}</ol>`;
    form.before(history);
  }
  form.onsubmit = (ev) => ev.preventDefault();
  bindShortcuts(form);
  let lastPayload = '',
    request = crypto.randomUUID();
  async function decide(decision: string, adjust = false) {
    const selection = adjust ? readSelection(form, 'review') : null;
    if (adjust && !selection) throw new Error('INVALID_PRESENCE');
    const payload = {
      p_revision: submitted.id,
      p_digest: submitted.digest,
      p_expected_version: r.decisionVersion,
      p_decision: decision,
      p_selection: selection,
      p_feedback: (
        form.querySelector('#presence-feedback') as HTMLTextAreaElement
      ).value,
      p_reason: (form.querySelector('#presence-reason') as HTMLTextAreaElement)
        .value,
      p_note: (form.querySelector('#presence-note') as HTMLTextAreaElement)
        .value,
      p_confirmed: (
        form.querySelector('#presence-confirmed') as HTMLInputElement
      ).checked,
    };
    if (JSON.stringify(payload) !== lastPayload) {
      request = crypto.randomUUID();
      lastPayload = JSON.stringify(payload);
    }
    await api.rpc('decide_presence', { ...payload, p_request: request });
    await showPresenceReview(host, api, project, revision);
    api.say(
      decision === 'changes_requested'
        ? 'Changes requested. The submission and public hours are unchanged.'
        : 'Decision saved for a reviewed release. Public hours have not changed yet.',
    );
  }
  form
    .querySelectorAll<HTMLButtonElement>('[data-decision]')
    .forEach(
      (b) =>
        (b.onclick = () => void api.act(() => decide(b.dataset.decision!))),
    );
  form.querySelector<HTMLButtonElement>('[data-adjust]')!.onclick = () =>
    void api.act(() => decide('approved', true));
}
