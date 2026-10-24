import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of randomness, URL-safe. Used for session cookies, CSRF, reset and invitation tokens. */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored in the database, so a leaked dump cannot be replayed as a login. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison (avoids leaking how many leading characters matched). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
