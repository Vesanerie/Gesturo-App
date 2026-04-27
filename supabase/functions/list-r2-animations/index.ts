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
      // prefix like "Animations/current/free/" → depth 3, skip to get category name only
      const prefixDepth = prefix.split('/').filter(Boolean).length;
      for (const { Key } of objects) {
        const parts = Key.split('/');
        if (parts.length < prefixDepth + 2) continue;
        const fileName = parts[parts.length - 1];
        if (fileName.startsWith('.')) continue;
        if (!IMAGE_EXTS.includes(extOf(fileName))) continue;
        // Skip Animations/current/free|pro/ to get just the category path
        const catParts = parts.slice(prefixDepth, parts.length - 1);
        const sequenceName = catParts.join('/');
        results.push({ path: `${publicUrl}/${Key}`, sequence: sequenceName, isR2: true });
      }
    }

    // FREE users : on renvoie AUSSI les sequences Pro mais en "teaser locked"
    // (1 preview frame par séquence + flag locked). Permet au client d'afficher
    // la grille complète avec cadenas → inciter à upgrader. Sécurité : on
    // n'expose que la 1ère frame de chaque seq, pas tous les paths → un user
    // FREE ne peut pas reconstituer la séquence en brute-forçant les URLs.
    if (!isPro) {
      const proPrefix = 'Animations/current/pro/';
      const proObjects = await listAll(proPrefix);
      const proPrefixDepth = proPrefix.split('/').filter(Boolean).length;
      const seenSeqs = new Set<string>();
      for (const { Key } of proObjects) {
        const parts = Key.split('/');
        if (parts.length < proPrefixDepth + 2) continue;
        const fileName = parts[parts.length - 1];
        if (fileName.startsWith('.')) continue;
        if (!IMAGE_EXTS.includes(extOf(fileName))) continue;
        const catParts = parts.slice(proPrefixDepth, parts.length - 1);
        const sequenceName = catParts.join('/');
        if (seenSeqs.has(sequenceName)) continue;
        seenSeqs.add(sequenceName);
        results.push({
          path: `${publicUrl}/${Key}`,
          sequence: sequenceName,
          isR2: true,
          locked: true,
        });
      }
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
