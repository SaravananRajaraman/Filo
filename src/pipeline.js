'use strict';

/**
 * The processing pipeline for a single file. This is the heart of the agent
 * and is shared by the watcher and any manual trigger.
 *
 * Order of operations (Phase 1 + Phase 2 combined):
 *   1. Classify          -> { category, confidence }
 *   2. Hash + dupe check  -> duplicate? route to .dupes/ and stop.
 *   3. Rename             -> date-prefix + slug.
 *   4. Resolve dest       -> rule lookup + conflict guard.
 *   5. Record undo log    -> INSERT into actions BEFORE the move.
 *   6. Move               -> unless dry-run, then index the new hash.
 *
 * Returns a result object describing what happened (used for notifications,
 * the SSE feed, and logging).
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const { classify } = require('./classifier');
const { buildName } = require('./renamer');
const { resolveDestination, safeMove } = require('./sorter');
const dupes = require('./dupe-detector');

/**
 * @param {string} srcPath absolute path to a settled file
 * @param {object} [opts] { onResult } optional callback for feed/notify
 * @returns {Promise<object|null>} result, or null if skipped (e.g. vanished)
 */
async function processFile(srcPath, opts = {}) {
  if (!fs.existsSync(srcPath)) return null;
  let st;
  try {
    st = fs.statSync(srcPath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size === 0) return null;

  const dryRun = db.isDryRun();
  const rules = config.loadRules().rules;
  const originalName = path.basename(srcPath);

  // 1. Classify.
  const { category, confidence, basis } = await classify(srcPath);

  // 2. Duplicate detection.
  const { isDupe, hash, original } = await dupes.check(srcPath);
  if (isDupe) {
    const routed = dupes.routeDuplicate({ srcPath, hash, category, original });
    const result = {
      kind: 'dupe',
      ts: new Date().toISOString(),
      category,
      confidence,
      basis,
      original_name: originalName,
      final_name: path.basename(routed.destPath),
      src_path: srcPath,
      dest_path: routed.destPath,
      hash,
      dry_run: routed.dryRun,
      actionId: routed.actionId,
      duplicate_of: original ? original.path : null,
    };
    if (opts.onResult) opts.onResult(result);
    return result;
  }

  // 3. Rename.
  const { newName } = buildName(srcPath);

  // 4. Resolve destination (conflict guard inside).
  const { destPath } = resolveDestination(rules, category, srcPath, {
    date: new Date(),
    fileName: newName,
  });

  // 5. Undo log BEFORE move (invariant).
  const actionId = db.recordAction({
    kind: 'move',
    category,
    original_name: originalName,
    final_name: path.basename(destPath),
    src_path: srcPath,
    dest_path: destPath,
    hash,
    dry_run: dryRun,
  });

  // 6. Move (unless dry-run) + index hash.
  if (!dryRun) {
    safeMove(srcPath, destPath);
    dupes.index(destPath, hash);
  } else {
    // In dry-run we still index by source so repeated previews are stable.
    dupes.index(srcPath, hash);
  }

  const result = {
    kind: 'move',
    ts: new Date().toISOString(),
    category,
    confidence,
    basis,
    original_name: originalName,
    final_name: path.basename(destPath),
    src_path: srcPath,
    dest_path: destPath,
    hash,
    dry_run: dryRun,
    actionId,
  };
  if (opts.onResult) opts.onResult(result);
  return result;
}

module.exports = { processFile };
