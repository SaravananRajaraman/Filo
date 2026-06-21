'use strict';

/**
 * Express app serving the dashboard SPA + JSON API on localhost:4242.
 *
 * Routes
 *   /                     -> public/index.html (SPA)
 *   /api/stats            -> summary cards
 *   /api/feed/recent      -> recent actions
 *   /api/feed/stream      -> SSE live feed
 *   /api/rules  GET/PUT   -> rules editor (hot-reload on save)
 *   /api/undo/:id | /last -> reverse a move
 *   /api/duplicates       -> entries from dupes-manifest.json
 *   /api/settings/dry-run -> read/flip the dry-run flag
 *
 * Bound to 127.0.0.1 only — never exposed beyond the local machine.
 */

const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const dupes = require('./dupe-detector');

const statsRouter = require('./api/stats');
const feedRouter = require('./api/feed');
const rulesRouter = require('./api/rules');
const undoRouter = require('./api/undo');

let server = null;

/**
 * @param {{ onReload?: () => Promise<void> }} hooks
 * @returns {Promise<{ app, server, publish }>}
 */
function start(hooks = {}) {
  const app = express();
  app.use(express.json());

  // Wire rules hot-reload (watcher.reload) into the rules router.
  if (hooks.onReload) rulesRouter.setReloadHook(hooks.onReload);

  app.use('/api/stats', statsRouter);
  app.use('/api/feed', feedRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/undo', undoRouter);

  // Duplicates list straight from the manifest.
  app.get('/api/duplicates', (req, res) => {
    res.json(dupes.readManifest());
  });

  // Dry-run flag read/flip.
  app.get('/api/settings/dry-run', (req, res) => {
    res.json({ dryRun: db.isDryRun() });
  });
  app.post('/api/settings/dry-run', (req, res) => {
    const { dryRun } = req.body || {};
    db.setDryRun(!!dryRun);
    res.json({ dryRun: db.isDryRun() });
  });

  // Static SPA.
  app.use(express.static(path.join(config.PROJECT_ROOT, 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(config.PROJECT_ROOT, 'public', 'index.html'));
  });

  return new Promise((resolve) => {
    server = app.listen(config.SERVER_PORT, '127.0.0.1', () => {
      console.log(`Dashboard:  http://localhost:${config.SERVER_PORT}`);
      resolve({ app, server, publish: feedRouter.publish });
    });
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

/** Expose the SSE publisher so index.js can pipe watcher results to clients. */
function publish(result) {
  feedRouter.publish(result);
}

module.exports = { start, stop, publish, PORT: config.SERVER_PORT };
