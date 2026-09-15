/** Temporary exact-origin compatibility; expired aliases fail closed. */
export function appOrigins(
  primary: string,
  compatibility = '',
  until = '',
  now = Date.now(),
) {
  const valid = (value: string) => {
    const u = new URL(value);
    if (
      u.origin !== value ||
      (u.protocol !== 'https:' &&
        !(
          u.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(u.hostname)
        ))
    )
      throw Error('INVALID_APP_ORIGIN');
    return value;
  };
  const origins = [valid(primary)];
  if (compatibility) {
    const expiry = Date.parse(until);
    if (!Number.isFinite(expiry)) throw Error('COMPATIBILITY_EXPIRY_REQUIRED');
    const extra = compatibility.split(',').map((x) => valid(x.trim()));
    if (expiry > now) origins.push(...extra);
  }
  return [...new Set(origins)];
}
