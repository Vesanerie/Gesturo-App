// List R2 animations under Animations/current/{free,pro}/. Mirrors main.js listR2Animations.
import { listAll, extOf, IMAGE_EXTS, CORS_HEADERS, requireUser, resolveIsPro } from '../_shared/r2.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

// Auth-gated: caller must present a valid Supabase JWT, and Pro status is
// resolved server-side. Free users only see free/, Pro users see free/ + pro/.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const email = await requireUser(req);
    checkRateLimit(`animations:${email}`, { limit: 60, windowMs: 60_000 });
    const isPro = await resolveIsPro(email);
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
    const prefixes = isPro
      ? ['Animations/current/free/', 'Animations/current/pro/']
      : ['Animations/current/free/'];
    const results: any[] = [];
    for (const prefix of prefixes) {
      const objects = await listAll(prefix);
      for (const { Key } of objects) {
        const parts = Key.split('/');
        if (parts.length < 5) continue;
        const fileName = parts[parts.length - 1];
        if (fileName.startsWith('.')) continue;
        if (!IMAGE_EXTS.includes(extOf(fileName))) continue;
        const navParts = parts.slice(1, parts.length - 1);
        const sequenceName = navParts.join('/');
        results.push({ path: `${publicUrl}/${Key}`, sequence: sequenceName, isR2: true });
      }
    }
    return new Response(JSON.stringify(results), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
