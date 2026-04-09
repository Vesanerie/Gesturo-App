// List R2 animations under Animations/current/{free,pro}/. Mirrors main.js listR2Animations.
import { listAll, extOf, IMAGE_EXTS, CORS_HEADERS } from '../_shared/r2.ts';

// NOTE: no auth — listing returns public CDN URLs (R2_PUBLIC_URL is public).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
    const prefixes = ['Animations/current/free/', 'Animations/current/pro/'];
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
