'use strict';

/**
 * Live activity feed.
 *   GET /api/feed/recent  — last N actions from SQLite (initial paint).
 *   GET /api/feed/stream  — Server-Sent Events; pushes each new move/dupe.
 *
 * server.js calls `publish(result)` (wired to watcher.onResult) for every
 * processed file; this module fans it out to all connected SSE clients.
 */

const express = require('express');
const db = require('../db');

const router = express.Router();
const clients = new Set();

/** Broadcast a pipeline result to every connected SSE client. */
function publish(result) {
  const payload = `data: ${JSON.stringify(result)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// GET /api/feed/recent
router.get('/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.recentActions(limit));
});

// GET /api/feed/stream  (SSE)
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders && res.flushHeaders();
  res.write(': connected\n\n');

  clients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

module.exports = router;
module.exports.publish = publish;
