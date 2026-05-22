import crypto from 'crypto';
import { promisify } from 'util';

export const SCRYPT_KEYLEN = 64;
const scryptAsync = (password: any, salt: any) => promisify(crypto.scrypt)(password, salt, SCRYPT_KEYLEN);
export const hashSessionToken = (token: any) => crypto.createHash('sha256').update(String(token)).digest('hex');
export const DUMMY_PASSWORD_SALT = 'festie-dummy-salt';
export const DUMMY_PASSWORD_HASH = `${DUMMY_PASSWORD_SALT}:${crypto.scryptSync('festie-dummy-password', DUMMY_PASSWORD_SALT, SCRYPT_KEYLEN).toString('hex')}`;

// Optional logger — call setLogger(log) to enable debug output
let _log: any = null;
export function setLogger(logger: any) { _log = logger; }

export function timingSafeEqualString(left: any, right: any) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export async function hashPassword(password: any) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = ((await scryptAsync(password, salt)) as Buffer).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: any, stored: any) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash || !/^[a-f0-9]+$/i.test(hash)) {
      if (_log) _log.debug('verifyPassword: invalid stored hash format, using dummy path');
      await scryptAsync(password, DUMMY_PASSWORD_SALT);
      return false;
    }
    const candidate = ((await scryptAsync(password, salt)) as Buffer).toString('hex');
    const match = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
    if (_log) _log.debug('verifyPassword: comparison complete', { match });
    return match;
  } catch (err: any) {
    if (_log) _log.warn('verifyPassword: unexpected error', { error: err.message });
    return false;
  }
}
