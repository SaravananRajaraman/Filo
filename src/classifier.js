'use strict';

/**
 * File classifier.
 *
 * Strategy (most trustworthy first):
 *   1. Magic-byte sniff via `file-type` (real content, not just extension).
 *   2. Extension lookup in a curated map.
 *   3. Fallback to "Other".
 *
 * Returns { category, confidence } for every file. Confidence is a rough
 * 0..1 signal: content sniff => high, extension => medium, fallback => low.
 */

const fs = require('fs');
const path = require('path');

const EXT_MAP = {
  // Images
  jpg: 'Images', jpeg: 'Images', png: 'Images', gif: 'Images', webp: 'Images',
  bmp: 'Images', tiff: 'Images', tif: 'Images', svg: 'Images', heic: 'Images',
  heif: 'Images', ico: 'Images', raw: 'Images', cr2: 'Images', nef: 'Images',
  // Documents
  pdf: 'Documents', doc: 'Documents', docx: 'Documents', odt: 'Documents',
  rtf: 'Documents', txt: 'Documents', md: 'Documents', xls: 'Documents',
  xlsx: 'Documents', csv: 'Documents', ppt: 'Documents', pptx: 'Documents',
  pages: 'Documents', key: 'Documents', numbers: 'Documents', epub: 'Documents',
  // Video
  mp4: 'Video', mkv: 'Video', mov: 'Video', avi: 'Video', wmv: 'Video',
  flv: 'Video', webm: 'Video', m4v: 'Video', mpg: 'Video', mpeg: 'Video',
  // Audio
  mp3: 'Audio', wav: 'Audio', flac: 'Audio', aac: 'Audio', ogg: 'Audio',
  m4a: 'Audio', wma: 'Audio', aiff: 'Audio', opus: 'Audio',
  // Archives
  zip: 'Archives', rar: 'Archives', '7z': 'Archives', tar: 'Archives',
  gz: 'Archives', bz2: 'Archives', xz: 'Archives', tgz: 'Archives',
  // Code
  js: 'Code', mjs: 'Code', cjs: 'Code', ts: 'Code', tsx: 'Code', jsx: 'Code',
  py: 'Code', rb: 'Code', go: 'Code', rs: 'Code', java: 'Code', c: 'Code',
  h: 'Code', cpp: 'Code', cc: 'Code', cs: 'Code', php: 'Code', swift: 'Code',
  kt: 'Code', sh: 'Code', bash: 'Code', zsh: 'Code', sql: 'Code', json: 'Code',
  yaml: 'Code', yml: 'Code', toml: 'Code', html: 'Code', css: 'Code', vue: 'Code',
};

// Map file-type MIME prefixes / specifics to our categories.
const MIME_MAP = [
  [/^image\//, 'Images'],
  [/^video\//, 'Video'],
  [/^audio\//, 'Audio'],
  [/^application\/(zip|x-7z-compressed|x-rar-compressed|x-tar|gzip|x-bzip2)/, 'Archives'],
  [/^application\/pdf/, 'Documents'],
  [/^application\/(msword|vnd\.openxmlformats|vnd\.ms-)/, 'Documents'],
  [/^application\/epub/, 'Documents'],
  [/^text\//, 'Documents'],
];

function fromExtension(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext && EXT_MAP[ext]) {
    return { category: EXT_MAP[ext], confidence: 0.7, basis: `ext:.${ext}` };
  }
  return null;
}

function fromMime(mime) {
  for (const [re, category] of MIME_MAP) {
    if (re.test(mime)) return { category, confidence: 0.95, basis: `mime:${mime}` };
  }
  return null;
}

/**
 * Classify a file. Async because content sniffing reads bytes from disk.
 * @param {string} filePath absolute path to an existing file
 * @returns {Promise<{category:string, confidence:number, basis:string}>}
 */
async function classify(filePath) {
  // 1. Content sniff (lazy-load file-type; it is ESM in v16 via CJS entry).
  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile() && stat.size > 0) {
      // file-type@16 is CommonJS-friendly.
      const FileType = require('file-type');
      const res = await FileType.fromFile(filePath);
      if (res && res.mime) {
        const m = fromMime(res.mime);
        if (m) return m;
        // Recognised container but uncategorised mime -> still better than ext.
      }
    }
  } catch {
    /* fall through to extension-based classification */
  }

  // 2. Extension.
  const byExt = fromExtension(filePath);
  if (byExt) return byExt;

  // 3. Fallback.
  return { category: 'Other', confidence: 0.2, basis: 'fallback' };
}

/** Synchronous extension-only classification (used in tests / fast paths). */
function classifyByExtension(filePath) {
  return fromExtension(filePath) || { category: 'Other', confidence: 0.2, basis: 'fallback' };
}

module.exports = { classify, classifyByExtension, EXT_MAP };
