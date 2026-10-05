export const SHORTLIST_STORAGE_KEY = 'createch-shortlist-v1';

// Shared by the existing save controls and the atlas. Only stable project IDs
// belong in device storage; a denied/corrupt read must never imply a saved visit.
export function readShortlist(storage?: Pick<Storage, 'getItem'>) {
  try {
    const raw = (storage ?? window.localStorage).getItem(SHORTLIST_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id) => typeof id === 'string') ||
      parsed.length > 1000
    )
      throw new SyntaxError('Invalid shortlist');
    return { saved: new Set<string>(parsed), available: true, notice: '' };
  } catch (error) {
    return {
      saved: new Set<string>(),
      available: error instanceof SyntaxError,
      notice:
        error instanceof SyntaxError
          ? 'Your saved list could not be read. No projects are shown as saved. Save a project or clear the list to start again.'
          : 'Browser storage is unavailable. Your shortlist cannot be loaded or saved. You can still browse every project.',
    };
  }
}
