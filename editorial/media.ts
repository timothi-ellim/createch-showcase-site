import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  ContentError,
  mediaSchema,
  validate,
} from '../src/lib/content-schema.ts';
import { readJson, atomicJson } from './store.ts';
type MediaApproval = {
  src: string;
  alt: string;
  credit: string;
  approvedBy: string;
  approvedAt: string;
  sha256: string;
};
export async function processImage(source: Buffer) {
  if (source.length < 12 || source.length > 5_000_000)
    throw new ContentError('INVALID_MEDIA_SIZE');
  try {
    const decoder = sharp(source, {
      limitInputPixels: 24_000_000,
      failOn: 'warning',
    });
    const info = await decoder.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(info.format) ||
      (info.pages ?? 1) !== 1
    )
      throw new Error();
    const bytes = await decoder
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourceHash: createHash('sha256').update(source).digest('hex'),
    };
  } catch {
    throw new ContentError('IMAGE_DECODE_FAILED');
  }
}
export async function mediaRegistry(root: string): Promise<MediaApproval[]> {
  try {
    return (await readJson(
      join(root, 'media-approvals.json'),
    )) as MediaApproval[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export async function approveMedia(
  root: string,
  source: string,
  alt: string,
  credit: string,
  approvedBy: string,
) {
  if (!approvedBy.trim()) throw new ContentError('MEDIA_APPROVER_REQUIRED');
  let bytes = await readFile(source);
  if (bytes.length > 10_000_000 || bytes.length < 12)
    throw new ContentError('INVALID_MEDIA_SIZE');
  let extension: string;
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    extension = 'png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    extension = 'jpg';
  else if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    extension = 'webp';
  else
    throw new ContentError('UNSUPPORTED_MEDIA', [
      'approved PNG, JPEG or WebP only',
    ]);
  try {
    // Decode before approval, bound pixel count, orient, resize, and discard EXIF
    // and other metadata. Public assets never carry source GPS/camera metadata.
    bytes = (await processImage(bytes)).bytes;
    extension = 'webp';
  } catch {
    throw new ContentError('IMAGE_DECODE_FAILED');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const media = validate(mediaSchema, {
    src: `/media/${sha256}.${extension}`,
    alt,
    credit,
  });
  const registry = await mediaRegistry(root);
  const entry = {
    ...media,
    sha256,
    approvedBy,
    approvedAt: new Date().toISOString(),
  };
  await mkdir(join(root, 'approved-media'), { recursive: true });
  await writeFile(
    join(root, 'approved-media', `${sha256}.${extension}`),
    bytes,
    { flag: 'wx', mode: 0o600 },
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await atomicJson(join(root, 'media-approvals.json'), [
    ...registry.filter((item) => item.src !== media.src),
    entry,
  ]);
  return media;
}
