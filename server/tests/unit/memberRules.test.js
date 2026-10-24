import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, ROLES, ROLE_PERMISSIONS } from '@ledgernepal/shared/permissions';
import { assignableRoleProblem, manageTargetProblem, overrideProblem } from '../../src/lib/memberRules.js';

const role = (key) => ({ key, rank: ROLES[key].rank });
const actorOf = (roleKey, { membershipId = 'me', extra = [] } = {}) => ({
  membershipId,
  roleRank: ROLES[roleKey].rank,
  isOwner: roleKey === 'owner',
  permissions: new Set([...ROLE_PERMISSIONS[roleKey], ...extra]),
});
const target = (roleKey, membershipId = 'them') => ({ membershipId, roleRank: ROLES[roleKey].rank, isOwner: roleKey === 'owner' });
const empty = { grants: new Set(), denies: new Set() };

describe('assignableRoleProblem', () => {
  it.each([
    ['owner', 'business_admin', null],
    ['owner', 'viewer', null],
    ['business_admin', 'accountant', null],
    ['business_admin', 'staff', null],
    ['business_admin', 'viewer', null],
    ['business_admin', 'business_admin', /below your own/], // equal rank
    ['accountant', 'accountant', /below your own/],
    ['accountant', 'business_admin', /below your own/],
    ['staff', 'viewer', null], // only matters if staff were ever granted users.invite
    ['viewer', 'viewer', /below your own/],
  ])('%s assigning %s', (actor, assigned, expected) => {
    const result = assignableRoleProblem(actorOf(actor), role(assigned));
    expected === null ? expect(result).toBeNull() : expect(result).toMatch(expected);
  });

  it('nobody, not even the owner, can create a second owner this way', () => {
    expect(assignableRoleProblem(actorOf('owner'), role('owner'))).toMatch(/transfer/i);
  });
});

describe('manageTargetProblem', () => {
  it('lets the owner manage everyone below', () => {
    for (const r of ['business_admin', 'accountant', 'staff', 'viewer']) {
      expect(manageTargetProblem(actorOf('owner'), target(r))).toBeNull();
    }
  });

  it('lets an admin manage only accountant, staff and viewer', () => {
    const admin = actorOf('business_admin');
    for (const r of ['accountant', 'staff', 'viewer']) expect(manageTargetProblem(admin, target(r))).toBeNull();
    expect(manageTargetProblem(admin, target('business_admin'))).toMatch(/ranked below you/);
    expect(manageTargetProblem(admin, target('owner'))).toMatch(/owner/i);
  });

  it('never allows changing yourself, even for the owner', () => {
    expect(manageTargetProblem(actorOf('owner'), target('owner', 'me'))).toMatch(/your own/);
    expect(manageTargetProblem(actorOf('business_admin'), target('staff', 'me'))).toMatch(/your own/);
  });

  it('never allows changing the owner', () => {
    expect(manageTargetProblem(actorOf('business_admin'), target('owner'))).not.toBeNull();
  });

  it('a lower role holding users.manage by override still cannot manage equals or superiors', () => {
    const accountant = actorOf('accountant', { extra: ['users.manage'] });
    expect(manageTargetProblem(accountant, target('accountant'))).not.toBeNull();
    expect(manageTargetProblem(accountant, target('business_admin'))).not.toBeNull();
    expect(manageTargetProblem(accountant, target('staff'))).toBeNull();
  });
});

describe('overrideProblem', () => {
  const staffDefaults = new Set(ROLE_PERMISSIONS.staff);
  const run = (actor, after, before = empty, roleDefaults = staffDefaults) => overrideProblem(actor, { roleDefaults, before, after });

  it('the owner may grant anything, including users.manage', () => {
    expect(run(actorOf('owner'), { grants: new Set(['sales.void', 'users.manage']), denies: new Set() })).toBeNull();
  });

  it('an admin may grant what they hold', () => {
    expect(run(actorOf('business_admin'), { grants: new Set(['reports.view']), denies: new Set() })).toBeNull();
  });

  it('an admin may not grant what they lack', () => {
    for (const p of ['sales.void', 'ledger.correct', 'payments.void']) {
      expect(run(actorOf('business_admin'), { grants: new Set([p]), denies: new Set() }), p).toMatch(/do not have it/);
    }
  });

  it('only the owner may grant users.manage, even to someone who could otherwise receive it', () => {
    const adminWithIt = actorOf('business_admin'); // holds users.manage by default
    expect(run(adminWithIt, { grants: new Set(['users.manage']), denies: new Set() })).toMatch(/Only the owner/);
  });

  it('granting something the role already gives is harmless', () => {
    expect(run(actorOf('business_admin'), { grants: new Set(['contacts.view']), denies: new Set() })).toBeNull();
  });

  it('denying is always allowed: it can only remove access', () => {
    expect(run(actorOf('business_admin'), { grants: new Set(), denies: new Set(['sales.view', 'payments.void']) })).toBeNull();
  });

  it('re-saving an existing grant the admin does not hold is not a new grant', () => {
    const before = { grants: new Set(['sales.void']), denies: new Set() };
    expect(run(actorOf('business_admin'), before, before)).toBeNull();
  });

  it('lifting a deny that held back a role default counts as granting it', () => {
    const accountantDefaults = new Set(ROLE_PERMISSIONS.accountant);
    const before = { grants: new Set(), denies: new Set(['sales.void']) };
    expect(run(actorOf('business_admin'), empty, before, accountantDefaults)).toMatch(/do not have it/);
    expect(run(actorOf('owner'), empty, before, accountantDefaults)).toBeNull();
  });

  it('lifting a deny on something the role never had is harmless', () => {
    const before = { grants: new Set(), denies: new Set(['ledger.correct']) }; // staff never had it
    expect(run(actorOf('business_admin'), empty, before)).toBeNull();
  });

  it('knows every permission name it might be asked about', () => {
    for (const p of PERMISSION_KEYS) expect(typeof p).toBe('string');
  });
});
