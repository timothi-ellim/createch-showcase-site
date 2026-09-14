import type { PublicProject } from './content-schema.ts';

// The static page and authenticated preview use this same escaped renderer.
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
function publicLink(value: string): string {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password
      ? escapeHtml(u.href)
      : '#';
  } catch {
    return '#';
  }
}
export function renderProjectBody(
  project: PublicProject,
  options: {
    synthetic?: boolean;
    privatePreview?: boolean;
    related?: PublicProject[];
    mediaUrls?: ReadonlyMap<string, string>;
  } = {},
): string {
  const e = escapeHtml;
  const section = (title: string, body: string) =>
    `<section><h2>${e(title)}</h2>${body}</section>`;
  const prose = (text: string) => `<p class="preserve-lines">${e(text)}</p>`;
  const media = (item: NonNullable<PublicProject['media']>, main = false) => {
    const override = options.mediaUrls?.get(item.src);
    const src = override?.startsWith('blob:')
      ? override
      : /^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(item.src) &&
          !options.privatePreview
        ? item.src
        : '';
    return `<figure class="project-figure"><div class="project-media ${e(project.theme)}">${src ? `<img src="${e(src)}" alt="${e(item.alt)}" width="960" height="640" loading="${main ? 'eager' : 'lazy'}" />` : '<p>Image unavailable in this preview.</p>'}</div><figcaption>${e(item.credit)}</figcaption></figure>`;
  };
  const mainImage = project.media
    ? media(project.media, true)
    : `<figure class="project-figure"><div class="project-media ${e(project.theme)}"><span class="placeholder-symbol" aria-hidden="true">◉</span><span class="placeholder-caption">Image pending approval</span></div></figure>`;
  const facts = [
    [
      'Encounter',
      project.encounters.join(' · ') + (options.synthetic ? ' (example)' : ''),
    ],
    ['Location', project.room ?? 'Not confirmed'],
    [
      'Duration & timing',
      (project.duration ?? 'Not confirmed') +
        (project.schedule ? ` · ${project.schedule}` : ''),
    ],
    [
      'Access & sensory information',
      project.accessNotes ??
        'Not yet supplied. Please check visit information before travelling.',
    ],
  ];
  return `<div class="detail-grid" data-project-body><div>${mainImage}
    ${options.synthetic ? '<p class="fixture-label">Synthetic fixture · Not an announced work</p>' : ''}
    <p class="theme-label ${e(project.theme)}">Code becomes ${e(project.theme)}</p>
    <h1>${e(project.title)}</h1><p class="maker">${e(project.maker)}</p><p class="lead">${e(project.invitation)}</p>
    ${section('What you’ll do', prose(project.visitorAction))}
    ${section(options.synthetic ? 'About this sample' : 'About the project', prose(project.description))}
    ${project.processNote ? section('Behind the work', prose(project.processNote)) : ''}
    ${project.processMedia.length ? section('Process gallery', `<div class="process-gallery">${project.processMedia.map((item) => media(item)).join('')}</div>`) : ''}
    ${project.videoUrl ? section('Watch more', `<a class="text-link" href="${publicLink(project.videoUrl)}" rel="noopener noreferrer">Watch the project video ↗</a><p class="small">Opens the contributor’s chosen video website. Playback starts there.</p>`) : ''}
    ${project.links.length ? section('From the contributor', `<ul class="artist-links">${project.links.map((link) => `<li><a href="${publicLink(link.url)}" rel="noopener noreferrer">${e(link.label)} ↗</a></li>`).join('')}</ul>`) : ''}
    ${options.related?.length ? section('Keep exploring', `<p>Related works selected for this project.</p><ul class="artist-links">${options.related.map((item) => `<li><a href="/projects/${e(item.slug)}/">${e(item.title)} ↗</a></li>`).join('')}</ul>`) : ''}
    </div><aside class="reading-panel"><p class="eyebrow">Plan an encounter</p><h2>At a glance</h2>
    <dl class="detail-facts">${facts.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>
    ${
      !options.privatePreview
        ? `<button hidden class="button lime" data-save="${e(project.id)}" data-title="${e(project.title)}" aria-pressed="false" aria-label="Save ${e(project.title)} to my visit">Save to my visit</button>
    <button hidden class="button secondary" data-copy-link>Copy project link</button><p class="small">Your shortlist stays in this browser. Saving is not a booking.</p>
    <div data-copy-fallback hidden><label for="project-url">Copy this project address</label><input id="project-url" type="url" readonly /><p class="small">Select the address and use your browser’s copy command.</p></div>
    <noscript><p>To share, copy the address from your browser. Enable JavaScript to save a shortlist.</p></noscript>`
        : '<p class="notice">Private preview. This version is not live.</p>'
    }
    <a class="text-link" href="/visit/">Visit information ↗</a></aside></div>`;
}
