import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const receiptSchema = z
  .object({
    snapshotRevision: z.string().regex(/^[a-f0-9]{64}$/),
    origin: z.url(),
    authorised: z.literal(true),
    approvedBy: z.string().trim().min(1).max(200),
    approvedAt: z.iso.datetime({ offset: true }),
    provider: z.literal('gmail'),
    privacyReviewed: z.literal(true),
    deliveryVerified: z.literal(true),
  })
  .strict();

export function readReminderLaunchReceipt(
  input: unknown,
  expected: { revision: string; origin: string },
) {
  const result = receiptSchema.safeParse(input);
  if (
    !result.success ||
    result.data.snapshotRevision !== expected.revision ||
    result.data.origin !== expected.origin
  )
    throw new Error('REMINDER_LAUNCH_RECEIPT_MISMATCH');
  return result.data;
}

/** Materialise an existing approval outside the served site; never create approval. */
export async function prepareReminderLaunch(
  directory: string,
  expected: { revision: string; origin: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.PUBLIC_REMINDERS_ENABLED !== 'true') return undefined;
  const fromFile = env.CREATECH_REMINDERS_LAUNCH_RECEIPT;
  const fromJSON = env.CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON;
  if (!fromFile && !fromJSON)
    throw new Error('REMINDER_LAUNCH_RECEIPT_REQUIRED');
  if (fromFile && fromJSON)
    throw new Error('REMINDER_LAUNCH_RECEIPT_AMBIGUOUS');
  let input: unknown;
  try {
    input = JSON.parse(fromFile ? await readFile(fromFile, 'utf8') : fromJSON!);
  } catch {
    throw new Error('REMINDER_LAUNCH_RECEIPT_INVALID');
  }
  const receipt = readReminderLaunchReceipt(input, expected);
  const path = join(directory, 'reminder-launch.private.json');
  await writeFile(path, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  return path;
}
