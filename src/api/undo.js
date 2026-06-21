'use strict';

const express = require('express');
const undo = require('../undo');
const notifier = require('../notifier');

const router = express.Router();

// POST /api/undo/last — reverse the most recent real move.
router.post('/last', (req, res) => {
  const result = undo.undoLast();
  if (result.ok) notifier.moveUndone(result);
  res.status(result.ok ? 200 : 409).json(result);
});

// POST /api/undo/:id — reverse a specific action by id.
router.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });
  const result = undo.undoAction(id);
  if (result.ok) notifier.moveUndone(result);
  res.status(result.ok ? 200 : 409).json(result);
});

module.exports = router;
