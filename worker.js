// Einstieg für Cloudflare Workers: /api/* an die API, alles andere an die statischen Dateien.
import { onRequest } from './functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
      return onRequest({ request, env, params: { path }, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  }
};
