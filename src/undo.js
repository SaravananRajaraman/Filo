'use strict';

/**
 * Undo mechanism. Reads an action row from the SQLite log and reverses the
 * move: the file is returned from dest_path back to src_path, then the row is
 * marked undone=1. Works for both 'move' and 'dupe' actions.
 *
 * Safe by construction:
 *   - Refuses to undo a dry-run action (nothing was moved).
 *   - Refuses to undo twice (undone flag).
 *   - Restores into the original directory, recreating it if needed.
 *   - Conflict guard on the restore target too (never overwrites).
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { ensureUniquePath, safeMove } = require('./sorter');

/**
 * Undo a specific action by id.
 * @returns {{ ok:boolean, reason?:string, action?:object, restoredTo?:string }}
 */
function undoAction(id) {
  const action = db.getAction(id);
  if (!action) return { ok: false, reason: 'not_found' };
  if (action.undone) return { ok: false, reason: 'already_undone', action };
  if (action.dry_run) return { ok: false, reason: 'dry_run_noop', action };

  const from = action.dest_path;
  if (!fs.existsSync(from)) {
    // File already gone; mark undone so it leaves the undoable set.
    db.markUndone(id);
    return { ok: false, reason: 'dest_missing', action };
  }

  const targetDir = path.dirname(action.src_path);
  const targetName = path.basename(action.src_path);
  const restoreTo = ensureUniquePath(targetDir, targetName);

  safeMove(from, restoreTo);

  // Keep the hash index pointing at the file's current location.
  if (action.hash) {
    try {
      db.updateHashPath(action.hash, restoreTo);
    } catch {
      /* non-fatal */
    }
  }

  db.markUndone(id);
  return { ok: true, action, restoredTo: restoreTo };
}

/** Undo the most recent real, not-yet-undone move. */
function undoLast() {
  const last = db.getLastUndoable();
  if (!last) return { ok: false, reason: 'nothing_to_undo' };
  return undoAction(last.id);
}

module.exports = { undoAction, undoLast };
