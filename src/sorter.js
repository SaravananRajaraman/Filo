'use strict';

/**
 * Rule lookup + destination resolution + the conflict guard.
 *
 * Given a category and source file, resolves the destination directory from
 * rules.yaml (with ~ and {token} expansion) and produces a collision-free
 * absolute destination path. Never deletes; appends _2, _3, ... on clash.
 */

const fs = require('fs');
const path = require('path');
const { expandHome, expandTokens } = require('./config');

/**
 * Resolve the destination directory for a category from a rules object.
 * Falls back to the "Other" rule when the category is unmapped.
 */
function resolveDestDir(rules, category, ctx = {}) {
  const template = rules[category] || rules.Other || '~/Downloads/.unsorted';
  return path.normalize(expandTokens(expandHome(template), { ...ctx, category }));
}

/**
 * Produce a collision-free absolute path inside destDir for `fileName`.
 * If "report.pdf" exists, returns ".../report_2.pdf", then _3, etc.
 */
function ensureUniquePath(destDir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(destDir, fileName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${base}_${n}${ext}`);
    n += 1;
  }
  return candidate;
}

/**
 * Full resolution for a move.
 * @returns {{ destDir, destPath, fileName }}
 */
function resolveDestination(rules, category, srcPath, { date, fileName } = {}) {
  const name = fileName || path.basename(srcPath);
  const destDir = resolveDestDir(rules, category, { date });
  const destPath = ensureUniquePath(destDir, name);
  return { destDir, destPath, fileName: path.basename(destPath) };
}

/**
 * Move a file, falling back to copy+unlink when rename crosses devices (EXDEV).
 * Creates the destination directory if needed. Never overwrites.
 */
function safeMove(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    } else {
      throw err;
    }
  }
  return destPath;
}

module.exports = { resolveDestDir, ensureUniquePath, resolveDestination, safeMove };
