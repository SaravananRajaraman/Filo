'use strict';

/**
 * Central configuration + path resolution.
 * Loads rules.yaml, expands ~ and {token} placeholders, and exposes
 * the canonical locations of the app-data directory, SQLite DB, and
 * the .dupes/ store. Everything cross-platform via path + os.homedir().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(PROJECT_ROOT, 'rules.yaml');

// App data lives under the project root so a single folder is fully portable.
const APP_DATA_DIR = path.join(PROJECT_ROOT, '.file-organiser');
const DB_PATH = path.join(APP_DATA_DIR, 'organiser.db');
const DUPES_DIR = path.join(APP_DATA_DIR, '.dupes');
const DUPES_MANIFEST = path.join(DUPES_DIR, 'dupes-manifest.json');

/** Expand a leading ~ to the user's home directory. Cross-platform. */
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Replace {year} {month} {day} {category} tokens in a destination template.
 * @param {string} template
 * @param {{date?: Date, category?: string}} ctx
 */
function expandTokens(template, ctx = {}) {
  const d = ctx.date instanceof Date ? ctx.date : new Date();
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return template
    .replace(/\{year\}/g, year)
    .replace(/\{month\}/g, month)
    .replace(/\{day\}/g, day)
    .replace(/\{category\}/g, ctx.category || 'Other');
}

/** Read + parse rules.yaml from disk. Always reads fresh (supports hot-reload). */
function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const parsed = yaml.load(raw) || {};
  const watched = Array.isArray(parsed.watched) ? parsed.watched : [];
  const rules = parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : {};
  return {
    raw,
    watched,
    rules,
    watchedResolved: watched.map(expandHome),
  };
}

/** Serialise + write rules back to YAML. Keeps YAML the source of truth. */
function saveRules({ watched, rules }) {
  const doc = yaml.dump({ watched, rules }, { lineWidth: 120, quotingType: '"' });
  const header =
    '# File Organiser Agent — source of truth for sort rules.\n' +
    '# Paths may use ~ (home dir) and the tokens {year} {month} {day} {category}.\n' +
    '# Edited live by the dashboard rules editor; hot-reloaded without restart.\n\n';
  fs.writeFileSync(RULES_PATH, header + doc, 'utf8');
}

function ensureAppDirs() {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  fs.mkdirSync(DUPES_DIR, { recursive: true });
}

module.exports = {
  PROJECT_ROOT,
  RULES_PATH,
  APP_DATA_DIR,
  DB_PATH,
  DUPES_DIR,
  DUPES_MANIFEST,
  SERVER_PORT: 4242,
  expandHome,
  expandTokens,
  loadRules,
  saveRules,
  ensureAppDirs,
};
