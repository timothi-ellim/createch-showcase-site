// Candidate Pages advanced-mode worker. Package as _worker.js on the OLD host
// only after approving the matching Access exceptions; all other paths delegate.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.origin === 'https://createch-showcase-staging.pages.dev' &&
      /^\/participant(?:\/|$)/.test(url.pathname)
    ) {
      if (
        env.PARTICIPANT_REDIRECT_ORIGIN !==
        'https://createch-workspace.pages.dev'
      )
        return new Response('Workspace transition is not configured.', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      return new Response(null, {
        status: 302,
        headers: {
          Location: env.PARTICIPANT_REDIRECT_ORIGIN + '/participant/login/#',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
