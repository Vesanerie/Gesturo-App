// Public Instagram posts feed for the Community tab.
// No auth: photos from @gesturo.art are public anyway.
// In-memory cache (1h TTL) to spare the Instagram API quota.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const IG_USER_ID = '17841435268041471';
const TTL_MS = 60 * 60 * 1000; // 1h

let cache: { at: number; data: unknown[] } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    const igToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN');
    if (!igToken) return new Response('[]', { headers: { ...CORS, 'Content-Type': 'application/json' } });
    const r = await fetch(`https://graph.instagram.com/v21.0/${IG_USER_ID}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count&limit=20&access_token=${igToken}`);
    const j = await r.json();
    const data = Array.isArray(j.data) ? j.data : [];
    cache = { at: Date.now(), data };
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  } catch (e) {
    return new Response('[]', { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
