import type { ParticipantFields } from './portal-contract';

export interface FieldIssue {
  name: string;
  message: string;
}
const textLimits = {
  title: 120,
  maker: 100,
  invitation: 200,
  description: 2000,
  visitorAction: 700,
  alt: 300,
  credit: 200,
  processNote: 800,
  accessProposal: 700,
} as const;

// Kept in parity with the public-only schema by participant-validation.test.ts.
export function publicTextIssue(value: string): string | null {
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    return 'Use plain text without < or > symbols, HTML, or control characters.';
  if (
    /edit2[=]|editresponse|usp=pp_url|Bearer\s|AIza[A-Za-z0-9_-]{20}/i.test(value)
  )
    return 'Remove private editing links or access credentials from this public field.';
  return null;
}
export function publicUrlIssue(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      value.length > 2000 ||
      url.protocol !== 'https:' ||
      /[<>"'\s]/.test(value)
    )
      return 'Use a complete public link starting with https://, up to 2000 characters, without spaces or quotation marks.';
    if (
      url.username ||
      url.password ||
      /[?&](?:token|key|edit2|secret|auth|access_token)=/i.test(value)
    )
      return 'Use a public link without passwords, private editing access, or sign-in tokens.';
    if (
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(
        url.hostname,
      )
    )
      return 'Use a public website address that visitors can open, rather than a local computer address.';
    if (/(?:^|\.)(?:docs|drive)\.google\.com$/.test(url.hostname))
      return 'Google Drive and Google Docs links are not accepted here. Upload your image in Image, or use a public website or video-hosting link.';
    return null;
  } catch {
    return 'Enter a complete public link starting with https://, or leave this optional field empty.';
  }
}
export function participantFieldIssues(
  f: ParticipantFields,
  complete = true,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const required = new Set([
    'title',
    'maker',
    'invitation',
    'description',
    'visitorAction',
  ]);
  if (f.assetId) {
    required.add('alt');
    required.add('credit');
  }
  for (const [name, limit] of Object.entries(textLimits)) {
    const value = String(f[name as keyof ParticipantFields] || '');
    const message =
      value.length > limit
        ? `Shorten this field to ${limit} characters or fewer.`
        : publicTextIssue(value) ||
          (complete && required.has(name) && !value.trim()
            ? 'Complete this field before submitting.'
            : null);
    if (message) issues.push({ name, message });
  }
  if (!complete) return issues; // Incomplete drafts can still be saved.
  for (const [i, link] of (f.links || []).entries()) {
    if (!link.label.trim() && !link.url.trim()) continue;
    if (!link.label.trim())
      issues.push({
        name: `link-label-${i}`,
        message: 'Add a short label for this link, or clear both link fields.',
      });
    else {
      const message =
        link.label.length > 100
          ? 'Shorten the link label to 100 characters or fewer.'
          : publicTextIssue(link.label);
      if (message) issues.push({ name: `link-label-${i}`, message });
    }
    const message = !link.url.trim()
      ? 'Add the HTTPS address for this link, or clear both link fields.'
      : publicUrlIssue(link.url);
    if (message) issues.push({ name: `link-url-${i}`, message });
  }
  if (f.videoUrl) {
    const message = publicUrlIssue(f.videoUrl);
    if (message) issues.push({ name: 'videoUrl', message });
  }
  if (!f.encounters?.length)
    issues.push({
      name: 'encounters',
      message:
        'Choose at least one visitor experience option before submitting.',
    });
  if (!f.permission)
    issues.push({
      name: 'permission',
      message: 'Confirm the permission declaration before submitting.',
    });
  return issues;
}

export function validationFailure(code: string | null): {
  message: string;
  editRequired: boolean;
} {
  const image =
    'Choose Continue editing, upload a replacement in Image (a still PNG, JPEG or WebP under 5 MB and 24 megapixels), add alternative text and credit, then save and submit a new version.';
  const messages: Record<string, string> = {
    IMAGE_DECODE_FAILED: `The image could not be read, is animated, or exceeds the image limits. ${image}`,
    INVALID_MEDIA_SIZE: `The image file is empty or exceeds 5 MB. ${image}`,
    MEDIA_SIZE_MISMATCH: `The uploaded image is incomplete or does not match its recorded size. ${image}`,
    ASSET_BINDING_INVALID:
      'The selected image or its description/credit needs attention. Choose Continue editing, select the image again, complete both image text fields, then save and submit a new version.',
    VALIDATION_FAILED:
      'This version did not pass the content checks. Choose Continue editing and Submit for review to find any highlighted text or link fields. Correct them, save and submit a new version. If no field is highlighted, contact the organiser to check this version.',
  };
  if (code && messages[code])
    return { message: messages[code], editRequired: true };
  return {
    message:
      code === 'PRIVATE_MEDIA_UNAVAILABLE'
        ? 'Checks could not read the uploaded image. Choose Retry checks. If this continues, upload the image again in Continue editing, save and submit a new version, or contact the organiser.'
        : 'Checks could not finish. Your submission is saved. Choose Retry checks; if it still fails, contact the organiser and include the revision shown below.',
    editRequired: false,
  };
}
