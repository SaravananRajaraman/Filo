'use strict';

/**
 * Streaming SHA-256 hashing. Streams the file so large media never loads
 * fully into memory.
 */

const fs = require('fs');
const crypto = require('crypto');

/**
 * @param {string} filePath
 * @returns {Promise<string>} lowercase hex SHA-256 digest
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { sha256File };
