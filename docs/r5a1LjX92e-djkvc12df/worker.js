// A minimal CORS proxy for JSON/GeoJSON feeds.
// Deploy at: https://dash.cloudflare.com → Workers & Pages → Create Worker
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) return new Response('Missing ?u=', { status: 400 });

    // Only allow http/https and block file:// etc.
    if (!/^https?:\/\//i.test(target)) return new Response('Bad URL', { status: 400 });

    try {
      const upstream = await fetch(target, { cf: { cacheTtl: 30, cacheEverything: false } });
      const body = await upstream.arrayBuffer();

      // Pass through content type; force CORS open
      const hdrs = new Headers(upstream.headers);
      hdrs.set('Access-Control-Allow-Origin', '*');
      hdrs.set('Access-Control-Allow-Headers', '*');
      hdrs.set('Access-Control-Expose-Headers', '*');

      return new Response(body, { status: upstream.status, headers: hdrs });
    } catch (e) {
      return new Response('Upstream error: ' + (e?.message || 'fetch failed'), { status: 502 });
    }
  }
};
