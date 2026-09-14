// Cloudflare Pages headers are generated for the exact configured API origin.
// Public routes never need Supabase access. These headers require live verification.
export const prerender = true;
export function GET() {
  const endpoint = import.meta.env.PUBLIC_SUPABASE_URL;
  let api = '';
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash)
      throw new Error('Invalid API endpoint');
    api = url.origin;
  }
  const base =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  const privatePolicy = base
    .replace("img-src 'self'", "img-src 'self' blob: data:")
    .replace("connect-src 'self'", `connect-src 'self'${api ? ' ' + api : ''}`);
  return new Response(
    `/*\n  Content-Security-Policy: ${base}\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: public, max-age=0, must-revalidate\n\n/_astro/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n\n/media/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n\n/participant/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${privatePolicy}\n  ! Cache-Control\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n\n/organiser/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${privatePolicy}\n  ! Cache-Control\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
