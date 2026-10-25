import { describe, expect, it } from 'vitest';
import { fromPaisa } from '@ledgernepal/shared/money';
import { isBlankLine, previewDocument } from '../src/lib/invoicePreview.js';

const row = (o = {}) => ({ description: 'Rice', quantity: '1', unit: '', unitPrice: '100', discount: '', taxable: false, taxRate: '', ...o });
const noVat = { isVatRegistered: false, defaultVatRate: null };
const vat13 = { isVatRegistered: true, defaultVatRate: '13.00' };
const total = (r) => fromPaisa(r.totals.total);

describe('previewDocument', () => {
  it('adds up the same way the server does (the worked example)', () => {
    const r = previewDocument({ lines: [row({ quantity: '2.5', unitPrice: '199.99', discount: '50', taxable: true })], invoiceDiscount: '' }, vat13);
    expect(r.ok).toBe(true);
    expect(fromPaisa(r.lines[0].tax)).toBe('58.50');
    expect(total(r)).toBe('508.48');
  });

  it('uses the business default rate unless the line has its own', () => {
    const r = previewDocument({ lines: [row({ taxable: true }), row({ taxable: true, taxRate: '5' })], invoiceDiscount: '' }, vat13);
    expect(fromPaisa(r.totals.tax)).toBe('18.00'); // 13 + 5
  });

  it('ignores VAT entirely for a business that is not registered', () => {
    const r = previewDocument({ lines: [row({ taxable: true })], invoiceDiscount: '' }, noVat);
    expect(fromPaisa(r.totals.tax)).toBe('0.00');
    expect(total(r)).toBe('100.00');
  });

  it('spreads the invoice discount before VAT', () => {
    const r = previewDocument({ lines: [row({ unitPrice: '1000', taxable: true })], invoiceDiscount: '200' }, vat13);
    expect(fromPaisa(r.totals.tax)).toBe('104.00');
    expect(total(r)).toBe('904.00');
  });

  it('skips rows that have not been started, and keeps results under the right row', () => {
    const blank = row({ description: '', unitPrice: '', quantity: '1' });
    const r = previewDocument({ lines: [blank, row({ unitPrice: '40' }), blank, row({ unitPrice: '60' })], invoiceDiscount: '' }, noVat);
    expect(r.ok).toBe(true);
    expect(r.lineCount).toBe(2);
    expect(Object.keys(r.lines)).toEqual(['1', '3']); // form rows 2 and 4
    expect(total(r)).toBe('100.00');
  });

  it('says what is wrong with which row, and shows no total until it is fixed', () => {
    const r = previewDocument({ lines: [row(), row({ quantity: '0' }), row({ description: '', unitPrice: '5' }), row({ unitPrice: '1.234' }), row({ unitPrice: '', description: 'No price' })], invoiceDiscount: '' }, noVat);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.lineProblems)).toEqual(['2', '3', '4']);
    expect(r.lineProblems[2]).toBe('Describe the item');
    expect(r.lineProblems[3]).toMatch(/2 decimal places/);
    expect(r.lineProblems[4]).toBe('Enter a unit price');
  });

  it('a bad quantity is reported by the shared rules against the right row number', () => {
    const r = previewDocument({ lines: [row(), row({ description: '', unitPrice: '', quantity: '1' }), row({ discount: '500' })], invoiceDiscount: '' }, noVat);
    expect(r.ok).toBe(false);
    expect(r.lineProblems).toEqual({ 2: 'discount cannot be more than the line amount' }); // row 3 in the form (index 2)
  });

  it('asks for a rate when a taxable line has none and no default exists', () => {
    const r = previewDocument({ lines: [row({ taxable: true })], invoiceDiscount: '' }, { isVatRegistered: true, defaultVatRate: null });
    expect(r.ok).toBe(false);
    expect(r.lineProblems[0]).toMatch(/Enter a VAT rate/);
  });

  it('refuses an invoice discount bigger than the document', () => {
    const r = previewDocument({ lines: [row()], invoiceDiscount: '101' }, noVat);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/more than the total/);
  });

  it('wants at least one real line', () => {
    expect(previewDocument({ lines: [row({ description: '', unitPrice: '' })], invoiceDiscount: '' }, noVat)).toMatchObject({ ok: false, message: 'Add a line to see the total' });
  });

  it('isBlankLine', () => {
    expect(isBlankLine(row({ description: '  ', unitPrice: '', discount: '' }))).toBe(true);
    expect(isBlankLine(row({ description: '', unitPrice: '5' }))).toBe(false);
  });
});
