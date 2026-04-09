// Admin-only R2 catalog operations.
// Auth: requireAdmin() — caller must have profiles.is_admin = true.
// Future actions (delete/move/archive/...) will be added to the same function.
import {
  listAll,
  browseLevel,
  moveObject,
  deleteKeys,
  archiveKeyFor,
  isAllowedAdminKey,
  CORS_HEADERS,
  requireAdmin,
} from '../_shared/r2.ts';

interface Body {
  action?: string;
  prefix?: string;
  keys?: string[];
  destPrefix?: string;
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

    if (action === 'delete' || action === 'archive') {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      if (keys.length === 0) return jsonError('keys is required (non-empty array)', 400);
      // Hard guard: every key must live under an allowed admin root.
      for (const k of keys) {
        if (!isAllowedAdminKey(k)) return jsonError(`forbidden key: ${k}`, 400);
      }

      if (action === 'delete') {
        await deleteKeys(keys);
        return jsonOk({ action: 'delete', count: keys.length });
      }

      // archive: move every key under <root>/archive/<ts>/<rest>. Single timestamp
      // for the whole batch so the group stays restorable as one unit.
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const moved: { from: string; to: string }[] = [];
      const failed: { key: string; reason: string }[] = [];
      for (const k of keys) {
        const dest = archiveKeyFor(k, ts);
        if (!dest) { failed.push({ key: k, reason: 'not under <root>/current/' }); continue; }
        try {
          await moveObject(k, dest);
          moved.push({ from: k, to: dest });
        } catch (err) {
          failed.push({ key: k, reason: (err as Error).message });
        }
      }
      return jsonOk({ action: 'archive', timestamp: ts, moved: moved.length, failed });
    }

    if (action === 'move') {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const destPrefix = (body.destPrefix || '').replace(/^\/+/, '');
      if (keys.length === 0) return jsonError('keys is required', 400);
      if (!destPrefix.endsWith('/')) return jsonError('destPrefix must end with /', 400);
      if (!isAllowedAdminKey(destPrefix)) return jsonError(`forbidden destPrefix: ${destPrefix}`, 400);
      for (const k of keys) {
        if (!isAllowedAdminKey(k)) return jsonError(`forbidden key: ${k}`, 400);
      }
      const moved: { from: string; to: string }[] = [];
      const failed: { key: string; reason: string }[] = [];
      for (const k of keys) {
        const fileName = k.split('/').pop() || '';
        const dest = destPrefix + fileName;
        if (dest === k) { failed.push({ key: k, reason: 'source equals dest' }); continue; }
        try {
          await moveObject(k, dest);
          moved.push({ from: k, to: dest });
        } catch (err) {
          failed.push({ key: k, reason: (err as Error).message });
        }
      }
      return jsonOk({ action: 'move', moved: moved.length, failed });
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
