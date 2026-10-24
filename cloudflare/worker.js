// R5 StreamerHub: opslag voor de vaste overlay-link (Cloudflare Worker + KV-namespace "R5S").
// GET  /o/<login>  -> de overlay-instellingen van die streamer (openbaar, voor OBS)
// PUT  /o/<login>  -> opslaan; alleen met een geldige Twitch-token van diezelfde streamer
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const m = /^\/o\/([a-z0-9_]{2,25})$/.exec(new URL(req.url).pathname.toLowerCase());
    if (!m) return json({ error: 'not found' }, 404);
    const login = m[1];
    if (req.method === 'GET') {
      const v = await env.R5S.get('o:' + login);
      return v ? new Response(v, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } }) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'PUT') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'login nodig' }, 401);
      const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + token } });
      const who = v.ok ? await v.json() : null;
      if (!who || who.login !== login) return json({ error: 'alleen de streamer zelf mag dit opslaan' }, 403);
      const body = await req.text();
      if (body.length > 32768) return json({ error: 'te groot' }, 413);
      try { JSON.parse(body); } catch { return json({ error: 'geen geldige JSON' }, 400); }
      await env.R5S.put('o:' + login, body);
      return json({ ok: true });
    }
    return json({ error: 'methode niet toegestaan' }, 405);
  },
};
