'use strict';

/**
 * Native OS toast wrapper around node-notifier. Degrades gracefully: if the
 * platform notifier is unavailable the message is logged instead of throwing.
 */

let notifier = null;
try {
  // eslint-disable-next-line global-require
  notifier = require('node-notifier');
} catch {
  notifier = null;
}

const APP_NAME = 'File Organiser';

function notify({ title = APP_NAME, message = '', sound = false } = {}) {
  if (!notifier) {
    console.log(`(notify) ${title}: ${message}`);
    return;
  }
  try {
    notifier.notify({
      title,
      message,
      sound,
      appName: APP_NAME,
      wait: false,
    });
  } catch (e) {
    console.log(`(notify failed: ${e.message}) ${title}: ${message}`);
  }
}

/* Convenience event helpers used across the app. */

function fileMoved(result) {
  const verb = result.dry_run ? 'Would move' : 'Moved';
  notify({
    title: `${verb} → ${result.category}`,
    message: `${result.original_name}  →  ${result.final_name}`,
  });
}

function duplicateFound(result) {
  notify({
    title: 'Duplicate quarantined',
    message: `${result.original_name} routed to .dupes/${result.category}`,
  });
}

function moveUndone(result) {
  notify({
    title: 'Move undone',
    message: result && result.action ? `Restored ${path_basename(result.restoredTo)}` : 'Reversed last move',
  });
}

function path_basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

module.exports = { notify, fileMoved, duplicateFound, moveUndone };
