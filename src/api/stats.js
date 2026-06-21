'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/stats — summary cards + per-category breakdown + dry-run state.
router.get('/', (req, res) => {
  const s = db.stats();
  res.json({ ...s, dryRun: db.isDryRun() });
});

module.exports = router;
