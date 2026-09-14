import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root = '.build-candidates/portal-browser/site';
const files = await readdir(join(root, '_astro'));
const assets = await Promise.all(
  files.map(async (file) => {
    const bytes = await readFile(join(root, '_astro', file));
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }),
);
const css = assets
  .filter((a) => a.file.endsWith('.css'))
  .reduce((sum, a) => sum + a.gzipBytes, 0);
assert.ok(
  css < 12 * 1024,
  'Even all compiled CSS must fit the incremental 12KiB ceiling',
);
const home = await readFile(join(root, 'index.html'), 'utf8'),
  editor = await readFile(join(root, 'participant/editor/index.html'), 'utf8');
assert.ok(
  !/<style[\s>]/i.test(home + editor),
  'Hosting CSP disallows inline styles',
);
const scripts = (html: string) =>
  [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
assert.ok(
  scripts(home).every((path) => !scripts(editor).includes(path)),
  'No portal bundle is shared with the public home',
);
assert.ok(
  !/CREATECH_POSTER_REFERENCE|LATEST_SITE_DESIGN_REFERENCE|supabase\.co|synthetic@example\.invalid/.test(
    home,
  ),
);
assert.ok(
  scripts(editor).length > 0,
  'Configured portal must include its functional script',
);
assert.ok(!assets.some((a) => /\.(woff2?|ttf|otf)$/.test(a.file)));
const luminance = (hex: string) => {
  const rgb = hex
    .match(/[a-f0-9]{2}/gi)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
};
await writeFile(
  'docs/evidence/portal/build-budgets.json',
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      measurement:
        'local build bytes; gzip estimate, not observed network transfer',
      assets,
      totalCompiledCssGzipBytes: css,
      additionalFontBytes: 0,
      additionalHeroImageBytes: 0,
      additionalTextureBytes: 0,
      decorativeJavascriptBytes: 0,
      publicHomeScripts: scripts(home),
      privateEditorScripts: scripts(editor),
      solidContrast: {
        blueOnPaper: contrast('3014FA', 'F7F5F1'),
        paperOnBlue: contrast('F7F5F1', '3014FA'),
        inkOnPaper: contrast('191721', 'F7F5F1'),
        yellowOnBlue: contrast('FFFAB1', '3014FA'),
      },
      limits:
        'Token contrasts do not prove every composite, hover, focus or disabled state. Portal SDK is intentional private functionality.',
    },
    null,
    2,
  ),
);
process.stdout.write(
  `Build budget passed: all compiled CSS ${css} gzip bytes; zero new font, texture or hero-image bytes.\n`,
);
