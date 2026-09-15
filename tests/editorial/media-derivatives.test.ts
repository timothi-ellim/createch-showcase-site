import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { writeMediaDerivatives } from '../../editorial/media-derivatives.ts';
import {
  responsiveMedia,
  mediaWidths,
} from '../../src/lib/responsive-media.ts';

test('responsive derivatives require exact approved bytes and preserve aspect ratio with accurate descriptors', async () => {
  const bytes = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: '#3117fa' },
  })
    .webp()
    .toBuffer();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'createch-media-'));
  await assert.rejects(
    writeMediaDerivatives(bytes, '0'.repeat(64), dir),
    /MEDIA_HASH_MISMATCH/,
  );
  await writeMediaDerivatives(bytes, digest, dir);
  for (const width of mediaWidths) {
    const output = await readFile(
      join(dir, 'media', `${digest}-${width}.webp`),
    );
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, width);
    assert.equal(meta.height, width / 2);
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined);
    assert(
      responsiveMedia(`/media/${digest}.webp`).includes(
        `${digest}-${width}.webp ${width}w`,
      ),
    );
  }
  assert.equal(responsiveMedia('https://private.invalid/image'), '');
});
