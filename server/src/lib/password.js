import argon2 from 'argon2';

// Argon2id with the OWASP-recommended minimum cost (19 MiB memory, 2 passes, 1 lane).
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128; // bounds the work an attacker can force per request

export const hashPassword = (password) => argon2.hash(password, ARGON_OPTIONS);

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed hash must never behave like a match
  }
}

// Verifying against this when an email is unknown keeps "no such user" and
// "wrong password" taking about the same time.
let dummyHash;
export async function verifyAgainstDummy(password) {
  dummyHash ??= hashPassword('this-is-never-a-real-password');
  await verifyPassword(await dummyHash, password);
}

// A short list of the most common passwords that still pass a length check.
const COMMON = new Set([
  'password12', 'password123', 'password1234', 'passw0rd123', 'qwertyuiop', 'qwerty12345',
  '1234567890', '12345678910', '0123456789', 'iloveyou123', 'welcome123', 'welcome1234',
  'admin12345', 'administrator', 'letmein1234', 'changeme123', 'abc1234567', 'abcdefghij',
  'asdfghjkl1', 'asdfghjkl123', 'monkey12345', 'dragon12345', 'football123', 'baseball123',
  'superman123', 'princess123', 'sunshine123', 'trustno1234', 'nepal12345', 'nepal123456',
  'kathmandu123', 'namaste123', 'ledger12345', 'ledgernepal', 'ledgernepal1', 'ledgernepal123',
]);

/**
 * Returns a human-readable problem with the password, or null if it is acceptable.
 * Length is the main rule (NIST guidance); no arbitrary "must contain a symbol" rules.
 */
export function passwordProblem(password, { email, fullName } = {}) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something less guessable';
  if (/^(.)\1+$/.test(password)) return 'Password cannot be a single repeated character';
  if (email && (lower === email.toLowerCase() || lower === email.split('@')[0].toLowerCase())) {
    return 'Password cannot be the same as your email';
  }
  if (fullName && fullName.length >= 4 && lower === fullName.toLowerCase()) {
    return 'Password cannot be the same as your name';
  }
  return null;
}
