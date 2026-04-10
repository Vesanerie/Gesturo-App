// Public Instagram feed for the Community tab.
// Fetches @gesturo.art's own posts + posts where @gesturo.art is photo-tagged.
// In-memory cache (1h TTL) to spare the Instagram API quota.
// NOTE: mentioned_media requires Facebook Page token (not available yet).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const IG_USER_ID = '26298274916502895';
const TTL_MS = 60 * 60 * 1000; // 1h
const FIELDS = 'id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,caption,username';

let cache: { at: number; data: unknown[] } | null = null;

async function fetchIG(url: string): Promise<unknown[]> {
  try {
    const r = await fetch(url);
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

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

    const base = `https://graph.instagram.com/v21.0/${IG_USER_ID}`;

    // Fetch own posts + photo-tagged posts in parallel
    const [ownPosts, taggedPosts] = await Promise.all([
      fetchIG(`${base}/media?fields=${FIELDS}&limit=20&access_token=${igToken}`),
      fetchIG(`${base}/tags?fields=${FIELDS}&limit=20&access_token=${igToken}`),
    ]);

    // Merge + deduplicate by id, mark source
    const seen = new Set<string>();
    const merged: unknown[] = [];

    for (const post of ownPosts as any[]) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        merged.push({ ...post, source: 'own' });
      }
    }
    for (const post of taggedPosts as any[]) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        merged.push({ ...post, source: 'tagged' });
      }
    }

    // Sort by timestamp descending (newest first)
    merged.sort((a: any, b: any) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    cache = { at: Date.now(), data: merged };
    return new Response(JSON.stringify(merged), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  } catch (e) {
    return new Response('[]', { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
