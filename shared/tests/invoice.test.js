import { describe, expect, it } from 'vitest';
import { calculateDocument, MAX_LINES } from '../invoice.js';
import { MoneyError, fromPaisa, toPaisa } from '../money.js';

const line = (quantity, unitPrice, extra = {}) => ({ quantity: String(quantity), unitPrice: toPaisa(unitPrice), ...extra });
const money = (paisa) => fromPaisa(paisa);
const discount = (v) => toPaisa(v);

describe('calculateDocument', () => {
  it('a plain line: quantity x price, no discount, no VAT', () => {
    const { lines, totals } = calculateDocument({ lines: [line(3, '100')] });
    expect(lines[0]).toMatchObject({ taxRate: null, taxable: 0n, tax: 0n });
    expect(Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money(v)]))).toEqual({
      subtotal: '300.00', discount: '0.00', taxable: '0.00', nonTaxable: '300.00', tax: '0.00', total: '300.00',
    });
  });

  it('the worked example from the plan: 2.5 x 199.99, minus 50, taxable at 13%', () => {
    const { lines, totals } = calculateDocument({ lines: [line('2.5', '199.99', { discount: discount('50'), taxRate: '13' })] });
    expect(money(lines[0].gross)).toBe('499.98'); // 499.975 rounds half up
    expect(money(lines[0].net)).toBe('449.98');
    expect(money(lines[0].tax)).toBe('58.50'); // 58.4974
    expect(money(totals.total)).toBe('508.48');
    expect(money(totals.taxable)).toBe('449.98');
  });

  it('keeps taxable, non-taxable and tax apart in the totals', () => {
    const { totals } = calculateDocument({
      lines: [line(1, '1000', { taxRate: '13' }), line(1, '500'), line(2, '250', { taxRate: '0' })],
    });
    expect(money(totals.taxable)).toBe('1500.00'); // the 13% line and the 0% line
    expect(money(totals.nonTaxable)).toBe('500.00');
    expect(money(totals.tax)).toBe('130.00');
    expect(money(totals.total)).toBe('2130.00');
  });

  it('a 0% rate is "taxable at zero", not the same as "not taxable"', () => {
    const { lines } = calculateDocument({ lines: [line(1, '100', { taxRate: '0' }), line(1, '100')] });
    expect(lines[0]).toMatchObject({ taxable: 10000n, nonTaxable: 0n, tax: 0n });
    expect(lines[1]).toMatchObject({ taxable: 0n, nonTaxable: 10000n, tax: 0n });
  });

  it('an invoice discount is spread over the lines in proportion, BEFORE VAT', () => {
    const { lines, totals } = calculateDocument({
      lines: [line(1, '600', { taxRate: '13' }), line(1, '400')],
      invoiceDiscount: discount('100'),
    });
    expect(lines.map((l) => money(l.invoiceDiscountShare))).toEqual(['60.00', '40.00']);
    expect(money(lines[0].net)).toBe('540.00');
    expect(money(lines[0].tax)).toBe('70.20'); // 13% of 540, not of 600
    expect(money(totals.discount)).toBe('100.00');
    expect(money(lines[1].net)).toBe('360.00'); // 400 - its 40 share
    expect(money(totals.total)).toBe('970.20'); // (540 + 70.20) + 360 = 1000 - 100 + 70.20
  });

  it('shares add up to the invoice discount exactly, even when it does not divide evenly', () => {
    const { lines } = calculateDocument({ lines: [line(1, '100'), line(1, '100'), line(1, '100')], invoiceDiscount: discount('10') });
    const shares = lines.map((l) => l.invoiceDiscountShare);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1000n);
    expect(shares.map(money)).toEqual(['3.34', '3.33', '3.33']);
  });

  it('line discounts and the invoice discount combine', () => {
    const { totals } = calculateDocument({
      lines: [line(2, '500', { discount: discount('100') }), line(1, '1000')],
      invoiceDiscount: discount('200'),
    });
    expect(money(totals.subtotal)).toBe('2000.00');
    expect(money(totals.discount)).toBe('300.00');
    expect(money(totals.total)).toBe('1700.00');
  });

  it('a free item is allowed as long as something else has a price', () => {
    const { totals } = calculateDocument({ lines: [line(1, '0'), line(1, '10')] });
    expect(money(totals.total)).toBe('10.00');
  });

  it('can discount the whole document to nothing', () => {
    const { totals } = calculateDocument({ lines: [line(1, '100', { taxRate: '13' })], invoiceDiscount: discount('100') });
    expect(totals.total).toBe(0n);
    expect(totals.tax).toBe(0n);
  });

  describe('refuses impossible input, pointing at the right field', () => {
    const rejects = (input, message, field) => {
      try {
        calculateDocument(input);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MoneyError);
        expect(err.message).toMatch(message);
        expect(err.field).toBe(field);
      }
    };

    it('no lines, or too many', () => {
      rejects({ lines: [] }, /at least one line/, 'lines');
      rejects({ lines: Array.from({ length: MAX_LINES + 1 }, () => line(1, '1')) }, /at most 200 lines/, 'lines');
    });

    it('a line discount larger than the line, naming the line', () => {
      rejects({ lines: [line(1, '100'), line(1, '10', { discount: discount('11') })] }, /Line 2: discount cannot be more/, 'lines');
    });

    it('an invoice discount larger than what is left after line discounts', () => {
      rejects({ lines: [line(1, '100', { discount: discount('30') })], invoiceDiscount: discount('71') }, /more than the total after line discounts/, 'invoiceDiscount');
      rejects({ lines: [line(1, '100')], invoiceDiscount: -1n }, /cannot be negative/, 'invoiceDiscount');
    });

    it('an invalid quantity', () => {
      expect(() => calculateDocument({ lines: [line(0, '10')] })).toThrow(MoneyError);
      expect(() => calculateDocument({ lines: [line('1.2345', '10')] })).toThrow(MoneyError);
    });
  });

  describe('invariants hold for any input (property check)', () => {
    let seed = 987654321;
    const rnd = (max) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };

    it('total = subtotal - discount + tax, lines add up to the totals, nothing negative, shares exact', () => {
      for (let round = 0; round < 400; round += 1) {
        const count = 1 + rnd(6);
        const lines = Array.from({ length: count }, () => {
          const unitPrice = BigInt(rnd(5_000_000)); // up to 50,000.00
          const quantity = `${1 + rnd(200)}.${String(rnd(1000)).padStart(3, '0')}`;
          const rate = rnd(3) === 0 ? null : ['0', '5', '13', '13.5', '99.99'][rnd(5)];
          return { quantity, unitPrice, taxRate: rate };
        });
        const rawGross = lines.map((l) => (l.unitPrice * BigInt(Math.round(Number(l.quantity) * 1000)) + 500n) / 1000n);
        const maxDiscount = rawGross.reduce((a, b) => a + b, 0n);
        const invoiceDiscount = maxDiscount === 0n ? 0n : BigInt(rnd(Number(maxDiscount > 2_000_000n ? 2_000_000n : maxDiscount) + 1));

        const result = calculateDocument({ lines, invoiceDiscount });
        const { totals } = result;
        expect(totals.total).toBe(totals.subtotal - totals.discount + totals.tax);
        expect(totals.total).toBe(totals.taxable + totals.nonTaxable + totals.tax);
        expect(result.lines.reduce((a, l) => a + l.total, 0n)).toBe(totals.total);
        expect(result.lines.reduce((a, l) => a + l.invoiceDiscountShare, 0n)).toBe(invoiceDiscount);
        for (const l of result.lines) {
          expect(l.net >= 0n && l.tax >= 0n && l.invoiceDiscountShare >= 0n).toBe(true);
          expect(l.total).toBe(l.net + l.tax);
          expect(l.taxable + l.nonTaxable).toBe(l.net);
          if (l.taxRate === null) expect(l.tax).toBe(0n);
        }
      }
    });
  });
});
