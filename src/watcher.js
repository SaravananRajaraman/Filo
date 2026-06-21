'use strict';

/**
 * chokidar watcher. Watches every resolved folder from rules.yaml and routes
 * each settled "add" event through the processing pipeline.
 *
 * Notes:
 *   - awaitWriteFinish makes sure we only act on files that have stopped
 *     growing (no half-downloaded files).
 *   - We ignore dotfiles and the agent's own .file-organiser/ store to avoid
 *     re-processing files we just moved.
 *   - The dry-run preview table is printed here on first boot.
 */

const path = require('path');
const chokidar = require('chokidar');
const db = require('./db');
const config = require('./config');
const { processFile } = require('./pipeline');

let watcher = null;
const listeners = new Set(); // result callbacks (feed / notifier)

function emit(result) {
  for (const fn of listeners) {
    try {
      fn(result);
    } catch (e) {
      console.error('listener error:', e.message);
    }
  }
}

function onResult(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ignored(p) {
  const norm = p.replace(/\\/g, '/');
  return (
    norm.includes('/.file-organiser/') ||
    /(^|\/)\.[^/]+$/.test(path.basename(norm)) // dotfiles
  );
}

async function handleAdd(filePath) {
  try {
    const result = await processFile(filePath, { onResult: emit });
    if (result) {
      const tag = result.dry_run ? '[dry-run] ' : '';
      const verb = result.kind === 'dupe' ? 'DUPE  ' : 'MOVE  ';
      console.log(
        `${tag}${verb}${result.original_name}  ->  ${result.dest_path}` +
          `  (${result.category}, ${(result.confidence * 100).toFixed(0)}%)`
      );
    }
  } catch (e) {
    console.error(`Failed to process ${filePath}:`, e.message);
  }
}

/** Print a one-shot preview of what WOULD move, without moving anything. */
async function printDryRunPreview(folders) {
  console.log('\n  DRY-RUN preview — scanning existing files (nothing will move)\n');
  const rows = [];
  for (const dir of folders) {
    let entries = [];
    try {
      entries = require('fs').readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const full = path.join(dir, ent.name);
      if (ignored(full)) continue;
      try {
        const res = await processFile(full); // dry-run => no move
        if (res) {
          rows.push({
            File: res.original_name,
            Category: res.category,
            Action: res.kind === 'dupe' ? 'duplicate' : 'move',
            Destination: res.dest_path,
          });
        }
      } catch {
        /* skip */
      }
    }
  }
  if (rows.length === 0) {
    console.log('  (no eligible files found)\n');
  } else {
    console.table(rows);
    console.log(
      `\n  ${rows.length} file(s) would be processed. ` +
        `Run with --confirm to enable real moves.\n`
    );
  }
}

/**
 * Start watching. Returns the chokidar instance.
 * @param {{preview?: boolean}} [opts]
 */
async function start(opts = {}) {
  const { watchedResolved } = config.loadRules();
  const folders = watchedResolved.filter((d) => {
    try {
      return require('fs').statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  if (folders.length === 0) {
    console.warn('No watched folders exist yet. Check rules.yaml `watched:` paths.');
  }

  if (db.isDryRun() && opts.preview !== false) {
    await printDryRunPreview(folders);
  }

  watcher = chokidar.watch(folders, {
    ignored: (p) => ignored(p),
    ignoreInitial: true, // initial files handled by the preview / left alone
    persistent: true,
    depth: 0, // top level of each watched folder only
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 200,
    },
  });

  watcher
    .on('add', handleAdd)
    .on('error', (e) => console.error('watcher error:', e.message))
    .on('ready', () => {
      console.log(
        `Watching ${folders.length} folder(s): ${folders.join(', ') || '(none)'}`
      );
      console.log(db.isDryRun() ? 'Mode: DRY-RUN (no files will move)' : 'Mode: LIVE');
    });

  return watcher;
}

async function stop() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

/** Reload watched folders after rules.yaml changes (hot-reload). */
async function reload() {
  await stop();
  return start({ preview: false });
}

module.exports = { start, stop, reload, onResult, emit };
