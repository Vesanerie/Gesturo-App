// List R2 photos under Sessions/current/. Mirrors main.js listR2Photos.
import { listAll, extOf, IMAGE_EXTS, NUDITY_CATEGORIES, CORS_HEADERS, requireUser, resolveIsPro } from '../_shared/r2.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

// Auth-gated: caller must present a valid Supabase JWT, and Pro status is
// resolved server-side (the client cannot grant itself Pro by setting a flag).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const email = await requireUser(req);
    checkRateLimit(`photos:${email}`, { limit: 60, windowMs: 60_000 });
    const isPro = await resolveIsPro(email);
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
    const objects = await listAll('Sessions/current/');
    const results: any[] = [];
    for (const { Key } of objects) {
      const parts = Key.split('/');
      if (parts.length < 4) continue;
      const fileName = parts[parts.length - 1];
      if (fileName.startsWith('.')) continue;
      if (!IMAGE_EXTS.includes(extOf(fileName))) continue;
      const category = parts[2];
      const subcategory = parts.length > 4 ? parts[3] : null;
      if (NUDITY_CATEGORIES.includes(category) && !isPro) continue;
      results.push({
        path: `${publicUrl}/${Key}`,
        category,
        subcategory,
        sequence: null,
        animCategory: null,
        isR2: true,
      });
    }
    return new Response(JSON.stringify(results), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
