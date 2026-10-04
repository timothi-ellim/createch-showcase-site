import sharp from 'sharp';
import type { PublicSnapshot, PublicProject } from './content-schema.ts';

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
function lines(text: string, width: number, limit: number) {
  const words = text
    .split(/\s+/)
    .flatMap((word) => word.match(new RegExp(`.{1,${width}}`, 'gu')) ?? []);
  const output = [''];
  for (const word of words) {
    const last = output.length - 1;
    if ((output[last] + ' ' + word).trim().length <= width)
      output[last] = (output[last] + ' ' + word).trim();
    else output.push(word);
  }
  return output
    .slice(0, limit)
    .map((line, i) =>
      i === limit - 1 && output.length > limit
        ? `${line.slice(0, width - 1)}…`
        : line,
    );
}
export async function socialImage(
  event: PublicSnapshot['event'],
  project?: PublicProject,
) {
  const title = project?.title ?? event.title;
  const titleLines = lines(title, project ? 30 : 17, project ? 4 : 3);
  const maker = project
    ? lines(project.maker, 66, 2)
    : [
        'Creative technologies. Doctoral research.',
        `${event.venue.name}, ${event.venue.city}.`,
      ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#160859"/>
    <path d="M1090 0v630M0 480h1200" stroke="#7262a3" stroke-width="1"/>
    <rect x="1090" y="0" width="110" height="110" fill="#ffff66"/>
    <path d="M1118 78l50-50m-42 0h42v42" fill="none" stroke="#160859" stroke-width="8"/>
    <g font-family="Arial, sans-serif" fill="#ffffff">
      <text x="58" y="65" font-size="27" letter-spacing="2">${escape(event.series.toUpperCase())}</text>
      ${titleLines.map((line, i) => `<text x="54" y="${154 + i * (project ? 65 : 94)}" font-weight="700" font-size="${project ? 58 : 88}">${escape(line)}</text>`).join('')}
      ${maker.map((line, i) => `<text x="58" y="${407 + i * 32}" font-size="26" fill="#e4dfff">${escape(line)}</text>`).join('')}
      <text x="58" y="535" font-size="31" fill="#ffff66">${escape(event.dateLabel)} · ${escape(event.startTime)}–${escape(event.endTime)} (UK)</text>
      <text x="58" y="582" font-size="27">${escape(`${event.venue.name} · ${event.venue.streetAddress} · ${event.venue.city} · ${event.venue.postalCode}`)}</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
