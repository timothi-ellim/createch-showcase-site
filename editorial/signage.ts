import QRCode from 'qrcode';
import { zipSync, unzipSync } from 'fflate';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import type {
  PublicSnapshot,
  PublicProject,
} from '../src/lib/content-schema.ts';
import { ContentError, digest } from '../src/lib/content-schema.ts';
import { projectUrl, snapshotOrigin, qrPaths } from '../src/lib/project-url.ts';
import { escapeHtml as e } from '../src/lib/project-renderer.ts';

export async function qrAssets(url: string) {
  const options = {
    errorCorrectionLevel: 'M' as const,
    margin: 4,
    color: { dark: '#000000ff', light: '#ffffffff' },
  };
  const modules = QRCode.create(url, options).modules.size + 8;
  return {
    svg: await QRCode.toString(url, { ...options, type: 'svg' }),
    png: await QRCode.toBuffer(url, {
      ...options,
      type: 'png',
      scale: Math.ceil(1200 / modules),
    }),
  };
}
export function cardHTML(
  snapshot: PublicSnapshot,
  items: { project: PublicProject; svg: string }[],
): string {
  const synthetic = snapshot.publicationStatus === 'synthetic-local-only';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CreaTech project cards</title><style>
 @page{size:105mm 148mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111217;background:white}.card{width:105mm;height:148mm;padding:7mm 8mm;break-after:page;display:flex;flex-direction:column;gap:3mm;overflow:hidden}.card:last-child{break-after:auto}.identity{font-size:8pt;line-height:1.3;letter-spacing:.04em;border-top:2mm solid #3117fa;padding-top:3mm;font-weight:bold}.identity small{display:block;font-weight:normal;letter-spacing:0;margin-top:1mm}.work{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}.title{font-size:20pt;line-height:1.1;font-weight:700;overflow-wrap:anywhere;margin:0 0 2mm}.title.long{font-size:15pt}.maker{font-size:11pt;line-height:1.15;margin:0;overflow-wrap:anywhere}.qr{width:55mm;height:55mm;align-self:center;flex:0 0 55mm;background:white}.qr svg{display:block;width:100%;height:100%}.caption{font-size:12pt;font-weight:bold;margin:0;text-align:center}.address{font-size:8pt;line-height:1.25;overflow-wrap:anywhere;text-align:center;margin:0}.sample{font-size:9pt;font-weight:bold;text-align:center;border:1pt solid black;padding:1mm} @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
 </style></head><body>${items.map(({ project, svg }) => `<article class="card">${synthetic ? '<div class="sample">SYNTHETIC PREVIEW — NOT EXHIBITION SIGNAGE</div>' : ''}<header class="identity">${e(snapshot.event.title.toUpperCase())}<small>${e(snapshot.event.series)}</small></header><div class="work"><h1 class="title ${project.title.length > 90 ? 'long' : ''}">${e(project.title)}</h1><p class="maker">${e(project.maker)}</p></div><div class="qr" aria-label="QR for this project">${svg}</div><p class="caption">Scan to explore this work</p><p class="address">${e(projectUrl(snapshotOrigin(snapshot), project.slug).replace('https://', ''))}</p></article>`).join('')}</body></html>`;
}
export async function generateSignage(
  directory: string,
  snapshot: PublicSnapshot,
) {
  if (snapshot.schemaVersion !== 2) return;
  const qrDir = join(directory, 'generated', 'qr'),
    printDir = join(directory, 'generated', 'signage');
  await mkdir(qrDir, { recursive: true });
  await mkdir(printDir, { recursive: true });
  // Astro/candidate output is fresh. Refuse leftovers instead of distributing stale signs.
  if ((await readdir(qrDir)).length || (await readdir(printDir)).length)
    throw new ContentError('SIGNAGE_OUTPUT_NOT_EMPTY');
  const items: { project: PublicProject; svg: string }[] = [],
    zipEntries: Record<string, [Uint8Array, { mtime: Date }]> = {},
    assets: Record<string, string> = {};
  const remember = async (path: string, bytes: string | Uint8Array) => {
    await writeFile(join(directory, path), bytes);
    assets[path] = createHash('sha256').update(bytes).digest('hex');
  };
  for (const project of snapshot.projects) {
    const url = projectUrl(snapshotOrigin(snapshot), project.slug),
      qr = await qrAssets(url),
      paths = qrPaths(project.slug);
    await remember(paths.svg.slice(1), qr.svg);
    await remember(paths.png.slice(1), qr.png);
    zipEntries[`${project.slug}.svg`] = [
      Buffer.from(qr.svg),
      { mtime: new Date(1980, 0, 1) },
    ];
    zipEntries[`${project.slug}.png`] = [
      qr.png,
      { mtime: new Date(1980, 0, 1) },
    ];
    items.push({ project, svg: qr.svg });
  }
  if (items.length) {
    await remember(
      'generated/qr/project-qr-codes.zip',
      zipSync(zipEntries, { level: 0 }),
    );
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : process.platform === 'win32'
          ? {
              executablePath:
                'C:/Program Files/Google/Chrome/Application/chrome.exe',
            }
          : {}),
    });
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) => route.abort());
      const print = async (rows: typeof items, path: string) => {
        await page.setContent(cardHTML(snapshot, rows));
        await page.evaluate(() => document.fonts.ready);
        const fits = await page.locator('.card').evaluateAll((cards) =>
          cards.every((card) => {
            const work = card.querySelector('.work')!;
            const title = card.querySelector('.title')!;
            const maker = card.querySelector('.maker')!;
            return (
              card.scrollHeight <= card.clientHeight + 1 &&
              work.scrollHeight <= work.clientHeight + 1 &&
              title.getBoundingClientRect().bottom <=
                maker.getBoundingClientRect().top + 1 &&
              maker.getBoundingClientRect().bottom <=
                work.getBoundingClientRect().bottom + 1
            );
          }),
        );
        if (!fits) throw new ContentError('SIGNAGE_TEXT_OVERFLOW');
        await remember(
          path,
          await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            displayHeaderFooter: false,
            tagged: true,
          }),
        );
      };
      await print(items, 'generated/signage/project-cards.pdf');
      for (const row of items) {
        await print([row], qrPaths(row.project.slug).card.slice(1));
        await remember(
          qrPaths(row.project.slug).preview.slice(1),
          await page
            .locator('.card')
            .screenshot({ animations: 'disabled', scale: 'css' }),
        );
      }
    } finally {
      await browser.close();
    }
  }
  const index = {
    schemaVersion: 1,
    revision: snapshot.revision,
    preview: snapshot.publicationStatus !== 'approved-public',
    projects: snapshot.projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      maker: p.maker,
      url: projectUrl(snapshotOrigin(snapshot), p.slug),
      ...qrPaths(p.slug),
    })),
    assets,
  };
  await writeFile(join(printDir, 'catalogue.json'), JSON.stringify(index));
}
export async function verifySignage(
  directory: string,
  snapshot: PublicSnapshot,
  privateValues: string[] = [],
) {
  if (snapshot.schemaVersion !== 2) return;
  const index = JSON.parse(
    await readFile(join(directory, 'generated/signage/catalogue.json'), 'utf8'),
  );
  if (
    index.revision !== snapshot.revision ||
    digest(index.projects) !==
      digest(
        snapshot.projects.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          maker: p.maker,
          url: projectUrl(snapshotOrigin(snapshot), p.slug),
          ...qrPaths(p.slug),
        })),
      )
  )
    throw new ContentError('SIGNAGE_CATALOGUE_MISMATCH');
  const expected = new Set<string>(['generated/signage/catalogue.json']);
  const zipExpected = new Set<string>();
  if (snapshot.projects.length) {
    expected.add('generated/qr/project-qr-codes.zip');
    expected.add('generated/signage/project-cards.pdf');
  }
  for (const p of snapshot.projects) {
    const paths = qrPaths(p.slug);
    Object.values(paths).forEach((path) => expected.add(path.slice(1)));
    zipExpected.add(`${p.slug}.svg`);
    zipExpected.add(`${p.slug}.png`);
    const qr = await qrAssets(projectUrl(snapshotOrigin(snapshot), p.slug));
    if (
      !Buffer.from(qr.svg).equals(await readFile(join(directory, paths.svg))) ||
      !qr.png.equals(await readFile(join(directory, paths.png)))
    )
      throw new ContentError('QR_BYTES_MISMATCH');
  }
  const actual = [
    ...(await readdir(join(directory, 'generated/qr'))).map(
      (x) => 'generated/qr/' + x,
    ),
    ...(await readdir(join(directory, 'generated/signage'))).map(
      (x) => 'generated/signage/' + x,
    ),
  ];
  if (actual.length !== expected.size || actual.some((p) => !expected.has(p)))
    throw new ContentError('UNEXPECTED_SIGNAGE_ASSET');
  for (const path of actual.filter((p) => !p.endsWith('catalogue.json'))) {
    const bytes = await readFile(join(directory, path));
    if (index.assets[path] !== createHash('sha256').update(bytes).digest('hex'))
      throw new ContentError('SIGNAGE_HASH_MISMATCH');
    for (const value of privateValues.filter((v) => v.length >= 6))
      if (
        bytes.includes(Buffer.from(value)) ||
        bytes.includes(Buffer.from(value, 'utf16le'))
      )
        throw new ContentError('PRIVATE_VALUE_IN_SIGNAGE');
  }
  if (snapshot.projects.length) {
    const zip = unzipSync(
      await readFile(join(directory, 'generated/qr/project-qr-codes.zip')),
    );
    if (
      Object.keys(zip).length !== zipExpected.size ||
      Object.keys(zip).some((k) => !zipExpected.has(k))
    )
      throw new ContentError('QR_PACK_MISMATCH');
    for (const [path, bytes] of Object.entries(zip))
      if (
        !Buffer.from(bytes).equals(
          await readFile(join(directory, 'generated/qr', path)),
        )
      )
        throw new ContentError('QR_PACK_MISMATCH');
  }
}
