// Daily challenge generator.
// Picks a random image from R2 Sessions/current/ (excluding body-parts
// categories) and creates a challenge row if none exists for today.
// Public (no auth) — designed to be called by a cron or triggered from
// the client when no active challenge exists.
import { listAll, extOf, IMAGE_EXTS, CORS_HEADERS } from '../_shared/r2.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXCLUDED_SUBS = ['pieds', 'jambes', 'mains', 'feet', 'legs', 'hands'];

function isExcluded(key: string): boolean {
  const lower = key.toLowerCase();
  return EXCLUDED_SUBS.some(s => lower.includes('/' + s + '/') || lower.includes('/' + s));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service);

    // Check if a challenge already exists for today
    const { data: existing } = await admin
      .from('challenges').select('id')
      .gte('created_at', new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ ok: true, existing: true, id: existing[0].id }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // List all images under Sessions/current/
    const objects = await listAll('Sessions/current/');
    const candidates = objects.filter(({ Key }) => {
      if (isExcluded(Key)) return false;
      const fileName = Key.split('/').pop() || '';
      if (fileName.startsWith('.')) return false;
      return IMAGE_EXTS.includes(extOf(fileName));
    });

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'no candidates' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Pick a random image
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
    const refImageUrl = `${publicUrl}/${pick.Key}`;

    // Create the challenge — deadline = today 23:59 UTC
    const today = new Date().toISOString().slice(0, 10);
    const deadline = today + 'T23:59:59Z';

    const { data: challenge, error } = await admin
      .from('challenges').insert({
        title: 'Draw this in your style',
        ref_image_url: refImageUrl,
        deadline,
      }).select('id').single();

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, existing: false, id: challenge.id }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Response ? 'auth error' : (e as Error).message;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
