'use strict';

/**
 * Duplicate detection + .dupes/ routing + manifest.
 *
 * Flow:
 *   1. Hash the file (SHA-256).
 *   2. Look the hash up in file_hashes.
 *      - HIT and the original still exists  -> it's a duplicate.
 *      - MISS (or original gone)            -> not a duplicate; index it.
 *   3. Duplicates are routed to .file-organiser/.dupes/{category}/ and a
 *      manifest entry is appended. Nothing is ever deleted.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { sha256File } = require('./hasher');
const { ensureUniquePath } = require('./sorter');
const { DUPES_DIR, DUPES_MANIFEST } = require('./config');

function readManifest() {
  try {
    const raw = fs.readFileSync(DUPES_MANIFEST, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifestEntry(entry) {
  const list = readManifest();
  list.push(entry);
  fs.mkdirSync(path.dirname(DUPES_MANIFEST), { recursive: true });
  fs.writeFileSync(DUPES_MANIFEST, JSON.stringify(list, null, 2), 'utf8');
}

/**
 * Decide whether `filePath` is a duplicate.
 * @returns {Promise<{ isDupe:boolean, hash:string, original?:object }>}
 */
async function check(filePath) {
  const hash = await sha256File(filePath);
  const existing = db.findHash(hash);
  if (existing && fs.existsSync(existing.path) && path.resolve(existing.path) !== path.resolve(filePath)) {
    return { isDupe: true, hash, original: existing };
  }
  return { isDupe: false, hash };
}

/** Record a brand-new file's hash in the index. */
function index(filePath, hash) {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    /* ignore */
  }
  db.insertHash({ hash, path: filePath, size });
}

/**
 * Route a confirmed duplicate into the .dupes store and append a manifest row.
 * Honours dry-run (logs the intended action without moving).
 * @returns {{ destPath, actionId, dryRun, manifestEntry }}
 */
function routeDuplicate({ srcPath, hash, category, original }) {
  const dryRun = db.isDryRun();
  const fileName = path.basename(srcPath);
  const destDir = path.join(DUPES_DIR, category || 'Other');
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = ensureUniquePath(destDir, fileName);

  // Undo log BEFORE the move.
  const actionId = db.recordAction({
    kind: 'dupe',
    category,
    original_name: fileName,
    final_name: path.basename(destPath),
    src_path: srcPath,
    dest_path: destPath,
    hash,
    dry_run: dryRun,
  });

  const manifestEntry = {
    ts: new Date().toISOString(),
    hash,
    category: category || 'Other',
    original_of: original ? original.path : null,
    src_path: srcPath,
    dest_path: destPath,
    dry_run: dryRun,
  };

  if (!dryRun) {
    fs.renameSync(srcPath, destPath);
    writeManifestEntry(manifestEntry);
  }

  return { destPath, actionId, dryRun, manifestEntry };
}

module.exports = { check, index, routeDuplicate, readManifest };
