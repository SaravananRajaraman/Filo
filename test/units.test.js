'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { slugify, datePrefix, buildName } = require('../src/renamer');
const { ensureUniquePath, resolveDestDir } = require('../src/sorter');
const { classifyByExtension } = require('../src/classifier');
const { expandTokens, expandHome } = require('../src/config');
const { sha256File } = require('../src/hasher');

test('slugify: cleans spaces, case, diacritics, symbols', () => {
  assert.equal(slugify('My Vacation Photo!!.JPG'.replace(/\.JPG$/, '')), 'my-vacation-photo');
  assert.equal(slugify('Café Réport (final)'), 'cafe-report-final');
  assert.equal(slugify('___'), 'file');
  assert.equal(slugify('already-slugged'), 'already-slugged');
});

test('datePrefix: formats YYYY-MM-DD', () => {
  assert.equal(datePrefix(new Date('2024-03-07T10:00:00')), '2024-03-07');
});

test('buildName: date-prefix + slug + lowercased ext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foa-'));
  const f = path.join(dir, 'Quarterly Report.PDF');
  fs.writeFileSync(f, 'x');
  const { newName } = buildName(f, { date: new Date('2024-03-07T10:00:00') });
  assert.match(newName, /^2024-03-07-quarterly-report\.pdf$/);
});

test('classifyByExtension: maps known extensions', () => {
  assert.equal(classifyByExtension('a.png').category, 'Images');
  assert.equal(classifyByExtension('a.pdf').category, 'Documents');
  assert.equal(classifyByExtension('a.mp4').category, 'Video');
  assert.equal(classifyByExtension('a.mp3').category, 'Audio');
  assert.equal(classifyByExtension('a.zip').category, 'Archives');
  assert.equal(classifyByExtension('a.js').category, 'Code');
  assert.equal(classifyByExtension('a.unknownext').category, 'Other');
});

test('ensureUniquePath: conflict guard appends _2, _3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foa-'));
  assert.equal(path.basename(ensureUniquePath(dir, 'report.pdf')), 'report.pdf');
  fs.writeFileSync(path.join(dir, 'report.pdf'), 'x');
  assert.equal(path.basename(ensureUniquePath(dir, 'report.pdf')), 'report_2.pdf');
  fs.writeFileSync(path.join(dir, 'report_2.pdf'), 'x');
  assert.equal(path.basename(ensureUniquePath(dir, 'report.pdf')), 'report_3.pdf');
});

test('expandTokens: year/month/day/category', () => {
  const d = new Date('2024-03-07T10:00:00');
  assert.equal(expandTokens('~/P/{year}/{month}', { date: d }), '~/P/2024/03');
  assert.equal(expandTokens('~/x/{category}', { category: 'Images' }), '~/x/Images');
});

test('expandHome: replaces leading ~', () => {
  assert.equal(expandHome('~/Downloads'), path.join(os.homedir(), 'Downloads'));
  assert.equal(expandHome('/abs/path'), '/abs/path');
});

test('resolveDestDir: falls back to Other for unknown category', () => {
  const rules = { Images: '~/Pics', Other: '~/Misc' };
  assert.equal(resolveDestDir(rules, 'Nope'), expandHome('~/Misc'));
});

test('sha256File: matches crypto digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foa-'));
  const f = path.join(dir, 'a.bin');
  const data = Buffer.from('hello world duplicate test');
  fs.writeFileSync(f, data);
  const expected = crypto.createHash('sha256').update(data).digest('hex');
  assert.equal(await sha256File(f), expected);
});
