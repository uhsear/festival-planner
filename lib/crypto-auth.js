'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const SCRYPT_KEYLEN = 64;
const scryptAsync = (password, salt) => promisify(crypto.scrypt)(password, salt, SCRYPT_KEYLEN);
const hashSessionToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const DUMMY_PASSWORD_SALT = 'festie-dummy-salt';
const DUMMY_PASSWORD_HASH = `${DUMMY_PASSWORD_SALT}:${crypto.scryptSync('festie-dummy-password', DUMMY_PASSWORD_SALT, SCRYPT_KEYLEN).toString('hex')}`;

// Optional logger — call setLogger(log) to enable debug output
let _log = null;
function setLogger(logger) { _log = logger; }

function timingSafeEqualString(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash || !/^[a-f0-9]+$/i.test(hash)) {
      if (_log) _log.debug('verifyPassword: invalid stored hash format, using dummy path');
      await scryptAsync(password, DUMMY_PASSWORD_SALT);
      return false;
    }
    const candidate = (await scryptAsync(password, salt)).toString('hex');
    const match = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
    if (_log) _log.debug('verifyPassword: comparison complete', { match });
    return match;
  } catch (err) {
    if (_log) _log.warn('verifyPassword: unexpected error', { error: err.message });
    return false;
  }
}

module.exports = {
  SCRYPT_KEYLEN,
  hashSessionToken,
  DUMMY_PASSWORD_SALT,
  DUMMY_PASSWORD_HASH,
  timingSafeEqualString,
  hashPassword,
  verifyPassword,
  setLogger,
};
