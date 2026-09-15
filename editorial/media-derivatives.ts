import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mediaWidths } from '../src/lib/responsive-media.ts';
import { ContentError } from '../src/lib/content-schema.ts';

export async function writeMediaDerivatives(
  bytes: Buffer,
  digest: string,
  site: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    createHash('sha256').update(bytes).digest('hex') !== digest
  )
    throw new ContentError('MEDIA_HASH_MISMATCH');
  await mkdir(join(site, 'media'), { recursive: true });
  // Use exact descriptor widths, including for small sources; the original is
  // retained unchanged. No crop, inferred alt text or private metadata is added.
  for (const width of mediaWidths) {
    const output = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width })
      .webp({ quality: 80 })
      .toBuffer();
    await writeFile(join(site, 'media', `${digest}-${width}.webp`), output);
  }
}
