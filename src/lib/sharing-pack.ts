import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import type { PublicSnapshot } from './content-schema.ts';
import { escapeHtml as e } from './project-renderer.ts';

type Event = PublicSnapshot['event'];
export const sharingFormats = [
  { id: 'preview', label: 'Link preview', width: 1200, height: 630, use: 'For links shared in messages and social posts.' },
  { id: 'square', label: 'Square post', width: 1080, height: 1080, use: 'For a square social post.' },
  { id: 'portrait', label: 'Portrait post', width: 1080, height: 1350, use: 'For a portrait social post.' },
] as const;
export type SharingFormat = typeof sharingFormats[number]['id'];
export const publicEventUrl = (event: Event) => new URL('/', event.publicSiteUrl ?? 'https://example.invalid').href;
export function eventInvitation(event: Event) {
  return `Explore art and creative technology at ${event.series}. Meet De Montfort University’s doctoral researchers at ${event.venue.name}, ${event.venue.city}, on ${event.dateLabel}, ${event.startTime}–${event.endTime} (UK time).`;
}
export function sharingCopy(event: Event) {
  const url = publicEventUrl(event);
  return {
    invitation: `${eventInvitation(event)}\n\n${url}`,
    caption: `${event.title}\n${event.series}\n\n${event.shortDescription ?? ''}\n\n${event.dateLabel} · ${event.startTime}–${event.endTime} (UK time)\n${event.venue.name}, ${event.venue.streetAddress}, ${event.venue.city}, ${event.venue.postalCode}\n\nExplore the projects and plan your visit:\n${url}`,
    listing: `${event.title} — ${event.series}\n\n${event.description ?? event.shortDescription ?? ''}\n\nWhen: ${event.dateLabel}, ${event.startTime}–${event.endTime} (UK time)\nWhere: ${event.venue.name}, ${event.venue.streetAddress}, ${event.venue.city}, ${event.venue.postalCode}\nWebsite: ${url}\nVisitor information: ${new URL('/visit/', url).href}`,
  };
}
function wrap(value: string, limit: number) {
  const rows: string[] = [];
  for (const word of value.split(/\s+/)) {
    const last = rows.length - 1;
    if (last >= 0 && rows[last].length + word.length + 1 <= limit) rows[last] += ` ${word}`;
    else rows.push(word);
  }
  return rows;
}
export function sharingSvg(event: Event, id: SharingFormat) {
  const format = sharingFormats.find(f => f.id === id)!;
  const {width:w, height:h} = format;
  const wide = id === 'preview';
  const pad = wide ? 58 : 72;
  const size = wide ? 76 : id === 'portrait' ? 126 : 100;
  const title = wrap(event.title, wide ? 18 : 14);
  const titleY = wide ? 165 : 232;
  const footer = h - (wide ? 155 : 285);
  const date = new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'long',timeZone:event.timeZone}).format(new Date(`${event.date}T12:00:00Z`));
  const url = new URL(publicEventUrl(event)).host;
  const markX = wide ? 982 : 850, markY = id === 'portrait' ? 865 : 230;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#3214f5"/>
  <g stroke="#8e79ff" fill="none" stroke-width="2" opacity=".75">
    <circle cx="${markX}" cy="${markY}" r="140"/><circle cx="${markX}" cy="${markY}" r="106"/><circle cx="${markX}" cy="${markY}" r="72"/>
    <path d="M${markX-185} ${markY}h370M${markX} ${markY-185}v370"/>
  </g>
  <path d="M${markX-48} ${markY+48}l96-96h-75m75 0v75" stroke="#ffff66" stroke-width="12" fill="none"/>
  <g font-family="Arial, sans-serif" fill="#fff">
    <text x="${pad}" y="${wide ? 58 : 82}" font-size="${wide ? 24 : 29}" letter-spacing="2">${e(event.series.toUpperCase())}</text>
    ${title.map((line,i)=>`<text x="${pad-3}" y="${titleY+i*(size+7)}" font-size="${size}" font-weight="700" letter-spacing="-3">${e(line)}</text>`).join('')}
    <text x="${pad}" y="${wide ? footer-62 : titleY+title.length*(size+7)+45}" font-size="${wide ? 28 : 32}">Art. Creative technology. Research.</text>
  </g>
  <rect x="0" y="${footer}" width="${w}" height="${h-footer}" fill="#ffff66"/>
  <g font-family="Arial, sans-serif" fill="#160859">
    <text x="${pad}" y="${footer+(wide?56:70)}" font-size="${wide?38:57}" font-weight="700">${e(date)} <tspan font-weight="400">/ ${e(event.startTime)}–${e(event.endTime)}</tspan></text>
    <text x="${pad}" y="${footer+(wide?102:130)}" font-size="${wide?29:42}">${e(event.venue.name)}, ${e(event.venue.city)}</text>
    <text x="${pad}" y="${h-(wide?20:45)}" font-size="${wide?19:27}">${e(url)}${wide?' · UK time':''}</text>
    ${!wide ? `<text x="${pad}" y="${footer+177}" font-size="26">${e(event.venue.streetAddress)} · ${e(event.venue.postalCode)} · UK time</text>` : ''}
  </g></svg>`;
}
export async function sharingImage(event: Event, id: SharingFormat) {
  return sharp(Buffer.from(sharingSvg(event,id))).png().toBuffer();
}
export async function sharingPack(snapshot: PublicSnapshot) {
  const copy = sharingCopy(snapshot.event);
  const entries: Record<string, Uint8Array> = {};
  for (const format of sharingFormats) entries[`createch-${format.id}.png`] = await sharingImage(snapshot.event,format.id);
  entries['invitation.txt'] = strToU8(copy.invitation+'\n');
  entries['social-caption.txt'] = strToU8(copy.caption+'\n');
  entries['event-listing.txt'] = strToU8(copy.listing+'\n');
  const csv = (value:string) => `"${value.replaceAll('"','""')}"`;
  entries['project-links.csv'] = strToU8('Participant,Project,Link\r\n'+snapshot.projects.map(p=>[p.maker,p.title,new URL(`/projects/${p.slug}/`,publicEventUrl(snapshot.event)).href].map(csv).join(',')).join('\r\n')+'\r\n');
  entries['READ-ME.txt'] = strToU8(`${snapshot.event.series} — sharing pack\n\nChoose a graphic, copy a caption and include the website link in your post.\nLinks in this pack point to the public showcase.\nCheck the Visit page for current visitor information.\nThe project list preserves the published participant names and titles.\nThese graphics contain event information only; participant artwork is not included.\n${snapshot.event.designCredit ?? ''}\nGraphics in this pack are new website layouts based on the event colours.\n`);
  return zipSync(entries, { level: 6 });
}
