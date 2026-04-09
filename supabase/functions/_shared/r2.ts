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

// Auth: require a valid Supabase JWT. Returns user email or throws 401.
export async function requireUser(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new Response('Unauthorized', { status: 401 });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  if (!res.ok) throw new Response('Unauthorized', { status: 401 });
  const data = await res.json();
  if (!data?.email) throw new Response('Unauthorized', { status: 401 });
  return data.email as string;
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
