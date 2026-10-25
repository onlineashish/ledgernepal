import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Settings Co' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const auditFor = async (businessId, action) =>
  (await pool.query('SELECT before, after FROM audit_logs WHERE business_id = $1 AND action = $2 ORDER BY id DESC', [businessId, action])).rows;

describe('GET /api/settings', () => {
  it('starts with sensible defaults and assumes no VAT rate', async () => {
    const fresh = await registerUser(app, { businessName: 'Defaults Co' });
    const res = await fresh.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.business).toMatchObject({ name: 'Defaults Co', legalName: null, address: null, panNumber: null, vatNumber: null });
    expect(res.body.data.settings).toEqual({
      dateDisplay: 'BS',
      isVatRegistered: false,
      defaultVatRate: null,
      defaultCreditDays: null,
      invoiceFooter: null,
      prefixes: { sale: 'SI', purchase: 'PB', receipt: 'RC', payment: 'PM', ledgerEntry: 'LE', openingBalance: 'OB' },
    });
  });

  it('can be read by anyone in the business, including a viewer', async () => {
    const viewer = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer' });
    expect((await viewer.get('/api/settings')).status).toBe(200);
  });
});

describe('PATCH /api/settings', () => {
  it('changes the tax, credit, date and numbering settings, and shows them back', async () => {
    const b = await registerUser(app, { businessName: 'Tax Co' });
    const res = await b.patch('/api/settings', {
      dateDisplay: 'AD',
      isVatRegistered: true,
      defaultVatRate: 13,
      defaultCreditDays: 45,
      prefixes: { sale: 'inv', purchase: 'bill' },
      invoiceFooter: 'Thank you for your business',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toEqual({
      dateDisplay: 'AD',
      isVatRegistered: true,
      defaultVatRate: '13.00',
      defaultCreditDays: 45,
      invoiceFooter: 'Thank you for your business',
      prefixes: { sale: 'INV', purchase: 'BILL', receipt: 'RC', payment: 'PM', ledgerEntry: 'LE', openingBalance: 'OB' }, // upper-cased, others untouched
    });
    expect((await b.get('/api/settings')).body.data.settings.isVatRegistered).toBe(true);
  });

  it('is reflected in the session straight away (the screens read the date preference from there)', async () => {
    const b = await registerUser(app, { businessName: 'Calendar Co' });
    expect((await b.get('/api/auth/me')).body.data.activeBusiness.dateDisplay).toBe('BS');
    await b.patch('/api/settings', { dateDisplay: 'AD' });
    expect((await b.get('/api/auth/me')).body.data.activeBusiness.dateDisplay).toBe('AD');
  });

  it('clears optional settings with null or an empty string', async () => {
    const b = await registerUser(app, { businessName: 'Clearing Co' });
    await b.patch('/api/settings', { defaultVatRate: '13', defaultCreditDays: 30, invoiceFooter: 'x' });
    const res = await b.patch('/api/settings', { defaultVatRate: null, defaultCreditDays: null, invoiceFooter: '' });
    expect(res.body.data.settings).toMatchObject({ defaultVatRate: null, defaultCreditDays: null, invoiceFooter: null });
  });

  it('leaves what is not mentioned alone', async () => {
    const b = await registerUser(app, { businessName: 'Partial Co' });
    await b.patch('/api/settings', { defaultCreditDays: 10, isVatRegistered: true });
    const res = await b.patch('/api/settings', { dateDisplay: 'AD' });
    expect(res.body.data.settings).toMatchObject({ dateDisplay: 'AD', defaultCreditDays: 10, isVatRegistered: true });
  });

  it('records only what changed in the audit log', async () => {
    const b = await registerUser(app, { businessName: 'Audit Settings Co' });
    await b.patch('/api/settings', { defaultCreditDays: 30, dateDisplay: 'BS' }); // BS is already the default
    const [entry] = await auditFor(b.businessId, 'settings.update');
    expect(entry.before).toEqual({ defaultCreditDays: null });
    expect(entry.after).toEqual({ defaultCreditDays: 30 });
    await b.patch('/api/settings', { defaultCreditDays: 30 }); // no change at all
    expect(await auditFor(b.businessId, 'settings.update')).toHaveLength(1);
  });

  it.each([
    ['a VAT rate over 100', { defaultVatRate: '101' }, 'defaultVatRate'],
    ['a VAT rate with three decimals', { defaultVatRate: '13.456' }, 'defaultVatRate'],
    ['a negative VAT rate', { defaultVatRate: '-1' }, 'defaultVatRate'],
    ['a text VAT rate', { defaultVatRate: 'abc' }, 'defaultVatRate'],
    ['negative credit days', { defaultCreditDays: -1 }, 'defaultCreditDays'],
    ['fractional credit days', { defaultCreditDays: 1.5 }, 'defaultCreditDays'],
    ['over a year of credit days', { defaultCreditDays: 366 }, 'defaultCreditDays'],
    ['an unknown calendar', { dateDisplay: 'XX' }, 'dateDisplay'],
    ['VAT registration as text', { isVatRegistered: 'yes' }, 'isVatRegistered'],
    ['a prefix that is too long', { prefixes: { sale: 'TOOLONGPREFIX' } }, 'prefixes.sale'],
    ['a prefix with a symbol', { prefixes: { sale: 'S/I' } }, 'prefixes.sale'],
    ['an empty prefix', { prefixes: { sale: '' } }, 'prefixes.sale'],
    ['an unknown prefix name', { prefixes: { invoice: 'X' } }, 'prefixes'],
    ['a footer that is too long', { invoiceFooter: 'x'.repeat(501) }, 'invoiceFooter'],
  ])('rejects %s', async (_label, body, field) => {
    const res = await owner.patch('/api/settings', body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).join()).toContain(field);
  });

  it('rejects an empty request and fields that are not settings', async () => {
    expect((await owner.patch('/api/settings', {})).status).toBe(400);
    for (const extra of [{ businessId: owner.businessId }, { name: 'Renamed' }, { pricesIncludeVat: true }, { status: 'suspended' }]) {
      expect((await owner.patch('/api/settings', extra)).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('is for people with settings.manage: an administrator may, an accountant may not', async () => {
    const admin = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'business_admin' });
    const accountant = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'accountant' });
    expect((await admin.patch('/api/settings', { defaultCreditDays: 15 })).status).toBe(200);
    expect((await accountant.patch('/api/settings', { defaultCreditDays: 99 })).status).toBe(403);
    expect((await owner.get('/api/settings')).body.data.settings.defaultCreditDays).toBe(15);
  });

  it('changes only the caller’s own business', async () => {
    const a = await registerUser(app, { businessName: 'Isolated A' });
    const b = await registerUser(app, { businessName: 'Isolated B' });
    await a.patch('/api/settings', { isVatRegistered: true, defaultVatRate: '13', prefixes: { sale: 'AAA' } });
    const bSettings = (await b.get('/api/settings')).body.data.settings;
    expect(bSettings).toMatchObject({ isVatRegistered: false, defaultVatRate: null });
    expect(bSettings.prefixes.sale).toBe('SI');
    expect((await a.patch('/api/settings', { businessId: b.businessId, defaultCreditDays: 1 })).status).toBe(400); // cannot name another business
  });
});

describe('PATCH /api/businesses/current (the profile)', () => {
  it('changes name, address, PAN and VAT number', async () => {
    const b = await registerUser(app, { businessName: 'Profile Co' });
    const res = await b.patch('/api/businesses/current', {
      name: 'Profile Traders Pvt. Ltd.', legalName: 'Profile Traders Private Limited', address: 'Thamel, Kathmandu',
      phone: '01-4000000', email: 'Accounts@Profile.Example', panNumber: '123456789', vatNumber: '987654321',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: 'Profile Traders Pvt. Ltd.', legalName: 'Profile Traders Private Limited', address: 'Thamel, Kathmandu',
      phone: '01-4000000', email: 'accounts@profile.example', panNumber: '123456789', vatNumber: '987654321',
    });
    expect((await b.get('/api/settings')).body.data.business.panNumber).toBe('123456789');
    expect((await b.get('/api/auth/me')).body.data.activeBusiness.name).toBe('Profile Traders Pvt. Ltd.');
  });

  it('PAN and VAT number are optional and can be cleared', async () => {
    const b = await registerUser(app, { businessName: 'Optional Co' });
    await b.patch('/api/businesses/current', { panNumber: '111', vatNumber: '222' });
    const res = await b.patch('/api/businesses/current', { panNumber: '', vatNumber: null });
    expect(res.body.data).toMatchObject({ panNumber: null, vatNumber: null });
  });

  it('audits what changed', async () => {
    const b = await registerUser(app, { businessName: 'Audit Profile Co' });
    await b.patch('/api/businesses/current', { address: 'New Road' });
    const [entry] = await auditFor(b.businessId, 'business.update');
    expect(entry.before).toEqual({ address: null });
    expect(entry.after).toEqual({ address: 'New Road' });
  });

  it.each([
    ['a blank name', { name: '  ' }],
    ['an invalid email', { email: 'nope' }],
    ['an over-long PAN', { panNumber: 'x'.repeat(21) }],
    ['an unknown field', { status: 'suspended' }],
    ['a field from the settings group', { dateDisplay: 'AD' }],
    ['nothing', {}],
  ])('rejects %s', async (_label, body) => {
    expect((await owner.patch('/api/businesses/current', body)).status).toBe(400);
  });

  it('needs business.update: an administrator may, an accountant and staff may not', async () => {
    const b = await registerUser(app, { businessName: 'Profile Perms Co' });
    const admin = await createMemberSession(app, pool, { businessId: b.businessId, roleKey: 'business_admin' });
    const accountant = await createMemberSession(app, pool, { businessId: b.businessId, roleKey: 'accountant' });
    expect((await admin.patch('/api/businesses/current', { phone: '01-1111111' })).status).toBe(200);
    expect((await accountant.patch('/api/businesses/current', { phone: '01-2222222' })).status).toBe(403);
    expect((await b.get('/api/settings')).body.data.business.phone).toBe('01-1111111');
  });
});
