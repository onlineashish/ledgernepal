import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addPaisa,
  allocateProportionally,
  calculateLine,
  formatNPR,
  fromPaisa,
  multiplyByQuantity,
  percentOf,
  subPaisa,
  toPaisa,
} from '../money.js';

describe('toPaisa', () => {
  it.each([
    ['0', 0n],
    ['1', 100n],
    ['1250.5', 125050n],
    ['1250.50', 125050n],
    ['0.07', 7n],
    ['0.5', 50n],
    ['  99.99  ', 9999n],
    ['999999999999.99', 99_999_999_999_999n], // largest NUMERIC(14,2) value
  ])('parses %s', (input, expected) => {
    expect(toPaisa(input)).toBe(expected);
  });

  it('accepts plain numbers without floating point drift', () => {
    expect(toPaisa(0.1)).toBe(10n);
    expect(toPaisa(19.99)).toBe(1999n);
    // Floating-point noise (3.3000000000000003) is rejected rather than silently rounded into money.
    expect(() => toPaisa(1.1 + 2.2)).toThrow(MoneyError);
  });

  it.each(['', ' ', 'abc', '1.234', '1,250.00', '1e5', '--5', '5.', '.5', '1.2.3', '१२३', '0x10', '1000000000000.00'])(
    'rejects %j',
    (input) => {
      expect(() => toPaisa(input)).toThrow(MoneyError);
    },
  );

  it('rejects non-strings/numbers, NaN, Infinity and exponent-form numbers', () => {
    for (const bad of [null, undefined, {}, [], NaN, Infinity, 1e21, 1e-7, 10n]) {
      expect(() => toPaisa(bad)).toThrow(MoneyError);
    }
  });

  it('rejects negatives unless explicitly allowed', () => {
    expect(() => toPaisa('-5.00')).toThrow(/negative/i);
    expect(toPaisa('-5.25', { allowNegative: true })).toBe(-525n);
  });
});

describe('fromPaisa', () => {
  it.each([
    [0n, '0.00'],
    [7n, '0.07'],
    [100n, '1.00'],
    [125050n, '1250.50'],
    [-525n, '-5.25'],
    [-5n, '-0.05'],
  ])('%s -> %s', (paisa, expected) => {
    expect(fromPaisa(paisa)).toBe(expected);
  });

  it('round-trips with toPaisa', () => {
    for (const s of ['0.00', '0.01', '12.34', '100.00', '999999999999.99']) {
      expect(fromPaisa(toPaisa(s))).toBe(s);
    }
  });

  it('refuses values that do not fit NUMERIC(14,2) and non-BigInt input', () => {
    expect(() => fromPaisa(100_000_000_000_000n)).toThrow(/too large/i);
    expect(() => fromPaisa(12.5)).toThrow(MoneyError);
    expect(() => fromPaisa('100')).toThrow(MoneyError);
  });
});

describe('formatNPR (Nepali digit grouping)', () => {
  it.each([
    [0n, 'रु 0.00'],
    [5n, 'रु 0.05'],
    [99_900n, 'रु 999.00'],
    [100_000n, 'रु 1,000.00'],
    [12_345_678n, 'रु 1,23,456.78'],
    [123_456_700n, 'रु 12,34,567.00'],
    [1_234_567_800n, 'रु 1,23,45,678.00'],
    [123_456_789_000n, 'रु 1,23,45,67,890.00'], // 1,234,567,890 rupees
    [-12_345_678n, '-रु 1,23,456.78'],
  ])('%s -> %s', (paisa, expected) => {
    expect(formatNPR(paisa)).toBe(expected);
  });

  it('can omit the symbol', () => {
    expect(formatNPR(12_345_678n, { symbol: false })).toBe('1,23,456.78');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly (no 0.1 + 0.2 problem)', () => {
    expect(addPaisa(toPaisa('0.10'), toPaisa('0.20'))).toBe(toPaisa('0.30'));
    expect(subPaisa(toPaisa('10.00'), toPaisa('0.01'))).toBe(999n);
    expect(addPaisa()).toBe(0n);
  });

  it('refuses to mix in plain numbers', () => {
    expect(() => addPaisa(1n, 2)).toThrow(MoneyError);
  });
});

describe('multiplyByQuantity', () => {
  it.each([
    ['199.99', '2.5', '499.98'], // 499.975 rounds half up
    ['100.00', '3', '300.00'],
    ['0.01', '0.5', '0.01'], // 0.005 rounds up to 0.01
    ['0.01', '0.499', '0.00'], // 0.00499 rounds down
    ['10.00', '0.333', '3.33'],
    ['1234567.89', '1000', '1234567890.00'],
  ])('%s x %s = %s', (price, qty, expected) => {
    expect(fromPaisa(multiplyByQuantity(toPaisa(price), qty))).toBe(expected);
  });

  it('rejects zero, negative, junk and over-precise quantities', () => {
    for (const bad of ['0', '0.000', '-1', 'abc', '', '1.2345', '1e3']) {
      expect(() => multiplyByQuantity(100n, bad)).toThrow(MoneyError);
    }
  });
});

describe('percentOf', () => {
  it.each([
    ['449.98', '13', '58.50'], // 58.4974 -> 58.50
    ['100.00', '13', '13.00'],
    ['100.00', '0', '0.00'],
    ['100.00', '100', '100.00'],
    ['0.05', '10', '0.01'], // 0.005 -> 0.01 (half up)
    ['0.04', '10', '0.00'],
    ['1000.00', '2.5', '25.00'],
    ['333.33', '13.00', '43.33'], // 43.3329
  ])('%s at %s percent = %s', (amount, rate, expected) => {
    expect(fromPaisa(percentOf(toPaisa(amount), rate))).toBe(expected);
  });

  it('rejects rates over 100% or malformed', () => {
    for (const bad of ['100.01', '101', '-1', 'x', '', '1.234']) {
      expect(() => percentOf(100n, bad)).toThrow(MoneyError);
    }
  });
});

describe('allocateProportionally', () => {
  it('splits so the parts always add up exactly', () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(1000n, [300n, 700n])).toEqual([300n, 700n]);
    expect(allocateProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
  });

  it('gives nothing to zero-weight items', () => {
    expect(allocateProportionally(500n, [0n, 100n, 0n])).toEqual([0n, 500n, 0n]);
  });

  it('is exact for many random-looking splits (property check)', () => {
    let seed = 12345;
    const next = (max) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return BigInt(seed % max);
    };
    for (let i = 0; i < 500; i += 1) {
      const total = next(10_000_000);
      const weights = Array.from({ length: 1 + Number(next(8)) }, () => next(100_000) + 1n);
      const parts = allocateProportionally(total, weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      parts.forEach((p) => expect(p >= 0n).toBe(true));
    }
  });

  it('rejects impossible inputs', () => {
    expect(() => allocateProportionally(-1n, [1n])).toThrow(MoneyError);
    expect(() => allocateProportionally(10n, [])).toThrow(MoneyError);
    expect(() => allocateProportionally(10n, [0n, 0n])).toThrow(MoneyError);
    expect(() => allocateProportionally(10n, [-1n, 2n])).toThrow(MoneyError);
  });
});

describe('calculateLine', () => {
  it('separates gross, discount, taxable amount, tax and total', () => {
    const line = calculateLine({ quantity: '2.5', unitPrice: toPaisa('199.99'), discount: toPaisa('50'), taxRate: '13' });
    expect(fromPaisa(line.gross)).toBe('499.98');
    expect(fromPaisa(line.net)).toBe('449.98');
    expect(fromPaisa(line.taxable)).toBe('449.98');
    expect(fromPaisa(line.tax)).toBe('58.50');
    expect(fromPaisa(line.total)).toBe('508.48');
  });

  it('charges no tax when the line has no tax rate (non-VAT business or exempt item)', () => {
    const line = calculateLine({ quantity: '3', unitPrice: toPaisa('100'), taxRate: null });
    expect(line.tax).toBe(0n);
    expect(line.taxable).toBe(0n);
    expect(line.nonTaxable).toBe(line.net);
    expect(fromPaisa(line.total)).toBe('300.00');
  });

  it('treats a 0% rate as taxable-at-zero, distinct from not taxable', () => {
    const line = calculateLine({ quantity: '1', unitPrice: toPaisa('100'), taxRate: '0' });
    expect(line.taxable).toBe(10000n);
    expect(line.tax).toBe(0n);
  });

  it('rejects a discount larger than the line or a negative discount', () => {
    expect(() => calculateLine({ quantity: '1', unitPrice: 1000n, discount: 1001n })).toThrow(/more than/i);
    expect(() => calculateLine({ quantity: '1', unitPrice: 1000n, discount: -1n })).toThrow(MoneyError);
  });

  it('total always equals net + tax', () => {
    for (const [qty, price, disc, rate] of [['7', '33.33', '1.11', '13'], ['0.125', '9999.99', '0', '13'], ['1', '0.01', '0', '13']]) {
      const l = calculateLine({ quantity: qty, unitPrice: toPaisa(price), discount: toPaisa(disc), taxRate: rate });
      expect(l.total).toBe(l.net + l.tax);
      expect(l.taxable + l.nonTaxable).toBe(l.net);
    }
  });
});
