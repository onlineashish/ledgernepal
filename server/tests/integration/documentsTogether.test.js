import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;
beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Documents Together Co' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const line = (o = {}) => ({ description: 'Rice', quantity: '2', unitPrice: '100', ...o });
const newContact = async (session = owner, name = 'Ram Traders') => (await session.post('/api/contacts', { name, types: ['customer', 'supplier'] })).body.data;
const balanceOf = async (contactId, session = owner) => (await session.get(`/api/contacts/${contactId}`)).body.data.balance.amount;

describe('sales and purchases together', () => {
  it('a customer who is also a supplier has ONE net balance', async () => {
    const c = await newContact(owner, 'Both Ways');
    await owner.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', lines: [line({ unitPrice: '1000', quantity: '1' })], post: true });
    expect(await balanceOf(c.id)).toBe('1000.00'); // they owe you
    await owner.post('/api/purchases', { contactId: c.id, txnDate: '2025-08-02', lines: [line({ unitPrice: '300', quantity: '1' })], post: true });
    expect(await balanceOf(c.id)).toBe('700.00'); // netted
    await owner.post('/api/purchases', { contactId: c.id, txnDate: '2025-08-03', lines: [line({ unitPrice: '900', quantity: '1' })], post: true });
    expect(await balanceOf(c.id)).toBe('-200.00'); // now you owe them
    const ledger = (await owner.get(`/api/ledger/contacts/${c.id}`)).body.data;
    expect(ledger.rows.map((r) => [r.type, r.balance])).toEqual([['sale', '1000.00'], ['purchase', '700.00'], ['purchase', '-200.00']]);
    expect(ledger.closingBalance).toBe('-200.00');
  });

  it('sales and purchases are numbered separately, each from 0001 in its own prefix', async () => {
    const solo = await registerUser(app, { businessName: 'Numbering Docs Co' });
    const c = (await solo.post('/api/contacts', { name: 'N', types: ['customer'] })).body.data;
    const body = { contactId: c.id, txnDate: '2025-08-01', lines: [line()], post: true };
    expect((await solo.post('/api/sales', body)).body.data.referenceNo).toBe('SI-2082/83-0001');
    expect((await solo.post('/api/purchases', body)).body.data.referenceNo).toBe('PB-2082/83-0001');
    expect((await solo.post('/api/sales', body)).body.data.referenceNo).toBe('SI-2082/83-0002');
  });
});
