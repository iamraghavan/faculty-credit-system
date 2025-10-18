// utils/compression.js
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const ungzip = promisify(zlib.gunzip);

async function compressMessages(messagesArray) {
  const json = JSON.stringify(messagesArray);
  const buf = Buffer.from(json, 'utf8');
  return gzip(buf);
}

async function decompressSegment(buffer) {
  const decompressed = await ungzip(buffer);
  const json = decompressed.toString('utf8');
  return JSON.parse(json);
}

module.exports = {
  compressMessages,
  decompressSegment,
};
