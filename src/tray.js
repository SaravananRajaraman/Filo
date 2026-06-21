'use strict';

/**
 * System tray menu (systray2). Cross-platform: uses the .ico on Windows and
 * the .png elsewhere. The first menu item doubles as the "daily move count
 * badge" — its title and the tray tooltip are refreshed to show today's count
 * (a portable stand-in for a numeric overlay badge, which the OS tray APIs do
 * not expose uniformly).
 *
 * Menu:
 *   • Today: N moved        (live count — click opens dashboard)
 *   • Open Dashboard
 *   • Undo last move
 *   • Toggle dry-run        (shows current state)
 *   • Quit
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');
const config = require('./config');

let SysTray = null;
try {
  // systray2 exports the class as default.
  SysTray = require('systray2').default || require('systray2');
} catch {
  SysTray = null;
}

const ICON_PNG = path.join(config.PROJECT_ROOT, 'assets', 'icon.png');
const ICON_ICO = path.join(config.PROJECT_ROOT, 'assets', 'icon.ico');

function iconBase64() {
  const file = process.platform === 'win32' ? ICON_ICO : ICON_PNG;
  try {
    return fs.readFileSync(file).toString('base64');
  } catch {
    return '';
  }
}

function buildMenu() {
  const count = db.todaysMoveCount();
  const dry = db.isDryRun();
  return {
    icon: iconBase64(),
    isTemplateIcon: process.platform === 'darwin',
    title: '',
    tooltip: `File Organiser — ${count} moved today${dry ? ' (dry-run)' : ''}`,
    items: [
      { title: `Today: ${count} moved`, tooltip: 'Files sorted today', enabled: true, __id: 'count' },
      { title: 'Open Dashboard', tooltip: 'localhost:4242', enabled: true, __id: 'dashboard' },
      { title: 'Undo last move', tooltip: 'Reverse the most recent move', enabled: true, __id: 'undo' },
      {
        title: dry ? 'Enable live moves (now dry-run)' : 'Switch to dry-run (now live)',
        tooltip: 'Toggle whether files actually move',
        enabled: true,
        __id: 'toggle',
      },
      SysTray && SysTray.separator ? SysTray.separator : { title: '<SEPARATOR>' },
      { title: 'Quit', tooltip: 'Stop the agent', enabled: true, __id: 'quit' },
    ],
  };
}

let tray = null;
let handlers = {};

/**
 * Start the tray.
 * @param {{onOpenDashboard, onUndo, onToggleDry, onQuit}} cbs
 */
async function start(cbs = {}) {
  handlers = cbs;
  if (!SysTray) {
    console.warn('systray2 not available — tray disabled (agent still runs headless).');
    return null;
  }
  const menu = buildMenu();
  tray = new SysTray({ menu, debug: false, copyDir: true });

  tray.onClick((action) => {
    const id = action.item && action.item.__id;
    if (id === 'dashboard' || id === 'count') handlers.onOpenDashboard && handlers.onOpenDashboard();
    else if (id === 'undo') handlers.onUndo && handlers.onUndo();
    else if (id === 'toggle') {
      handlers.onToggleDry && handlers.onToggleDry();
      refresh();
    } else if (id === 'quit') {
      handlers.onQuit && handlers.onQuit();
    }
  });

  try {
    await tray.ready();
  } catch (e) {
    console.warn('tray failed to start:', e.message);
    tray = null;
  }
  return tray;
}

/** Refresh the badge/count + dry-run label. Call after each move or toggle. */
function refresh() {
  if (!tray) return;
  const count = db.todaysMoveCount();
  const dry = db.isDryRun();
  try {
    tray.sendAction({
      type: 'update-item',
      item: { title: `Today: ${count} moved`, __id: 'count', enabled: true },
      seq_id: 0,
    });
    tray.sendAction({
      type: 'update-item',
      item: {
        title: dry ? 'Enable live moves (now dry-run)' : 'Switch to dry-run (now live)',
        __id: 'toggle',
        enabled: true,
      },
      seq_id: 3,
    });
  } catch {
    /* tray may not support live update on every platform; non-fatal */
  }
}

function kill() {
  if (tray) {
    try {
      tray.kill(false);
    } catch {
      /* ignore */
    }
    tray = null;
  }
}

module.exports = { start, refresh, kill };
