// Build-time rollback. No content revisions, user preference UI or data changes.
const value = import.meta.env.PUBLIC_CREATECH_MOTION_LEVEL ?? 'full';
if (!['off', 'minimal', 'full'].includes(value))
  throw new Error('Invalid PUBLIC_CREATECH_MOTION_LEVEL');
export const motionLevel = value as 'off' | 'minimal' | 'full';
