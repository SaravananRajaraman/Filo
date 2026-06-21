'use strict';

/**
 * Rules editor API. GET returns the parsed rules + raw YAML; PUT validates and
 * writes back to rules.yaml (the source of truth) then triggers a hot-reload
 * of the watcher so new/removed folders take effect without a restart.
 */

const express = require('express');
const config = require('../config');

const router = express.Router();

// Injected by server.js so we can hot-reload without a circular require.
let reloadHook = async () => {};
function setReloadHook(fn) {
  reloadHook = fn;
}

// GET /api/rules — current rules.
router.get('/', (req, res) => {
  try {
    const { watched, rules, raw } = config.loadRules();
    res.json({ watched, rules, raw });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/rules — replace watched[] and rules{}, persist, hot-reload.
router.put('/', express.json(), async (req, res) => {
  const { watched, rules } = req.body || {};
  if (!Array.isArray(watched) || typeof rules !== 'object' || rules === null) {
    return res.status(400).json({ ok: false, error: 'Expected { watched: [], rules: {} }' });
  }
  // Basic validation: every value must be a non-empty string.
  for (const [k, v] of Object.entries(rules)) {
    if (typeof v !== 'string' || !v.trim()) {
      return res.status(400).json({ ok: false, error: `Rule "${k}" must map to a non-empty path` });
    }
  }
  try {
    config.saveRules({ watched, rules });
    await reloadHook();
    res.json({ ok: true, watched, rules });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.setReloadHook = setReloadHook;
