#!/usr/bin/env node
/**
 * Gesturo R2 CLI — manage the gesturo-photos bucket from the terminal.
 *
 * Usage:
 *   node scripts/r2.js list [prefix]                          List folders & files
 *   node scripts/r2.js stats [prefix]                         Stats per folder (count, size, formats)
 *   node scripts/r2.js rename <prefix> <shortName>            Batch rename files → shortName_001.jpg
 *   node scripts/r2.js move <oldPrefix> <newPrefix>           Move/rename a folder
 *   node scripts/r2.js upload <localPath> <destPrefix> [opts] Upload files (--compress --quality N --watermark)
 *   node scripts/r2.js delete <prefix>                        Delete files under prefix
 *   node scripts/r2.js backup                                 Snapshot full catalogue to JSON
 *   node scripts/r2.js duplicates [prefix]                    Find duplicate files by size+name pattern
 *   node scripts/r2.js watermark <localPath> [--text T]       Add watermark to image(s) without uploading
 *
 * All operations are logged to scripts/r2-audit.log
 */

const { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const BUCKET = process.env.R2_BUCKET || 'gesturo-photos';
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const AUDIT_LOG = path.resolve(__dirname, 'r2-audit.log');
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');

// ── Helpers ─────────────────────────────────────────────────────────────────
function log(action, details) {
  const line = `[${new Date().toISOString()}] ${action} | ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  fs.appendFileSync(AUDIT_LOG, line + '\n');
}

async function listAll(prefix = '') {
  let all = [], token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    if (res.Contents) all.push(...res.Contents);
    token = res.NextContinuationToken;
  } while (token);
  return all;
}

async function listFolders(prefix = '') {
  let folders = [], token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, Delimiter: '/', ContinuationToken: token,
    }));
    if (res.CommonPrefixes) folders.push(...res.CommonPrefixes.map(p => p.Prefix));
    token = res.NextContinuationToken;
  } while (token);
  return folders;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function getMimeType(ext) {
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// ── Commands ────────────────────────────────────────────────────────────────

// LIST
async function cmdList(prefix = '') {
  const folders = await listFolders(prefix);
  const res = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET, Prefix: prefix, Delimiter: '/',
  }));
  const files = (res.Contents || []).filter(o => !o.Key.endsWith('/'));

  if (folders.length) {
    console.log('\nFolders:');
    folders.forEach(f => console.log('  📁 ' + f));
  }
  if (files.length) {
    console.log('\nFiles:');
    files.forEach(f => console.log('  📄 ' + f.Key.split('/').pop() + '  (' + formatSize(f.Size) + ')'));
  }
  console.log('\n' + folders.length + ' folders, ' + files.length + ' files');
}

// STATS
async function cmdStats(prefix = '') {
  const folders = await listFolders(prefix);
  const targets = folders.length ? folders : [prefix];

  console.log('\n' + '─'.repeat(80));
  console.log('  Folder'.padEnd(50) + 'Files'.padStart(8) + 'Size'.padStart(12) + 'Avg'.padStart(10));
  console.log('─'.repeat(80));

  let totalFiles = 0, totalSize = 0;

  for (const folder of targets) {
    const objects = await listAll(folder);
    const real = objects.filter(o => !o.Key.endsWith('.keep') && !o.Key.endsWith('/'));
    const size = real.reduce((s, o) => s + (o.Size || 0), 0);
    const avg = real.length ? size / real.length : 0;
    const label = folder.replace(prefix, '') || folder;

    console.log('  ' + label.padEnd(48) + String(real.length).padStart(8) + formatSize(size).padStart(12) + formatSize(avg).padStart(10));
    totalFiles += real.length;
    totalSize += size;
  }

  console.log('─'.repeat(80));
  console.log('  TOTAL'.padEnd(48) + String(totalFiles).padStart(8) + formatSize(totalSize).padStart(12));
  console.log('');
}

// RENAME
async function cmdRename(prefix, shortName) {
  if (!prefix || !shortName) { console.error('Usage: r2.js rename <prefix> <shortName>'); process.exit(1); }
  if (!prefix.endsWith('/')) prefix += '/';

  const objects = (await listAll(prefix)).filter(o => !o.Key.endsWith('.keep'));
  objects.sort((a, b) => a.Key.localeCompare(b.Key));
  console.log(prefix + ' → ' + objects.length + ' files to rename');

  let renamed = 0;
  for (let i = 0; i < objects.length; i++) {
    const old = objects[i].Key;
    const ext = old.split('.').pop().toLowerCase();
    const num = String(i + 1).padStart(3, '0');
    const newKey = prefix + shortName + '_' + num + '.' + ext;

    if (old === newKey) { renamed++; continue; }

    await client.send(new CopyObjectCommand({
      Bucket: BUCKET, CopySource: BUCKET + '/' + encodeURIComponent(old), Key: newKey,
    }));
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: old }));
    renamed++;
    if (renamed % 50 === 0) console.log('  ' + renamed + '/' + objects.length);
  }
  console.log('  ✓ ' + renamed + ' renamed');
  log('RENAME', { prefix, shortName, count: renamed });
}

// MOVE
async function cmdMove(oldPrefix, newPrefix) {
  if (!oldPrefix || !newPrefix) { console.error('Usage: r2.js move <oldPrefix> <newPrefix>'); process.exit(1); }
  if (!oldPrefix.endsWith('/')) oldPrefix += '/';
  if (!newPrefix.endsWith('/')) newPrefix += '/';

  const objects = await listAll(oldPrefix);
  console.log('Moving ' + objects.length + ' files: ' + oldPrefix + ' → ' + newPrefix);

  let moved = 0;
  for (const obj of objects) {
    const newKey = newPrefix + obj.Key.slice(oldPrefix.length);
    await client.send(new CopyObjectCommand({
      Bucket: BUCKET, CopySource: BUCKET + '/' + encodeURIComponent(obj.Key), Key: newKey,
    }));
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    moved++;
    if (moved % 50 === 0) console.log('  ' + moved + '/' + objects.length);
  }
  console.log('  ✓ ' + moved + ' moved');
  log('MOVE', { from: oldPrefix, to: newPrefix, count: moved });
}

// UPLOAD
async function cmdUpload(localPath, destPrefix, opts = {}) {
  if (!localPath || !destPrefix) { console.error('Usage: r2.js upload <localPath> <destPrefix> [--compress] [--quality N] [--watermark]'); process.exit(1); }
  if (!destPrefix.endsWith('/')) destPrefix += '/';

  const stat = fs.statSync(localPath);
  let files;
  if (stat.isDirectory()) {
    files = fs.readdirSync(localPath)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => path.join(localPath, f));
  } else {
    files = [localPath];
  }

  console.log(files.length + ' files to upload to ' + destPrefix);

  // Find existing files to continue numbering
  const existing = await listAll(destPrefix);
  let nextNum = existing.filter(o => !o.Key.endsWith('.keep')).length + 1;

  const tmpDir = path.join(require('os').tmpdir(), 'gesturo-upload-' + Date.now());
  if (opts.compress || opts.watermark) fs.mkdirSync(tmpDir, { recursive: true });

  let uploaded = 0;
  for (const file of files) {
    let filePath = file;
    const ext = path.extname(file).slice(1).toLowerCase();
    const quality = opts.quality || 80;

    // Compress
    if (opts.compress && /^(jpg|jpeg|png)$/i.test(ext)) {
      const tmpFile = path.join(tmpDir, path.basename(file));
      fs.copyFileSync(file, tmpFile);
      try {
        if (/^(jpg|jpeg)$/i.test(ext)) {
          execSync(`sips -s formatOptions ${quality} "${tmpFile}" 2>/dev/null`);
        } else if (ext === 'png') {
          execSync(`sips -s format jpeg -s formatOptions ${quality} "${tmpFile}" --out "${tmpFile.replace('.png', '.jpg')}" 2>/dev/null`);
        }
        filePath = ext === 'png' ? tmpFile.replace('.png', '.jpg') : tmpFile;
      } catch (e) {
        console.warn('  ⚠ compress failed for ' + path.basename(file) + ', uploading original');
      }
    }

    // Watermark
    if (opts.watermark) {
      const tmpFile = opts.compress ? filePath : path.join(tmpDir, path.basename(file));
      if (!opts.compress) fs.copyFileSync(file, tmpFile);
      filePath = tmpFile;
      const text = opts.watermarkText || 'gesturo.art';
      try {
        // Use sips to get dimensions, then ImageMagick-free approach with sips
        // We'll use a lightweight approach: add text via canvas if available, otherwise skip
        const dims = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null`).toString();
        const w = parseInt(dims.match(/pixelWidth:\s*(\d+)/)?.[1] || '1000');
        const h = parseInt(dims.match(/pixelHeight:\s*(\d+)/)?.[1] || '1000');
        const fontSize = Math.max(12, Math.floor(Math.min(w, h) * 0.025));

        // Create a temporary watermark script using system Python
        const pyScript = `
import subprocess, sys
try:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open("${filePath}")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", ${fontSize})
    except:
        font = ImageFont.load_default()
    text = "${text}"
    bbox = draw.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    x = img.width - tw - ${Math.floor(fontSize * 0.8)}
    y = img.height - th - ${Math.floor(fontSize * 0.8)}
    draw.text((x, y), text, fill=(255,255,255,40), font=font)
    img.save("${filePath}", quality=${opts.quality || 80})
except Exception as e:
    sys.exit(0)
`;
        fs.writeFileSync(path.join(tmpDir, '_wm.py'), pyScript);
        try {
          execSync(`python3 "${path.join(tmpDir, '_wm.py')}" 2>/dev/null`);
        } catch (e) {
          // Watermark failed silently — upload without it
        }
      } catch (e) {
        // Skip watermark
      }
    }

    const finalExt = path.extname(filePath).slice(1).toLowerCase() || ext;
    const num = String(nextNum).padStart(3, '0');
    const destName = path.basename(destPrefix.slice(0, -1)) || 'file';
    // Use folder name as prefix for the filename
    const shortName = destName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'img';
    const key = destPrefix + shortName + '_' + num + '.' + finalExt;

    const body = fs.readFileSync(filePath);
    await client.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body,
      ContentType: getMimeType(finalExt),
    }));

    const origSize = fs.statSync(file).size;
    const finalSize = body.length;
    const saved = opts.compress ? ' (' + Math.round((1 - finalSize / origSize) * 100) + '% saved)' : '';
    console.log('  ✓ ' + key + '  ' + formatSize(finalSize) + saved);

    nextNum++;
    uploaded++;
  }

  // Cleanup
  if (opts.compress || opts.watermark) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) {}
  }

  console.log('\n' + uploaded + ' files uploaded to ' + destPrefix);
  log('UPLOAD', { dest: destPrefix, count: uploaded, compress: !!opts.compress, watermark: !!opts.watermark });
}

// DELETE
async function cmdDelete(prefix) {
  if (!prefix) { console.error('Usage: r2.js delete <prefix>'); process.exit(1); }

  const objects = await listAll(prefix);
  if (!objects.length) { console.log('Nothing to delete.'); return; }

  console.log(objects.length + ' files to delete under ' + prefix);
  console.log('First 5:');
  objects.slice(0, 5).forEach(o => console.log('  ' + o.Key));
  if (objects.length > 5) console.log('  ... and ' + (objects.length - 5) + ' more');

  // No interactive confirm in CLI — caller must be intentional
  let deleted = 0;
  for (const obj of objects) {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    deleted++;
    if (deleted % 50 === 0) console.log('  ' + deleted + '/' + objects.length);
  }
  console.log('  ✓ ' + deleted + ' deleted');
  log('DELETE', { prefix, count: deleted });
}

// BACKUP
async function cmdBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  console.log('Scanning entire bucket...');
  const all = await listAll('');
  const snapshot = {
    timestamp: new Date().toISOString(),
    bucket: BUCKET,
    totalFiles: all.length,
    totalSize: all.reduce((s, o) => s + (o.Size || 0), 0),
    files: all.map(o => ({
      key: o.Key,
      size: o.Size,
      modified: o.LastModified?.toISOString(),
    })),
  };

  const filename = 'r2-backup-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
  const filepath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

  console.log('✓ Backup saved: ' + filepath);
  console.log('  ' + snapshot.totalFiles + ' files, ' + formatSize(snapshot.totalSize));
  log('BACKUP', { file: filename, files: snapshot.totalFiles, size: snapshot.totalSize });
}

// DUPLICATES
async function cmdDuplicates(prefix = '') {
  console.log('Scanning for duplicates...');
  const all = await listAll(prefix);
  const real = all.filter(o => !o.Key.endsWith('.keep') && !o.Key.endsWith('/'));

  // Group by size (exact same size = potential duplicate)
  const bySize = {};
  real.forEach(o => {
    const k = String(o.Size);
    if (!bySize[k]) bySize[k] = [];
    bySize[k].push(o);
  });

  const dupes = Object.entries(bySize)
    .filter(([_, objs]) => objs.length > 1)
    .sort((a, b) => parseInt(b[0]) - parseInt(a[0])); // biggest first

  if (!dupes.length) {
    console.log('No duplicates found!');
    return;
  }

  let totalWaste = 0;
  console.log('\nPotential duplicates (same file size):');
  console.log('─'.repeat(80));

  for (const [size, objs] of dupes) {
    const s = parseInt(size);
    const waste = s * (objs.length - 1);
    totalWaste += waste;
    console.log('\n  Size: ' + formatSize(s) + ' (' + objs.length + ' files, ' + formatSize(waste) + ' wasted)');
    objs.forEach(o => console.log('    ' + o.Key));
  }

  console.log('\n─'.repeat(80));
  console.log(dupes.length + ' groups of duplicates, ' + formatSize(totalWaste) + ' potentially wasted');
  log('DUPLICATES', { groups: dupes.length, wastedBytes: totalWaste });
}

// WATERMARK (local only, no upload)
async function cmdWatermark(localPath, text = 'gesturo.art') {
  if (!localPath) { console.error('Usage: r2.js watermark <localPath> [--text T]'); process.exit(1); }

  const stat = fs.statSync(localPath);
  let files;
  if (stat.isDirectory()) {
    files = fs.readdirSync(localPath)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => path.join(localPath, f));
  } else {
    files = [localPath];
  }

  console.log(files.length + ' files to watermark with "' + text + '"');

  for (const file of files) {
    const dims = execSync(`sips -g pixelWidth -g pixelHeight "${file}" 2>/dev/null`).toString();
    const w = parseInt(dims.match(/pixelWidth:\s*(\d+)/)?.[1] || '1000');
    const h = parseInt(dims.match(/pixelHeight:\s*(\d+)/)?.[1] || '1000');
    const fontSize = Math.max(12, Math.floor(Math.min(w, h) * 0.025));

    const pyScript = `
from PIL import Image, ImageDraw, ImageFont
import sys
img = Image.open("${file}")
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", ${fontSize})
except:
    font = ImageFont.load_default()
bbox = draw.textbbox((0,0), "${text}", font=font)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
x = img.width - tw - ${Math.floor(fontSize * 0.8)}
y = img.height - th - ${Math.floor(fontSize * 0.8)}
draw.text((x, y), "${text}", fill=(255,255,255,40), font=font)
img.save("${file}")
print("ok")
`;
    try {
      execSync(`python3 -c '${pyScript.replace(/'/g, "\\'")}' 2>/dev/null`);
      console.log('  ✓ ' + path.basename(file));
    } catch (e) {
      console.log('  ✗ ' + path.basename(file) + ' (needs Pillow: pip3 install Pillow)');
    }
  }
  log('WATERMARK', { path: localPath, text, count: files.length });
}

// ── CLI Router ──────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

function parseOpts(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--compress') opts.compress = true;
    else if (args[i] === '--watermark') opts.watermark = true;
    else if (args[i] === '--quality' && args[i + 1]) opts.quality = parseInt(args[++i]);
    else if (args[i] === '--text' && args[i + 1]) opts.watermarkText = args[++i];
    else positional.push(args[i]);
  }
  return { positional, opts };
}

(async () => {
  try {
    const { positional, opts } = parseOpts(args);

    switch (cmd) {
      case 'list':    await cmdList(positional[0] || ''); break;
      case 'stats':   await cmdStats(positional[0] || ''); break;
      case 'rename':  await cmdRename(positional[0], positional[1]); break;
      case 'move':    await cmdMove(positional[0], positional[1]); break;
      case 'upload':  await cmdUpload(positional[0], positional[1], opts); break;
      case 'delete':  await cmdDelete(positional[0]); break;
      case 'backup':  await cmdBackup(); break;
      case 'duplicates': await cmdDuplicates(positional[0] || ''); break;
      case 'watermark': await cmdWatermark(positional[0], opts.watermarkText || 'gesturo.art'); break;
      default:
        console.log(`
Gesturo R2 CLI — manage the gesturo-photos bucket

Commands:
  list [prefix]                           List folders & files
  stats [prefix]                          Stats per folder
  rename <prefix> <shortName>             Batch rename → shortName_001.jpg
  move <oldPrefix> <newPrefix>            Move/rename folder
  upload <path> <dest> [--compress]       Upload files (--quality N --watermark)
  delete <prefix>                         Delete files under prefix
  backup                                  Snapshot catalogue to JSON
  duplicates [prefix]                     Find duplicate files by size
  watermark <path> [--text gesturo.art]   Add watermark locally

Examples:
  node scripts/r2.js list Sessions/current/
  node scripts/r2.js stats Sessions/current/
  node scripts/r2.js rename Sessions/current/mains/ mains
  node scripts/r2.js move Sessions/current/old/ Sessions/current/new/
  node scripts/r2.js upload ~/Desktop/photos Sessions/current/mains/ --compress --quality 75
  node scripts/r2.js upload ~/Desktop/img.jpg Sessions/current/mains/ --compress --watermark
  node scripts/r2.js backup
  node scripts/r2.js duplicates Sessions/current/
  node scripts/r2.js watermark ~/Desktop/photos --text gesturo.art
`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
