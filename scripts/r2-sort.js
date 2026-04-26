#!/usr/bin/env node
/**
 * Gesturo R2 Sort — download samples, prepare sorting, execute moves.
 *
 * Usage:
 *   node scripts/r2-sort.js sample <prefix> [count]     Download N evenly-spaced samples to /tmp/gesturo-sort/
 *   node scripts/r2-sort.js download <prefix> <num>      Download a specific image (e.g. 035)
 *   node scripts/r2-sort.js open                         Open /tmp/gesturo-sort/thumbs/ in Finder
 *   node scripts/r2-sort.js plan <prefix> <plan.json>    Preview a sort plan (dry run)
 *   node scripts/r2-sort.js execute <prefix> <plan.json> Execute the sort plan (move files on R2)
 *
 * Plan JSON format:
 * [
 *   { "name": "ballon", "start": 31, "end": 110 },
 *   { "name": "baton", "start": 111, "end": 210 },
 *   ...
 * ]
 *
 * Workflow:
 * 1. `sample` to download thumbnails and look at them
 * 2. `download` specific images to find transition boundaries
 * 3. Create a plan.json with the category ranges
 * 4. `plan` to preview what will happen (dry run)
 * 5. `execute` to move files on R2 into sub-folders
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const SORT_DIR = '/tmp/gesturo-sort';
const THUMB_DIR = path.join(SORT_DIR, 'thumbs');
const AUDIT_LOG = path.resolve(__dirname, 'r2-audit.log');

function log(action, details) {
  const line = `[${new Date().toISOString()}] ${action} | ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  fs.appendFileSync(AUDIT_LOG, line + '\n');
}

async function listAll(prefix) {
  let all = [], token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    if (res.Contents) all.push(...res.Contents.filter(o => !o.Key.endsWith('.keep')));
    token = res.NextContinuationToken;
  } while (token);
  return all.sort((a, b) => a.Key.localeCompare(b.Key));
}

async function downloadFile(key, destPath) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

// ── SAMPLE ──────────────────────────────────────────────────────────────────
async function cmdSample(prefix, count = 50) {
  if (!prefix.endsWith('/')) prefix += '/';
  fs.mkdirSync(SORT_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });

  const all = await listAll(prefix);
  console.log(all.length + ' files in ' + prefix);

  const step = Math.max(1, Math.floor(all.length / count));
  const samples = [];
  for (let i = 0; i < all.length && samples.length < count; i += step) {
    samples.push(all[i]);
  }

  console.log('Downloading ' + samples.length + ' samples...');
  for (const obj of samples) {
    const name = obj.Key.split('/').pop();
    const dest = path.join(SORT_DIR, name);
    if (!fs.existsSync(dest)) {
      await downloadFile(obj.Key, dest);
      process.stdout.write('.');
    } else {
      process.stdout.write('s');
    }
    // Create thumbnail
    const thumbDest = path.join(THUMB_DIR, name);
    if (!fs.existsSync(thumbDest)) {
      try {
        execSync(`sips -Z 200 "${dest}" --out "${thumbDest}" 2>/dev/null`);
      } catch (e) {}
    }
  }
  console.log('\n✓ ' + samples.length + ' samples in ' + SORT_DIR);
  console.log('  Thumbnails in ' + THUMB_DIR);
  console.log('  Use: node scripts/r2-sort.js open');
}

// ── DOWNLOAD ONE ────────────────────────────────────────────────────────────
async function cmdDownload(prefix, num) {
  if (!prefix.endsWith('/')) prefix += '/';
  fs.mkdirSync(SORT_DIR, { recursive: true });

  const padded = String(num).padStart(3, '0');
  // Find the file matching this number
  const all = await listAll(prefix);
  const match = all.find(o => o.Key.includes('_' + padded + '.'));
  if (!match) {
    // Try direct construction
    const baseName = prefix.split('/').filter(Boolean).pop();
    const key = prefix + baseName + '_' + padded + '.jpg';
    try {
      await downloadFile(key, path.join(SORT_DIR, baseName + '_' + padded + '.jpg'));
      console.log('✓ Downloaded ' + key);
    } catch (e) {
      console.error('File not found: ' + key);
    }
    return;
  }
  const name = match.Key.split('/').pop();
  await downloadFile(match.Key, path.join(SORT_DIR, name));
  console.log('✓ Downloaded ' + name);
}

// ── OPEN ────────────────────────────────────────────────────────────────────
function cmdOpen() {
  if (fs.existsSync(THUMB_DIR)) {
    execSync(`open "${THUMB_DIR}"`);
    console.log('Opened ' + THUMB_DIR);
  } else if (fs.existsSync(SORT_DIR)) {
    execSync(`open "${SORT_DIR}"`);
    console.log('Opened ' + SORT_DIR);
  } else {
    console.log('Nothing to open. Run `sample` first.');
  }
}

// ── PLAN (dry run) ──────────────────────────────────────────────────────────
async function cmdPlan(prefix, planFile) {
  if (!prefix.endsWith('/')) prefix += '/';
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const all = await listAll(prefix);

  // Only count direct files (not in sub-folders already)
  const directFiles = all.filter(o => {
    const rel = o.Key.slice(prefix.length);
    return !rel.includes('/'); // no sub-folder
  });

  console.log('\n' + directFiles.length + ' files to sort in ' + prefix);
  console.log('─'.repeat(60));

  let totalPlanned = 0;
  for (const cat of plan) {
    const count = cat.end - cat.start + 1;
    totalPlanned += count;
    console.log('  ' + cat.name.padEnd(20) + ' pose_' + String(cat.start).padStart(3, '0') + ' → pose_' + String(cat.end).padStart(3, '0') + '  (' + count + ' files)');
  }

  console.log('─'.repeat(60));
  console.log('  Planned: ' + totalPlanned + ' / ' + directFiles.length + ' files');
  if (totalPlanned !== directFiles.length) {
    console.log('  ⚠ ' + (directFiles.length - totalPlanned) + ' files not covered!');
    // Find gaps
    const covered = new Set();
    for (const cat of plan) {
      for (let i = cat.start; i <= cat.end; i++) covered.add(i);
    }
    const missing = [];
    for (let i = 1; i <= directFiles.length; i++) {
      if (!covered.has(i)) missing.push(i);
    }
    if (missing.length <= 20) {
      console.log('  Missing: ' + missing.map(n => 'pose_' + String(n).padStart(3, '0')).join(', '));
    } else {
      console.log('  Missing: ' + missing.length + ' files (first 10: ' + missing.slice(0, 10).join(', ') + '...)');
    }
  }
  console.log('\nThis is a dry run. Use `execute` to apply.');
}

// ── EXECUTE ─────────────────────────────────────────────────────────────────
async function cmdExecute(prefix, planFile) {
  if (!prefix.endsWith('/')) prefix += '/';
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));

  console.log('Executing sort plan...\n');

  for (const cat of plan) {
    const dest = prefix + cat.name + '/';
    let moved = 0;

    for (let i = cat.start; i <= cat.end; i++) {
      const num = String(i).padStart(3, '0');
      // Find the actual file name pattern
      const oldKey = prefix + 'pose_' + num + '.jpg';
      const newNum = String(moved + 1).padStart(3, '0');
      const newKey = dest + cat.name + '_' + newNum + '.jpg';

      try {
        await client.send(new CopyObjectCommand({
          Bucket: BUCKET,
          CopySource: BUCKET + '/' + encodeURIComponent(oldKey),
          Key: newKey,
        }));
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
        moved++;
        if (moved % 50 === 0) console.log('  ' + cat.name + ': ' + moved + '/' + (cat.end - cat.start + 1));
      } catch (e) {
        console.warn('  ⚠ Failed: ' + oldKey + ' → ' + e.message);
      }
    }

    console.log('  ✓ ' + cat.name + ': ' + moved + ' files moved');
  }

  console.log('\nDone!');
  log('SORT', { prefix, plan: plan.map(c => c.name + ':' + c.start + '-' + c.end).join(', ') });
}

// ── CLI Router ──────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

(async () => {
  try {
    switch (cmd) {
      case 'sample':   await cmdSample(args[0] || '', parseInt(args[1]) || 50); break;
      case 'download': await cmdDownload(args[0] || '', args[1]); break;
      case 'open':     cmdOpen(); break;
      case 'plan':     await cmdPlan(args[0], args[1]); break;
      case 'execute':  await cmdExecute(args[0], args[1]); break;
      default:
        console.log(`
Gesturo R2 Sort — categorize images into sub-folders

Commands:
  sample <prefix> [count]      Download N evenly-spaced samples + thumbnails
  download <prefix> <num>      Download one specific image (e.g. 035)
  open                         Open thumbnails folder in Finder
  plan <prefix> <plan.json>    Preview sort plan (dry run)
  execute <prefix> <plan.json> Execute sort plan (move files on R2)

Workflow:
  1. Sample:    node scripts/r2-sort.js sample Sessions/current/poses-dynamiques/ 50
  2. Look:      Use Read tool on /tmp/gesturo-sort/pose_NNN.jpg to identify categories
  3. Boundary:  node scripts/r2-sort.js download Sessions/current/poses-dynamiques/ 035
  4. Plan:      Create plan.json with category ranges, then:
                node scripts/r2-sort.js plan Sessions/current/poses-dynamiques/ plan.json
  5. Execute:   node scripts/r2-sort.js execute Sessions/current/poses-dynamiques/ plan.json

Plan JSON format:
  [
    { "name": "libre", "start": 1, "end": 30 },
    { "name": "ballon", "start": 31, "end": 110 },
    { "name": "baton", "start": 111, "end": 210 }
  ]
`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
