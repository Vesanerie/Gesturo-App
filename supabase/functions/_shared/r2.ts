// Shared R2 client + listing helpers used by list-r2-photos / list-r2-animations.
// Credentials live in Supabase function secrets — never sent to clients.
import { S3Client, ListObjectsV2Command } from 'npm:@aws-sdk/client-s3@3';

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
  return data.email as string;
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
