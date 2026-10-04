import { escapeHtml as e } from '../lib/project-renderer';

interface PublicEventConfig {
  description?: string;
  shortDescription?: string;
  textOnlyProjectIds?: string[];
  participants?: { projectId: string; name: string }[];
  [key: string]: unknown;
}

export function addEventCopyEditor(
  panel: HTMLElement,
  current: PublicEventConfig,
  save: (config: PublicEventConfig) => void,
) {
  const details = document.createElement('details');
  const participants = current.participants ?? [];
  details.innerHTML = `<summary>Event description and public participant list</summary>
    <form data-event-copy-form>
      <label for="event-description">Main event description</label>
      <textarea id="event-description" maxlength="6000" rows="12">${e(current.description ?? '')}</textarea>
      <label for="event-summary">Short event summary for sharing</label>
      <textarea id="event-summary" maxlength="350" rows="3">${e(current.shortDescription ?? '')}</textarea>
      <fieldset><legend>People shown on the public participant list</legend>
        <p>Unchecking a name removes it from the public list in the next reviewed release. Use the project’s withdrawal control to exclude its page from future releases as well.</p>
        ${participants.map((person) => `<label><input type="checkbox" data-roster-person value="${e(person.projectId)}" checked />${e(person.name)}</label>`).join('')}
      </fieldset>
      <fieldset><legend>Approved exceptions for pages without an image</legend>
        <p>Only select a project after deliberately reviewing and approving publication without a supplied image. Its text still requires exact-version approval.</p>
        ${participants.map((person) => `<label><input type="checkbox" data-text-only-project value="${e(person.projectId)}" ${current.textOnlyProjectIds?.includes(person.projectId) ? 'checked' : ''} />Allow a text-only page for ${e(person.name)}</label>`).join('')}
      </fieldset>
      <button class="button dark">Save description and participant list for review</button>
      <p class="small">Saving creates a new event version. The public website changes only after a release is approved and verified.</p>
    </form>`;
  panel.append(details);
  const form = details.querySelector<HTMLFormElement>('form')!;
  form.onsubmit = (event) => {
    event.preventDefault();
    const config = { ...current };
    for (const [field, selector] of [
      ['description', '#event-description'],
      ['shortDescription', '#event-summary'],
    ] as const) {
      const input = details.querySelector<HTMLTextAreaElement>(selector)!;
      const value = input.value.trim();
      if (
        /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|edit2[=]|editresponse|usp=pp_url|Bearer\s/i.test(
          value,
        )
      ) {
        input.setCustomValidity(
          'Use public plain text only, without markup or private editing links.',
        );
        input.reportValidity();
        input.oninput = () => input.setCustomValidity('');
        return;
      }
      if (value) config[field] = value;
      else delete config[field];
    }
    const selected = new Set(
      [
        ...details.querySelectorAll<HTMLInputElement>(
          '[data-roster-person]:checked',
        ),
      ].map((input) => input.value),
    );
    config.participants = participants.filter((person) =>
      selected.has(person.projectId),
    );
    const textOnly = [
      ...details.querySelectorAll<HTMLInputElement>(
        '[data-text-only-project]:checked',
      ),
    ].map((input) => input.value);
    if (textOnly.length) config.textOnlyProjectIds = textOnly;
    else delete config.textOnlyProjectIds;
    save(config);
  };
}
