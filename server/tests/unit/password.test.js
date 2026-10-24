import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from '../../src/lib/password.js';
import { generateToken, hashToken, safeEqual } from '../../src/lib/tokens.js';
import { effectivePermissions } from '../../src/lib/permissions.js';
import { PERMISSION_KEYS, ROLE_PERMISSIONS } from '@ledgernepal/shared/permissions';

describe('password hashing', () => {
  it('uses Argon2id, salts every hash, and verifies correctly', async () => {
    const [a, b] = await Promise.all([hashPassword('a long enough password'), hashPassword('a long enough password')]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b); // different salts
    expect(a).not.toContain('a long enough password');
    expect(await verifyPassword(a, 'a long enough password')).toBe(true);
    expect(await verifyPassword(a, 'a long enough passworD')).toBe(false);
  });

  it('treats a malformed stored hash as a non-match instead of crashing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
    expect(await verifyPassword('', 'whatever')).toBe(false);
  });

  it('the timing-equalising dummy check does not throw', async () => {
    await expect(verifyAgainstDummy('anything')).resolves.toBeUndefined();
  });
});

describe('passwordProblem', () => {
  it('accepts a long passphrase with no special characters', () => {
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });

  it.each([
    ['short', /at least 10/],
    ['x'.repeat(129), /at most 128/],
    ['Password123', /too common/],
    ['qwertyuiop', /too common/],
    ['aaaaaaaaaaaa', /repeated/],
  ])('rejects %j', (password, message) => {
    expect(passwordProblem(password)).toMatch(message);
  });

  it('rejects a password equal to the email or its local part, or to the name', () => {
    expect(passwordProblem('ramesh.shrestha@example.com', { email: 'ramesh.shrestha@example.com' })).toMatch(/email/);
    expect(passwordProblem('ramesh.shrestha', { email: 'ramesh.shrestha@example.com' })).toMatch(/email/);
    expect(passwordProblem('Ramesh Shrestha', { fullName: 'ramesh shrestha' })).toMatch(/name/);
  });
});

describe('tokens', () => {
  it('generates long, unique, URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes deterministically without revealing the token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });

  it('safeEqual compares strings and refuses non-strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});

describe('effectivePermissions', () => {
  const staff = ROLE_PERMISSIONS.staff;

  it('is just the role defaults without overrides', () => {
    expect([...effectivePermissions({ isOwner: false, rolePermissions: staff })].sort()).toEqual([...staff].sort());
  });

  it('adds grants and removes denies', () => {
    const perms = effectivePermissions({
      isOwner: false,
      rolePermissions: staff,
      grants: ['sales.void'],
      denies: ['contacts.update'],
    });
    expect(perms.has('sales.void')).toBe(true);
    expect(perms.has('contacts.update')).toBe(false);
    expect(perms.has('contacts.view')).toBe(true);
  });

  it('a deny beats a grant of the same permission', () => {
    const perms = effectivePermissions({ isOwner: false, rolePermissions: [], grants: ['sales.void'], denies: ['sales.void'] });
    expect(perms.has('sales.void')).toBe(false);
  });

  it('the owner always has every permission, whatever the overrides say', () => {
    const perms = effectivePermissions({ isOwner: true, rolePermissions: [], denies: ['sales.void', 'users.manage'] });
    expect([...perms].sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});
