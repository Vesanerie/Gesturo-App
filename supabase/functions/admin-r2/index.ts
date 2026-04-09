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
  putEmpty,
  sanitizeFilename,
  CORS_HEADERS,
  requireAdmin,
  logAction,
  fetchAuditLog,
} from '../_shared/r2.ts';

interface UploadFile { name: string; contentType?: string; path?: string }
interface Body {
  action?: string;
  prefix?: string;
  keys?: string[];
  key?: string;
  newName?: string;
  destPrefix?: string;
  files?: UploadFile[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const adminEmail = await requireAdmin(req);

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
        await logAction(adminEmail, 'delete', body.prefix || keys[0], keys.length, { sample: keys.slice(0, 5) });
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
      await logAction(adminEmail, 'archive', body.prefix || keys[0], moved.length, { timestamp: ts, failed: failed.length });
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
      await logAction(adminEmail, 'unarchive', body.prefix || keys[0], moved.length, { failed: failed.length });
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
      await logAction(adminEmail, 'move', destPrefix, moved.length, { failed: failed.length });
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
      await logAction(adminEmail, 'upload', prefix, out.length);
      return jsonOk({ prefix, uploads: out });
    }

    if (action === 'audit-list') {
      const rows = await fetchAuditLog(200);
      return jsonOk({ rows });
    }

    if (action === 'stats') {
      // Compte + taille totale par root admin (Sessions/, Animations/).
      const out: Record<string, { count: number; bytes: number }> = {};
      const client = (await import('../_shared/r2.ts')).r2Client();
      const { ListObjectsV2Command } = await import('npm:@aws-sdk/client-s3@3');
      const bucket = Deno.env.get('R2_BUCKET')!;
      for (const root of ['Sessions/', 'Animations/']) {
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
      return jsonOk({ action: 'stats', roots: out });
    }

    if (action === 'mkdir') {
      // Create an empty folder by writing a `.keep` placeholder.
      // body: { prefix: "Sessions/current/foo/", newName: "bar" }
      const prefix = (body.prefix || '').replace(/^\/+/, '');
      const raw = (body.newName || '').trim();
      if (!prefix.endsWith('/')) return jsonError('prefix must end with /', 400);
      if (!isAllowedAdminKey(prefix)) return jsonError(`forbidden prefix: ${prefix}`, 400);
      const name = sanitizeFilename(raw);
      if (!name || name === 'file') return jsonError('invalid folder name', 400);
      const newPrefix = prefix + name + '/';
      const keepKey = newPrefix + '.keep';
      if (!isAllowedAdminKey(keepKey)) return jsonError('forbidden', 400);
      await putEmpty(keepKey);
      await logAction(adminEmail, 'mkdir', newPrefix, 1);
      return jsonOk({ action: 'mkdir', prefix: newPrefix, count: 1 });
    }

    if (action === 'rename') {
      // Two modes:
      //   1. File: { key, newName } → renames the single object in place.
      //   2. Folder: { prefix, newName } → moves every key under prefix to a sibling prefix.
      const raw = (body.newName || '').trim();
      const newName = sanitizeFilename(raw);
      if (!newName || newName === 'file') return jsonError('invalid new name', 400);

      if (body.key) {
        const key = body.key.replace(/^\/+/, '');
        if (!isAllowedAdminKey(key)) return jsonError('forbidden key', 400);
        const slash = key.lastIndexOf('/');
        const parent = slash === -1 ? '' : key.slice(0, slash + 1);
        const dest = parent + newName;
        if (dest === key) return jsonOk({ action: 'rename', moved: 0 });
        if (!isAllowedAdminKey(dest)) return jsonError('forbidden dest', 400);
        await moveObject(key, dest);
        await logAction(adminEmail, 'rename', key, 1, { to: dest });
        return jsonOk({ action: 'rename', moved: 1, from: key, to: dest });
      }

      if (body.prefix) {
        const prefix = body.prefix.replace(/^\/+/, '');
        if (!prefix.endsWith('/')) return jsonError('prefix must end with /', 400);
        if (!isAllowedAdminKey(prefix)) return jsonError('forbidden prefix', 400);
        // Compute parent + new prefix (sibling of the renamed folder).
        const parts = prefix.split('/').filter(Boolean);
        if (parts.length < 2) return jsonError('cannot rename root', 400);
        parts.pop();
        const parent = parts.join('/') + '/';
        const newPrefix = parent + newName + '/';
        if (newPrefix === prefix) return jsonOk({ action: 'rename', moved: 0 });
        if (!isAllowedAdminKey(newPrefix)) return jsonError('forbidden dest prefix', 400);
        const objects = await listAll(prefix);
        const moved: { from: string; to: string }[] = [];
        const failed: { key: string; reason: string }[] = [];
        for (const o of objects) {
          const dest = newPrefix + o.Key.slice(prefix.length);
          try {
            await moveObject(o.Key, dest);
            moved.push({ from: o.Key, to: dest });
          } catch (err) {
            failed.push({ key: o.Key, reason: (err as Error).message });
          }
        }
        await logAction(adminEmail, 'rename', prefix, moved.length, { to: newPrefix, failed: failed.length });
        return jsonOk({ action: 'rename', moved: moved.length, failed, prefix: newPrefix });
      }

      return jsonError('key or prefix is required', 400);
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
