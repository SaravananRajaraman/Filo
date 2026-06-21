'use strict';

/**
 * Entry point. Parses CLI flags, applies dry-run/confirm settings, installs or
 * removes auto-start when asked, then boots the three long-running pieces:
 *   1. the chokidar watcher (file pipeline)
 *   2. the system tray (control surface)
 *   3. the Express dashboard (localhost:4242)
 *
 * Flags:
 *   --dry-run            force dry-run on (no files move)
 *   --confirm            flip dry_run=0 in SQLite (enable real moves)
 *   --install-autostart  register login auto-start, then exit
 *   --remove-autostart   unregister login auto-start, then exit
 *   --no-tray            run headless (no system tray)
 *   --no-server          run without the dashboard
 */

const { exec } = require('child_process');
const db = require('./db');
const config = require('./config');
const watcher = require('./watcher');
const server = require('./server');
const tray = require('./tray');
const notifier = require('./notifier');
const undo = require('./undo');
const autostart = require('./autostart');

const args = new Set(process.argv.slice(2));

/** Open a URL in the default browser, cross-platform. */
function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  db.init();

  // --- one-shot autostart commands ---
  if (args.has('--install-autostart')) {
    const r = autostart.install();
    console.log(`Auto-start installed (${r.platform}): ${r.path}`);
    return process.exit(0);
  }
  if (args.has('--remove-autostart')) {
    const r = autostart.remove();
    console.log(`Auto-start removed (${r.platform}): ${r.path}`);
    return process.exit(0);
  }

  // --- dry-run / confirm flags ---
  if (args.has('--confirm')) {
    db.setDryRun(false);
    console.log('Confirmed: dry_run = 0. Files will now move.');
  }
  if (args.has('--dry-run')) {
    db.setDryRun(true);
    console.log('Forced dry-run: dry_run = 1. No files will move.');
  }

  const dashboardUrl = `http://localhost:${server.PORT}`;

  // --- dashboard ---
  let publish = () => {};
  if (!args.has('--no-server')) {
    const s = await server.start({ onReload: () => watcher.reload() });
    publish = s.publish;
  }

  // --- watcher: pipe every result to SSE, notifications, and tray badge ---
  watcher.onResult((result) => {
    publish(result);
    if (result.kind === 'dupe') notifier.duplicateFound(result);
    else notifier.fileMoved(result);
    tray.refresh();
  });

  // --- system tray ---
  if (!args.has('--no-tray')) {
    await tray.start({
      onOpenDashboard: () => openBrowser(dashboardUrl),
      onUndo: () => {
        const r = undo.undoLast();
        if (r.ok) {
          notifier.moveUndone(r);
          tray.refresh();
        } else {
          notifier.notify({ title: 'Nothing to undo', message: 'No recent move found.' });
        }
      },
      onToggleDry: () => {
        db.setDryRun(!db.isDryRun());
        notifier.notify({
          title: 'Mode changed',
          message: db.isDryRun() ? 'Dry-run: files will NOT move' : 'Live: files WILL move',
        });
      },
      onQuit: () => shutdown(0),
    });
  }

  // --- watcher last (prints dry-run preview on first boot) ---
  await watcher.start();

  notifier.notify({
    title: 'File Organiser running',
    message: db.isDryRun() ? 'Dry-run mode — preview only' : 'Live — sorting new files',
  });

  console.log('\nAgent is running. Press Ctrl+C to stop.');
}

async function shutdown(code = 0) {
  console.log('\nShutting down…');
  try { tray.kill(); } catch { /* ignore */ }
  try { await watcher.stop(); } catch { /* ignore */ }
  try { server.stop(); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => {
  console.error('Uncaught:', e);
});

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
