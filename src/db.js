'use strict';

/**
 * SQLite layer (better-sqlite3, synchronous).
 *
 * Tables
 *   settings     key/value store; holds dry_run flag.
 *   actions      one row per move, written BEFORE fs.rename (undo log).
 *   file_hashes  SHA-256 index for duplicate detection.
 *
 * Invariant: an `actions` row is INSERTed before any file is moved, so an
 * interrupted move can always be reconstructed and undone.
 */

const Database = require('better-sqlite3');
const { DB_PATH, ensureAppDirs } = require('./config');

let db;

function init() {
  ensureAppDirs();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT    NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'move',  -- move | dupe | skip
      category    TEXT,
      original_name TEXT,
      final_name    TEXT,
      src_path    TEXT    NOT NULL,
      dest_path   TEXT    NOT NULL,
      hash        TEXT,
      dry_run     INTEGER NOT NULL DEFAULT 0,
      undone      INTEGER NOT NULL DEFAULT 0,
      undone_ts   TEXT
    );

    CREATE TABLE IF NOT EXISTS file_hashes (
      hash       TEXT PRIMARY KEY,
      path       TEXT NOT NULL,
      size       INTEGER,
      first_seen TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_actions_ts     ON actions(ts);
    CREATE INDEX IF NOT EXISTS idx_actions_undone ON actions(undone);
  `);

  // Default settings (only inserted once).
  const setDefault = db.prepare(
    'INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)'
  );
  setDefault.run('dry_run', '1'); // first boot is always dry-run
  return db;
}

function get() {
  if (!db) init();
  return db;
}

/* ---------- settings ---------- */

function getSetting(key, fallback = null) {
  const row = get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  get()
    .prepare(
      `INSERT INTO settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function isDryRun() {
  return getSetting('dry_run', '1') === '1';
}

function setDryRun(on) {
  setSetting('dry_run', on ? '1' : '0');
}

/* ---------- actions (undo log) ---------- */

/** Insert the undo-log row. MUST be called before fs.rename. Returns row id. */
function recordAction(a) {
  const info = get()
    .prepare(
      `INSERT INTO actions
        (ts, kind, category, original_name, final_name, src_path, dest_path, hash, dry_run, undone)
       VALUES
        (@ts, @kind, @category, @original_name, @final_name, @src_path, @dest_path, @hash, @dry_run, 0)`
    )
    .run({
      ts: new Date().toISOString(),
      kind: a.kind || 'move',
      category: a.category || null,
      original_name: a.original_name || null,
      final_name: a.final_name || null,
      src_path: a.src_path,
      dest_path: a.dest_path,
      hash: a.hash || null,
      dry_run: a.dry_run ? 1 : 0,
    });
  return info.lastInsertRowid;
}

function markUndone(id) {
  get()
    .prepare('UPDATE actions SET undone = 1, undone_ts = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

function getAction(id) {
  return get().prepare('SELECT * FROM actions WHERE id = ?').get(id);
}

/** Most recent real (non-dry-run) move that has not been undone. */
function getLastUndoable() {
  return get()
    .prepare(
      `SELECT * FROM actions
        WHERE kind = 'move' AND dry_run = 0 AND undone = 0
        ORDER BY id DESC LIMIT 1`
    )
    .get();
}

function recentActions(limit = 100) {
  return get()
    .prepare('SELECT * FROM actions ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function todaysMoveCount() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = get()
    .prepare(
      `SELECT COUNT(*) AS n FROM actions
        WHERE kind = 'move' AND dry_run = 0 AND undone = 0 AND ts >= ?`
    )
    .get(start.toISOString());
  return row.n;
}

/* ---------- file_hashes ---------- */

function findHash(hash) {
  return get().prepare('SELECT * FROM file_hashes WHERE hash = ?').get(hash);
}

function insertHash({ hash, path: p, size }) {
  get()
    .prepare(
      `INSERT INTO file_hashes(hash, path, size, first_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO NOTHING`
    )
    .run(hash, p, size, new Date().toISOString());
}

function updateHashPath(hash, p) {
  get().prepare('UPDATE file_hashes SET path = ? WHERE hash = ?').run(p, hash);
}

/* ---------- stats ---------- */

function stats() {
  const d = get();
  const totalMoves = d
    .prepare(`SELECT COUNT(*) n FROM actions WHERE kind='move' AND dry_run=0 AND undone=0`)
    .get().n;
  const totalDupes = d
    .prepare(`SELECT COUNT(*) n FROM actions WHERE kind='dupe'`)
    .get().n;
  const totalUndone = d
    .prepare(`SELECT COUNT(*) n FROM actions WHERE undone=1`)
    .get().n;
  const byCategory = d
    .prepare(
      `SELECT category, COUNT(*) n FROM actions
        WHERE kind='move' AND dry_run=0 AND undone=0
        GROUP BY category ORDER BY n DESC`
    )
    .all();
  return {
    totalMoves,
    totalDupes,
    totalUndone,
    today: todaysMoveCount(),
    byCategory,
  };
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  get,
  getSetting,
  setSetting,
  isDryRun,
  setDryRun,
  recordAction,
  markUndone,
  getAction,
  getLastUndoable,
  recentActions,
  todaysMoveCount,
  findHash,
  insertHash,
  updateHashPath,
  stats,
  close,
};
