// Rate limiting in-memory par worker Deno. Sliding window simple.
//
// Pourquoi in-memory et pas Postgres ?
// - Postgres = migration + latence + RLS à gérer. Overkill pour v1.
// - Les Edge Functions Supabase réutilisent leur worker entre requêtes
//   tant qu'il est "chaud". Un Map global survit donc aux invocations
//   consécutives, et chaque worker applique la limite localement.
// - Les abuseurs qui hammer agressivement se feront bloquer sur la
//   majorité de leurs requêtes (toutes celles qui tombent sur un même
//   worker chaud). Les scale-out workers froids leaked quelques requêtes,
//   acceptable vu le coût/bénéfice.
// - Si un jour on a besoin de limites dures cross-worker, on migrera
//   vers une table Postgres dédiée.
//
// Limites par défaut = 120 req / 60s par clé. Usage normal de Gesturo
// loin sous la barre (une session = quelques appels), un abus/scraper
// va dépasser immédiatement.

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

// Purge périodique pour éviter les leaks mémoire si beaucoup de keys
// différentes sur la durée de vie du worker.
let lastPurge = Date.now();
const PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 min

function purgeOldBuckets(now: number, windowMs: number) {
  if (now - lastPurge < PURGE_INTERVAL_MS) return;
  lastPurge = now;
  const cutoff = now - windowMs;
  for (const [key, bucket] of buckets.entries()) {
    // Nettoie d'abord les timestamps expirés, puis supprime le bucket si vide
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

interface RateLimitOptions {
  limit?: number;      // max requêtes dans la fenêtre
  windowMs?: number;   // durée de la fenêtre (ms)
}

/**
 * Throws a 429 Response if `key` a dépassé la limite dans la fenêtre.
 * À call après requireUser() (la key est typiquement l'email user) pour
 * limiter par utilisateur authentifié.
 *
 * Usage :
 *   const email = await requireUser(req);
 *   checkRateLimit(email); // 120/min par user par défaut
 */
export function checkRateLimit(key: string, opts: RateLimitOptions = {}): void {
  const limit = opts.limit ?? 120;
  const windowMs = opts.windowMs ?? 60_000;

  const now = Date.now();
  purgeOldBuckets(now, windowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  const cutoff = now - windowMs;
  // Garder uniquement les timestamps dans la fenêtre courante
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldestInWindow = bucket.timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
    throw new Response(
      JSON.stringify({ error: 'rate_limited', retry_after: retryAfterSec }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec),
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  bucket.timestamps.push(now);
}
