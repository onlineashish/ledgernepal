import { ok } from './helpers.jsx';

/** One line of an invoice as the API returns it. */
export const docLine = (o = {}) => ({
  lineNo: 1, description: 'Rice', quantity: '2.000', unit: 'kg', unitPrice: '100.00', grossAmount: '200.00', discount: '0.00',
  invoiceDiscountShare: '0.00', taxable: false, taxRate: null, taxableAmount: '0.00', taxAmount: '0.00', lineTotal: '200.00', ...o,
});

/** A full sales invoice / purchase bill as returned by GET /sales/:id (a draft by default). */
export const doc = (o = {}) => ({
  id: 'd1', type: 'sale', status: 'draft', referenceNo: null, txnDate: '2025-08-01', dueDate: null, externalRef: null, description: 'Rice',
  notes: null, contact: { id: 'c1', name: 'Ram Bahadur' }, total: '200.00', createdAt: '2026-10-01T00:00:00Z', postedAt: null,
  voidedAt: null, voidReason: null, createdBy: null,
  totals: { subtotal: '200.00', discount: '0.00', taxable: '0.00', nonTaxable: '200.00', tax: '0.00', total: '200.00' },
  lines: [docLine()], ...o,
});

export const posted = (o = {}) => doc({ status: 'posted', referenceNo: 'SI-2082/83-0001', postedAt: '2026-10-02T00:00:00Z', ...o });

/** A row of the list (no lines). */
export const listRow = (o = {}) => {
  const { lines, totals, notes, voidReason, createdBy, type, ...row } = doc(o);
  return row;
};

/** GET /settings. `settings` and `business` override single fields. */
export const settingsPayload = ({ settings = {}, business = {} } = {}) =>
  ok({
    business: { name: 'Test Traders', legalName: null, address: null, phone: null, email: null, panNumber: null, vatNumber: null, ...business },
    settings: {
      dateDisplay: 'BS', isVatRegistered: false, defaultVatRate: null, defaultCreditDays: null, invoiceFooter: null,
      prefixes: { sale: 'SI', purchase: 'PB', receipt: 'RC', payment: 'PM', ledgerEntry: 'LE', openingBalance: 'OB' },
      ...settings,
    },
  });
