'use strict';

/**
 * Intelligent rename: YYYY-MM-DD-keyword-slug.ext
 *
 * Steps:
 *   1. Take the file's birthtime (creation) where available, else mtime.
 *   2. Slugify the original base name into a clean keyword slug.
 *   3. Compose date-slug.ext, lower-cased, dash-separated, deduped dashes.
 *
 * Pure string/stat work - no filesystem mutation here.
 */

const fs = require('fs');
const path = require('path');

/** YYYY-MM-DD in local time. */
function datePrefix(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Slugify a base name: lowercase, strip diacritics, replace non-alphanumerics
 * with dashes, collapse repeats, trim. Empty result -> "file".
 */
function slugify(name) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'file';
}

/** birthtime when the OS supplies it, otherwise mtime. */
function fileDate(filePath) {
  try {
    const st = fs.statSync(filePath);
    // Some filesystems report birthtime as 0/epoch; guard against that.
    const bt = st.birthtime;
    if (bt && bt.getTime() > 0 && bt.getTime() <= Date.now()) return bt;
    return st.mtime;
  } catch {
    return new Date();
  }
}

/**
 * Compose the new file name.
 * @param {string} filePath  source file (existing)
 * @param {object} [opts]  optional { date }
 * @returns {{ newName: string, slug: string, date: Date }}
 */
function buildName(filePath, opts = {}) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const date = opts.date || fileDate(filePath);
  const slug = slugify(base);
  const prefix = datePrefix(date);
  // Avoid doubling the date if the original already starts with it.
  const newBase = slug.startsWith(prefix) ? slug : `${prefix}-${slug}`;
  const newName = `${newBase}${ext.toLowerCase()}`;
  return { newName, slug, date };
}

module.exports = { buildName, slugify, datePrefix, fileDate };
