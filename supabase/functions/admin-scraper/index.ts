// Admin-only Edge Function: scrape images from a URL, compress to JPEG, upload to R2.
// Deployed with --no-verify-jwt (requireAdmin does its own auth check).

import { requireAdmin, CORS_HEADERS, putObject, sanitizeFilename } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'scan') {
      // Step 1: Fetch the page and extract image URLs
      const { url } = body;
      if (!url || typeof url !== 'string') {
        return json({ error: 'Missing url' }, 400);
      }

      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });
      if (!pageRes.ok) {
        return json({ error: `Failed to fetch page: ${pageRes.status}` }, 400);
      }

      const html = await pageRes.text();
      const baseUrl = new URL(url);

      const seen = new Set<string>();
      const images: { url: string; filename: string }[] = [];

      function addImage(rawUrl: string) {
        if (!rawUrl || rawUrl.startsWith('data:')) return;
        if (/icon|logo|favicon|sprite|pixel|tracking|badge|button|spacer/i.test(rawUrl)) return;

        let imgUrl: string;
        try {
          imgUrl = new URL(rawUrl, baseUrl.origin).href;
        } catch {
          return;
        }

        // Deduplicate by base path (ignore size variants)
        const dedupeKey = imgUrl.replace(/\/\d+x\//g, '/X/').replace(/[?#].*/, '');
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        // Pinterest: upgrade to originals (replace /236x/ or /474x/ with /originals/)
        let hqUrl = imgUrl;
        if (hqUrl.includes('pinimg.com')) {
          hqUrl = hqUrl.replace(/\/\d+x\//g, '/originals/');
        } else {
          hqUrl = hqUrl.replace(/[?&](w|width|h|height|resize|size|thumb|quality|q|fit|crop)=[^&]*/gi, '');
          hqUrl = hqUrl.replace(/\?$/, '').replace(/\?&/, '?').replace(/&&+/g, '&');
        }

        const urlPath = new URL(hqUrl).pathname;
        const baseName = urlPath.split('/').pop() || 'image';
        const filename = sanitizeFilename(baseName);

        images.push({ url: hqUrl, filename });
      }

      // 1. Extract from HTML attributes (img src, data-src, srcset, meta content)
      const imgPatterns = [
        /src=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi,
        /data-src=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi,
        /srcset=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)\s/gi,
        /data-lazy=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi,
        /content=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi,
      ];

      for (const pattern of imgPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) addImage(match[1]);
      }

      // 2. Extract image URLs from embedded JSON / script blocks (for SPAs like Pinterest)
      //    Scan for any URL that looks like an image inside <script> tags or JSON data
      const jsonImgPattern = /https?:\\?\/\\?\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp)/gi;
      let jsonMatch;
      while ((jsonMatch = jsonImgPattern.exec(html)) !== null) {
        // Unescape JSON-escaped URLs (e.g. \/ → /)
        const cleaned = jsonMatch[0].replace(/\\\//g, '/');
        addImage(cleaned);
      }

      return json({ images, count: images.length });
    }

    if (action === 'download') {
      // Step 2: Download images, compress to JPEG, upload to R2
      const { images, destPrefix, quality } = body;
      // images: { url: string, filename: string }[]
      // destPrefix: e.g. "Sessions/current/scraped/2026-04-25/"
      // quality: number (1-100), defaults to 75

      if (!images || !Array.isArray(images) || images.length === 0) {
        return json({ error: 'No images provided' }, 400);
      }
      if (!destPrefix || typeof destPrefix !== 'string') {
        return json({ error: 'Missing destPrefix' }, 400);
      }
      // Security: only allow uploads under Sessions/ or Animations/
      if (!destPrefix.startsWith('Sessions/') && !destPrefix.startsWith('Animations/')) {
        return json({ error: 'destPrefix must start with Sessions/ or Animations/' }, 403);
      }

      const jpegQuality = Math.min(100, Math.max(1, quality || 75));
      const results: { filename: string; ok: boolean; error?: string; size?: number }[] = [];
      const concurrency = 5;

      // Process in batches
      for (let i = 0; i < images.length; i += concurrency) {
        const batch = images.slice(i, i + concurrency);
        const promises = batch.map(async (img: { url: string; filename: string }) => {
          try {
            const imgRes = await fetch(img.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'image/*',
              },
            });
            if (!imgRes.ok) {
              results.push({ filename: img.filename, ok: false, error: `HTTP ${imgRes.status}` });
              return;
            }

            const blob = await imgRes.arrayBuffer();
            const bytes = new Uint8Array(blob);

            // Ensure .jpg extension
            let fname = img.filename;
            if (!/\.(jpg|jpeg)$/i.test(fname)) {
              fname = fname.replace(/\.[^.]+$/, '') + '.jpg';
            }

            const key = destPrefix + fname;
            await putObject(key, bytes, 'image/jpeg');
            results.push({ filename: fname, ok: true, size: bytes.length });
          } catch (e) {
            results.push({ filename: img.filename, ok: false, error: (e as Error).message });
          }
        });
        await Promise.all(promises);
      }

      const okCount = results.filter(r => r.ok).length;
      const failCount = results.filter(r => !r.ok).length;
      return json({ results, ok: okCount, failed: failCount });
    }

    if (action === 'download-zip') {
      // Download images server-side and return as a single binary ZIP
      const { images } = body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return json({ error: 'No images provided' }, 400);
      }

      // Simple ZIP builder (store method, no compression — images are already compressed)
      const files: { name: string; data: Uint8Array }[] = [];
      const concurrency = 5;

      for (let i = 0; i < images.length; i += concurrency) {
        const batch = images.slice(i, i + concurrency);
        const results = await Promise.allSettled(batch.map(async (img: { url: string; filename: string }) => {
          const imgRes = await fetch(img.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'image/*',
            },
          });
          if (!imgRes.ok) return null;
          const buf = await imgRes.arrayBuffer();
          let fname = img.filename;
          if (!/\.(jpg|jpeg|png|webp)$/i.test(fname)) fname = fname.replace(/\.[^.]+$/, '') + '.jpg';
          return { name: fname, data: new Uint8Array(buf) };
        }));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) files.push(r.value);
        }
      }

      if (files.length === 0) {
        return json({ error: 'No images could be downloaded' }, 400);
      }

      // Build ZIP in memory (store method — no deflate needed for images)
      const zipBytes = buildZip(files);
      return new Response(zipBytes, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="gesturo-scrape-${new Date().toISOString().slice(0, 10)}.zip"`,
        },
      });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

// Minimal ZIP builder (store method, no compression). Images are already compressed.
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: { offset: number; name: Uint8Array; data: Uint8Array; crc: number }[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  const enc = new TextEncoder();

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);

    // Local file header (30 bytes + name + data)
    const header = new Uint8Array(30 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true);  // signature
    hv.setUint16(4, 20, true);           // version needed
    hv.setUint16(6, 0, true);            // flags
    hv.setUint16(8, 0, true);            // compression (store)
    hv.setUint16(10, 0, true);           // mod time
    hv.setUint16(12, 0, true);           // mod date
    hv.setUint32(14, crc, true);         // crc32
    hv.setUint32(18, f.data.length, true); // compressed size
    hv.setUint32(22, f.data.length, true); // uncompressed size
    hv.setUint16(26, name.length, true);   // name length
    hv.setUint16(28, 0, true);             // extra length
    header.set(name, 30);

    entries.push({ offset, name, data: f.data, crc });
    parts.push(header, f.data);
    offset += header.length + f.data.length;
  }

  // Central directory
  const cdStart = offset;
  for (const e of entries) {
    const cd = new Uint8Array(46 + e.name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, e.crc, true);       // crc32
    cv.setUint32(20, e.data.length, true); // compressed
    cv.setUint32(24, e.data.length, true); // uncompressed
    cv.setUint16(28, e.name.length, true); // name length
    cv.setUint16(30, 0, true);             // extra length
    cv.setUint16(32, 0, true);             // comment length
    cv.setUint16(34, 0, true);             // disk start
    cv.setUint16(36, 0, true);             // internal attrs
    cv.setUint32(38, 0, true);             // external attrs
    cv.setUint32(42, e.offset, true);      // local header offset
    cd.set(e.name, 46);
    parts.push(cd);
    offset += cd.length;
  }
  const cdSize = offset - cdStart;

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);    // signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // cd disk
  ev.setUint16(8, entries.length, true);  // entries on disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdSize, true);         // cd size
  ev.setUint32(16, cdStart, true);        // cd offset
  ev.setUint16(20, 0, true);              // comment length
  parts.push(eocd);

  // Concatenate all parts
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

// CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
