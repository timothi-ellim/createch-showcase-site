import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pack from '../src/data/artist-sheets.json' with { type: 'json' };

// Check the exact reviewed PDF bytes after Astro copies public assets and again
// before publication. PDFs are not silently recreated during a content release.
export async function verifyArtistSheetFiles(directory: string): Promise<void> {
  const files = [...pack.sheets, pack.combined];
  if (new Set(files.map(file => file.path)).size !== files.length)
    throw new Error('Duplicate information sheet asset');
  for (const file of files) {
    if (!/^\/guides\/artist-sheets\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9-]+\.pdf$/.test(file.path))
      throw new Error('Invalid information sheet path');
    const bytes = await readFile(join(directory, file.path.slice(1)));
    if (bytes.length !== file.bytes || bytes.subarray(0, 5).toString() !== '%PDF-' ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error(`Information sheet does not match reviewed print edition: ${file.path}`);
  }
}
