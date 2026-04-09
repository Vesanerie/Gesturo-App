// Admin-only R2 catalog operations.
// Auth: requireAdmin() — caller must have profiles.is_admin = true.
// Future actions (delete/move/archive/...) will be added to the same function.
import {
  listAll,
  browseLevel,
  moveObject,
  deleteKeys,
  archiveKeyFor,
  unarchiveKeyFor,
  isAllowedAdminKey,
  presignPut,
  sanitizeFilename,
  CORS_HEADERS,
  requireAdmin,
} from '../_shared/r2.ts';

interface UploadFile { name: string; contentType?: string; path?: string }
interface Body {
  action?: string;
  prefix?: string;
  keys?: string[];
  destPrefix?: string;
  files?: UploadFile[];
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
      // Two modes:
      //   1. Explicit keys: { keys: [...] }
      //   2. Whole prefix:  { prefix: "Sessions/current/foo/" }
      //      → we expand to all keys under that prefix server-side.
      let keys: string[] = Array.isArray(body.keys) ? body.keys : [];
      if (keys.length === 0 && body.prefix) {
        const prefix = body.prefix.replace(/^\/+/, '');
        if (!prefix.endsWith('/')) return jsonError('prefix must end with /', 400);
        if (!isAllowedAdminKey(prefix)) return jsonError(`forbidden prefix: ${prefix}`, 400);
        const objects = await listAll(prefix);
        keys = objects.map((o) => o.Key);
      }
      if (keys.length === 0) return jsonError('keys or prefix is required', 400);
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

    if (action === 'unarchive') {
      // Two modes (same as delete/archive): explicit keys, or a prefix to expand.
      let keys: string[] = Array.isArray(body.keys) ? body.keys : [];
      if (keys.length === 0 && body.prefix) {
        const prefix = body.prefix.replace(/^\/+/, '');
        if (!prefix.endsWith('/')) return jsonError('prefix must end with /', 400);
        if (!isAllowedAdminKey(prefix)) return jsonError(`forbidden prefix: ${prefix}`, 400);
        const objects = await listAll(prefix);
        keys = objects.map((o) => o.Key);
      }
      if (keys.length === 0) return jsonError('keys or prefix is required', 400);

      const moved: { from: string; to: string }[] = [];
      const failed: { key: string; reason: string }[] = [];
      for (const k of keys) {
        if (!isAllowedAdminKey(k)) { failed.push({ key: k, reason: 'forbidden' }); continue; }
        const dest = unarchiveKeyFor(k);
        if (!dest) { failed.push({ key: k, reason: 'not under <root>/archive/<ts>/' }); continue; }
        try {
          await moveObject(k, dest);
          moved.push({ from: k, to: dest });
        } catch (err) {
          failed.push({ key: k, reason: (err as Error).message });
        }
      }
      return jsonOk({ action: 'unarchive', moved: moved.length, failed });
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

    if (action === 'upload-urls') {
      // Generate presigned PUT URLs so the browser uploads directly to R2.
      // The Edge Function never proxies the bytes — fast and free of size limits.
      const prefix = (body.prefix || '').replace(/^\/+/, '');
      const files = Array.isArray(body.files) ? body.files : [];
      if (!prefix.endsWith('/')) return jsonError('prefix must end with /', 400);
      if (!isAllowedAdminKey(prefix)) return jsonError(`forbidden prefix: ${prefix}`, 400);
      if (files.length === 0) return jsonError('files is required', 400);
      if (files.length > 100) return jsonError('max 100 files per call', 400);

      const out: { name: string; key: string; url: string }[] = [];
      for (const f of files) {
        // Build the relative path under `prefix`. If `path` is provided (folder
        // drop), sanitize each segment so subfolders are preserved but no
        // traversal/escape is possible.
        let relParts: string[];
        if (f.path && f.path.trim()) {
          relParts = f.path.split('/').filter(Boolean).map(sanitizeFilename);
        } else {
          relParts = [sanitizeFilename(f.name || '')];
        }
        if (relParts.length === 0) continue;
        const key = prefix + relParts.join('/');
        if (!isAllowedAdminKey(key)) continue;
        // 1h TTL: large folder uploads on slow connections were timing out
        // before all files finished. Safe — the URL is admin-gated upstream.
        const url = await presignPut(key, f.contentType, 3600);
        out.push({ name: f.name, key, url });
      }
      return jsonOk({ prefix, uploads: out });
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
