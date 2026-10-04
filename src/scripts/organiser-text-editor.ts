import { escapeHtml as e } from '../lib/project-renderer';
import type { PortalDraft, ProjectSummary } from '../lib/portal-contract';

export function addOrganiserTextEditor(
  panel: HTMLElement,
  projects: ProjectSummary[],
  load: (id: string) => Promise<PortalDraft>,
  submit: (draft: PortalDraft, request: string) => void,
) {
  const details = document.createElement('details');
  details.innerHTML = `<summary>Publish a text-only page with organiser approval</summary>
    <p>Review the saved public-profile text below. This creates a separate, exact version under your authority as owner. It does not declare participant permission or change the participant’s private draft. Images, videos, external links and private access proposals are excluded.</p>
    <label for="organiser-text-project">Text-only project</label>
    <select id="organiser-text-project"><option value="">Choose a project</option>${projects
      .filter((p) => !p.withdrawn)
      .map((p) => `<option value="${e(p.id)}">${e(p.title)}</option>`)
      .join('')}</select>
    <div data-organiser-text-preview></div>`;
  panel.append(details);
  const selection = details.querySelector<HTMLSelectElement>('select')!;
  const preview = details.querySelector<HTMLElement>(
    '[data-organiser-text-preview]',
  )!;
  let generation = 0;
  selection.onchange = async () => {
    const current = ++generation;
    preview.replaceChildren();
    if (!selection.value) return;
    preview.textContent = 'Loading saved text…';
    try {
      const draft = await load(selection.value);
      if (current !== generation) return;
      const fields = draft.fields;
      if (fields.permission) {
        preview.textContent =
          'Participant permission has been supplied. Use the normal participant submission and review workflow.';
        return;
      }
      const labels = {
        title: 'Project title',
        maker: 'Public name',
        invitation: 'Invitation',
        description: 'Project description',
        visitorAction: 'What visitors do',
        processNote: 'Behind the work',
      } as const;
      preview.innerHTML = `<p><strong>Participant permission has not been submitted.</strong> Draft version ${draft.version}. Missing optional sections will be omitted.</p>
        ${Object.entries(labels)
          .map(
            ([key, label]) =>
              `<h3>${label}</h3><p class="preserve-lines">${e(fields[key as keyof typeof labels] || 'Not supplied')}</p>`,
          )
          .join('')}
        <h3>Encounter labels</h3><p>${e(fields.encounters?.join(' · ') || 'Not confirmed')}</p>
        <form><label><input type="checkbox" required />I authorise publication of this exact text as organiser</label>
        <button class="button dark">Prepare text-only version for review</button></form>`;
      const request = crypto.randomUUID();
      preview.querySelector<HTMLFormElement>('form')!.onsubmit = (event) => {
        event.preventDefault();
        submit(draft, request);
      };
    } catch {
      if (current === generation)
        preview.textContent =
          'The saved text could not be loaded. Choose the project again to retry.';
    }
  };
}
