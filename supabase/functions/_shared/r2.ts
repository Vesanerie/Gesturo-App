// Shared R2 client + listing helpers used by list-r2-photos / list-r2-animations.
// Credentials live in Supabase function secrets — never sent to clients.
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';

export const NUDITY_CATEGORIES = ['nudite'];
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

export function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: Deno.env.get('R2_ENDPOINT')!,
    credentials: {
      accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    },
    // R2 doesn't validate AWS-style request checksums; the SDK's default of
    // WHEN_SUPPORTED bakes a CRC32 placeholder into presigned URLs that the
    // browser can't satisfy. WHEN_REQUIRED keeps presigning compatible.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export async function listAll(prefix: string) {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  const out: { Key: string }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const o of res.Contents || []) if (o.Key) out.push({ Key: o.Key });
    token = res.NextContinuationToken;
  } while (token);
  return out;
}

// Like listAll but with delimiter='/' to return one level only:
// - "folders" = sub-prefixes immediately under `prefix` (the "directories")
// - "files"   = objects whose key has no further '/' after `prefix`
// Used by the admin file-browser UI for folder navigation.
export async function browseLevel(prefix: string) {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  const folders: string[] = [];
  const files: { Key: string; Size?: number }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: token,
    }));
    for (const cp of res.CommonPrefixes || []) if (cp.Prefix) folders.push(cp.Prefix);
    for (const o of res.Contents || []) {
      if (!o.Key) continue;
      // Skip "directory marker" objects (some S3 clients create empty keys ending in '/')
      if (o.Key === prefix || o.Key.endsWith('/')) continue;
      // Skip .keep placeholders used to materialize empty folders.
      if (o.Key.endsWith('/.keep')) continue;
      files.push({ Key: o.Key, Size: o.Size });
    }
    token = res.NextContinuationToken;
  } while (token);
  return { folders, files };
}

// Allowed roots for any admin write operation. Hard guard against malicious or
// buggy clients trying to touch keys outside the catalog.
export const ADMIN_ALLOWED_ROOTS = ['Sessions/', 'Animations/', 'Blog/', 'Roadmap/'];

export function isAllowedAdminKey(key: string): boolean {
  if (!key || key.includes('..')) return false;
  return ADMIN_ALLOWED_ROOTS.some((r) => key.startsWith(r));
}

// Copy + Delete (S3/R2 has no atomic move). Used by archive and move actions.
// By default refuses to overwrite an existing destination — silent overwrite
// would be data loss (e.g. moving foo.jpg into a folder that already has one).
// Pass { overwrite: true } to bypass (currently nobody does).
export async function moveObject(srcKey: string, destKey: string, opts: { overwrite?: boolean } = {}) {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  if (!opts.overwrite) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: destKey }));
      // HeadObject succeeded → destination already exists, refuse.
      throw new Error('destination already exists');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'destination already exists') throw e;
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (e as { name?: string }).name;
      // 404 / NotFound = good, the destination is free. Anything else = real error, rethrow.
      if (status !== 404 && name !== 'NotFound' && name !== 'NoSuchKey') throw e;
    }
  }
  // CopySource must be URL-encoded (spaces, accents, etc.)
  const copySource = `${bucket}/${srcKey.split('/').map(encodeURIComponent).join('/')}`;
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: copySource,
    Key: destKey,
  }));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: srcKey }));
}

// Bulk delete (up to 1000 keys per call per S3 spec).
export async function deleteKeys(keys: string[]) {
  if (keys.length === 0) return;
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  // Chunk by 1000 to stay within S3 limits.
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

// Archive a key by moving it from "<root>/current/<rest>" to "<root>/archive/<ts>/<rest>".
// Returns the new key. The timestamp groups all keys archived in the same admin
// call, so a single "archive batch" stays together and can be restored as a unit.
export function archiveKeyFor(key: string, timestamp: string): string | null {
  for (const root of ADMIN_ALLOWED_ROOTS) {
    const currentPrefix = root + 'current/';
    if (key.startsWith(currentPrefix)) {
      return root + 'archive/' + timestamp + '/' + key.slice(currentPrefix.length);
    }
  }
  return null;
}

// Inverse of archiveKeyFor: takes a key under "<root>/archive/<ts>/<rest>" and
// returns the corresponding "<root>/current/<rest>" path. Returns null if the
// key isn't an archived one.
export function unarchiveKeyFor(key: string): string | null {
  for (const root of ADMIN_ALLOWED_ROOTS) {
    const archivePrefix = root + 'archive/';
    if (!key.startsWith(archivePrefix)) continue;
    const rest = key.slice(archivePrefix.length);   // e.g. "2026-04-09T08-30-00-000Z/animals/foo.jpg"
    const slash = rest.indexOf('/');
    if (slash === -1) return null;
    return root + 'current/' + rest.slice(slash + 1);
  }
  return null;
}

// Sanitize a filename for safe use as the last segment of an R2 key.
// Strips path separators, control chars, leading dots; collapses to "file" if empty.
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\x00-\x1f\x7f]/g, '')   // control chars
    .replace(/[\\/]/g, '_')             // path separators
    .replace(/^\.+/, '')                // leading dots
    .trim();
  return cleaned || 'file';
}

// Generate a short-lived presigned PUT URL so the browser can upload directly to R2.
// The Edge Function never sees the file bytes — it just signs the URL.
export async function presignPut(key: string, contentType?: string, expiresInSec = 300, bucketOverride?: string): Promise<string> {
  const client = r2Client();
  const bucket = bucketOverride || Deno.env.get('R2_BUCKET')!;
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(client, cmd, { expiresIn: expiresInSec });
}

// Upload bytes directly to R2 (server-side). Used when the client can't PUT
// directly (e.g. Capacitor iOS where CORS on presigned URLs is blocked).
export async function putObject(key: string, body: Uint8Array, contentType = 'image/jpeg') {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

// Create an empty placeholder object so an empty "folder" appears in browseLevel().
// R2/S3 has no real folders — this writes "<prefix>/.keep" which is filtered out
// of listings (see browseLevel) but still makes the CommonPrefix exist.
export async function putEmpty(key: string) {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }));
}

export function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Auth: require a valid Supabase JWT. Returns user email or throws 401.
export async function requireUser(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  if (!res.ok) throw new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
  const data = await res.json();
  if (!data?.email) throw new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
  return (data.email as string).toLowerCase();
}

// Server-side admin check. NEVER trust a client-supplied is_admin flag.
// Returns the email if the caller is admin, or throws a 403 Response.
// Used by every admin-* Edge Function (catalog rotation, etc.).
export async function requireAdmin(req: Request): Promise<string> {
  const email = await requireUser(req);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const res = await fetch(
      `${url}/rest/v1/profiles?select=is_admin&email=eq.${encodeURIComponent(email.toLowerCase())}`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } },
    );
    if (!res.ok) throw new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.is_admin !== true) {
      throw new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
    }
    return email;
  } catch (e) {
    if (e instanceof Response) throw e;
    throw new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
  }
}

// Run an async task on each item with bounded concurrency.
// Returns { ok: T[], failed: { item, reason }[] }.
export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<{ ok: R[]; failed: { item: T; reason: string }[] }> {
  const ok: R[] = [];
  const failed: { item: T; reason: string }[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        ok.push(await fn(item));
      } catch (err) {
        failed.push({ item, reason: (err as Error).message });
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return { ok, failed };
}

// Stats récursifs par root admin (count + total bytes).
export async function computeStats(roots: string[]) {
  const client = r2Client();
  const bucket = Deno.env.get('R2_BUCKET')!;
  const out: Record<string, { count: number; bytes: number }> = {};
  for (const root of roots) {
    let count = 0; let bytes = 0;
    let token: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: root, ContinuationToken: token,
      }));
      for (const o of res.Contents || []) {
        if (!o.Key || o.Key.endsWith('/.keep')) continue;
        count++;
        bytes += o.Size || 0;
      }
      token = res.NextContinuationToken;
    } while (token);
    out[root] = { count, bytes };
  }
  return out;
}

// Insert a row into admin_audit_log via the service role REST endpoint.
// Best-effort: a logging failure must NEVER block the underlying admin action.
export async function logAction(
  email: string,
  action: string,
  target: string | null,
  count: number | null,
  details?: unknown,
) {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    await fetch(`${url}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ email, action, target, count, details: details ?? null }),
    });
  } catch { /* swallow */ }
}

// Fetch the last N audit log rows. Admin only — caller must have validated requireAdmin.
export async function fetchAuditLog(limit = 100) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(
    `${url}/rest/v1/admin_audit_log?select=*&order=ts.desc&limit=${limit}`,
    { headers: { apikey: service, Authorization: `Bearer ${service}` } },
  );
  if (!res.ok) return [];
  return await res.json();
}

// Server-side Pro resolution. NEVER trust a client-supplied isPro flag.
// Mirrors checkProFromSupabase() in main.js: plan === 'pro' and not expired.
export async function resolveIsPro(email: string): Promise<boolean> {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const res = await fetch(
      `${url}/rest/v1/profiles?select=plan,pro_expires_at&email=eq.${encodeURIComponent(email.toLowerCase())}`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.plan !== 'pro') return false;
    if (row.pro_expires_at && new Date(row.pro_expires_at) < new Date()) return false;
    return true;
  } catch {
    return false;
  }
}
