import { escapeHtml as e } from '../lib/project-renderer';
import { projectUrl, publicOrigin, qrPaths } from '../lib/project-url';
import { projectNav, type WorkspaceAPI } from './portal-presence';
interface Signage {
  status: string;
  release?: number;
  origin?: string;
  slug?: string;
  title?: string;
  maker?: string;
}
async function confirmed<T>(
  host: HTMLElement,
  api: WorkspaceAPI,
  load: () => Promise<T>,
  retry: () => Promise<void>,
): Promise<T | null> {
  try {
    return await load();
  } catch {
    host.innerHTML =
      '<section class="reading-panel"><h2>Unable to confirm current signage</h2><p>Availability could not be checked. Your published profile has not been changed.</p><button class="button secondary" data-retry-signage>Try again</button></section>';
    host.querySelector<HTMLButtonElement>('[data-retry-signage]')!.onclick =
      () => void api.act(retry);
    api.say(
      'Unable to confirm current signage. Check your connection, then try again.',
      true,
    );
    return null;
  }
}
const unavailable = (status: string) =>
  ({
    unpublished:
      'Your QR code will be available once your project profile is published.',
    awaiting_assets:
      'Your profile is live. QR files will become available after the next QR-enabled website release.',
    withdrawal_requested:
      'Withdrawal requested. New signage downloads are unavailable; public removal still requires a verified release.',
    withdrawal_pending:
      'A withdrawal is awaiting publication. Prepare and verify the removal release before printing a new complete pack.',
  })[status] ?? 'Unable to confirm current signage. Try again.';
function publishedCard(row: Signage) {
  if (row.status !== 'available')
    return `<p class="notice">${e(unavailable(row.status))}</p>`;
  const origin = publicOrigin(row.origin!),
    url = projectUrl(origin, row.slug!),
    paths = qrPaths(row.slug!);
  return `<article class="signage-project"><h2>${e(row.title)}</h2><p>${e(row.maker)}</p><p class="small">Verified release ${row.release}. These labels are from the published profile.</p><a class="text-link" href="${e(url)}" target="_blank" rel="noopener noreferrer">Open public profile ↗</a><details><summary>Preview A6 card and QR</summary><p>This preview uses the published print layout. Download the PDF for printing at actual size.</p><img class="signage-card-preview" src="${e(origin + paths.preview)}" width="397" height="560" alt="A6 card for ${e(row.title)} by ${e(row.maker)}, with a QR linking to the public profile above." loading="lazy"/><a class="text-link" href="${e(origin + paths.svg)}">Open QR image ↗</a></details><div class="portal-actions"><a class="button dark" href="${e(origin + paths.png)}" download>Download PNG</a><a class="button secondary" href="${e(origin + paths.svg)}" download>Download SVG</a><a class="button secondary" href="${e(origin + paths.card)}" download>Download A6 card</a></div></article>`;
}
export async function showProjectSignage(
  host: HTMLElement,
  api: WorkspaceAPI,
  project: string,
) {
  const row = await confirmed(
    host,
    api,
    () => api.rpc<Signage>('get_project_signage', { p_project: project }),
    () => showProjectSignage(host, api, project),
  );
  if (!row) return;
  host.innerHTML = `${projectNav(project, 'qr')}<section class="reading-panel"><p class="eyebrow">Your project QR code</p><p>Visitors can scan this code to open your public profile. Changing your hours does not change the QR destination.</p>${publishedCard(row)}<p class="small">Print cards at actual size (100%) on A6 paper. If a download opens in your browser, use its Save or Download command.</p><button class="text-button" data-refresh-signage>Refresh availability</button></section>`;
  host.querySelector<HTMLButtonElement>('[data-refresh-signage]')!.onclick =
    () => void api.act(() => showProjectSignage(host, api, project));
}
export async function showSignageCatalogue(
  host: HTMLElement,
  api: WorkspaceAPI,
) {
  const result = await confirmed(
    host,
    api,
    () => api.rpc<Signage & { projects: Signage[] }>('get_signage_catalogue'),
    () => showSignageCatalogue(host, api),
  );
  if (!result) return;
  const origin = result.origin ? publicOrigin(result.origin) : '';
  host.innerHTML = `<section class="reading-panel"><h2>Print the published showcase</h2><p>Use the verified catalogue to prepare exhibition signage. Artist hours stay on the website, so changed attendance does not require reprinting cards.</p>${result.status === 'available' ? `<p><strong>Verified release ${result.release} · ${result.projects.length} ${result.projects.length === 1 ? 'project' : 'projects'}</strong></p>${result.projects.length ? `<div class="portal-actions"><a class="button dark" href="${e(origin)}/generated/signage/project-cards.pdf" download>Download all A6 project cards</a><a class="button secondary" href="${e(origin)}/generated/qr/project-qr-codes.zip" download>Download all QR images</a></div>` : '<p>No published projects to print.</p>'}` : `<p class="notice">${e(unavailable(result.status))}</p>`}<p>One A6 card per PDF page (105 × 148 mm). Print at actual size / 100%, then check the 55 mm QR before printing the full batch. Test a representative card with iPhone and Android cameras.</p><button class="text-button" data-refresh-signage>Refresh catalogue</button></section><section class="reading-panel"><h2>Individual projects</h2>${result.projects.map(publishedCard).join('') || '<p>No published project assets yet.</p>'}</section>`;
  host.querySelector<HTMLButtonElement>('[data-refresh-signage]')!.onclick =
    () => void api.act(() => showSignageCatalogue(host, api));
}
