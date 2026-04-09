// Admin-only R2 catalog operations.
// Auth: requireAdmin() — caller must have profiles.is_admin = true.
// Future actions (delete/move/archive/...) will be added to the same function.
import { listAll, browseLevel, CORS_HEADERS, requireAdmin } from '../_shared/r2.ts';

interface Body {
  action?: string;
  prefix?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    await requireAdmin(req);

    let body: Body = {};
    try { body = await req.json(); } catch { /* empty body ok for some actions later */ }

    const action = body.action || 'list';

    if (action === 'browse') {
      // One-level navigation, like a file manager. Returns folders + files at this level only.
      // Empty prefix is allowed here so the UI can browse from the bucket root.
      const prefix = (body.prefix || '').replace(/^\/+/, '');
      const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
      const { folders, files } = await browseLevel(prefix);
      return jsonOk({
        prefix,
        folders: folders.map((p) => ({ prefix: p, name: p.slice(prefix.length).replace(/\/$/, '') })),
        files: files.map((f) => ({
          key: f.Key,
          name: f.Key.slice(prefix.length),
          size: f.Size || 0,
          url: `${publicUrl}/${f.Key}`,
        })),
      });
    }

    if (action === 'list') {
      const prefix = (body.prefix || '').replace(/^\/+/, '');
      // Safety: refuse listing the entire bucket — too expensive and never useful.
      if (!prefix) {
        return jsonError('prefix is required', 400);
      }
      const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
      const objects = await listAll(prefix);
      const items = objects.map(({ Key }) => ({
        key: Key,
        url: `${publicUrl}/${Key}`,
      }));
      return jsonOk({ prefix, count: items.length, items });
    }

    return jsonError(`unknown action: ${action}`, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError((e as Error).message, 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
