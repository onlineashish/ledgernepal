import { describe, expect, it } from 'vitest';
import { isOverdue, paymentStatus, planOldestFirst } from '../allocation.js';
import { toPaisa } from '../money.js';

const doc = (id, txnDate, outstanding, referenceNo = null) => ({ id, txnDate, referenceNo, outstanding: toPaisa(outstanding) });
const amounts = (plan) => plan.allocations.map((a) => [a.id, a.amount]);

describe('planOldestFirst', () => {
  it('settles the oldest document first, then the next', () => {
    const plan = planOldestFirst(toPaisa('700'), [doc('new', '2025-09-01', '500'), doc('old', '2025-08-01', '400')]);
    expect(amounts(plan)).toEqual([['old', toPaisa('400')], ['new', toPaisa('300')]]);
    expect(plan.remainder).toBe(0n);
  });

  it('pays a document only up to what is outstanding on it, and keeps the rest as an advance', () => {
    const plan = planOldestFirst(toPaisa('1000'), [doc('a', '2025-08-01', '300'), doc('b', '2025-08-02', '200')]);
    expect(amounts(plan)).toEqual([['a', toPaisa('300')], ['b', toPaisa('200')]]);
    expect(plan.remainder).toBe(toPaisa('500'));
  });

  it('stops when the money runs out, leaving a part-paid document', () => {
    const plan = planOldestFirst(toPaisa('250'), [doc('a', '2025-08-01', '300'), doc('b', '2025-08-02', '200')]);
    expect(amounts(plan)).toEqual([['a', toPaisa('250')]]);
    expect(plan.remainder).toBe(0n);
  });

  it('breaks ties on the same date by document number, then id, so the result is always the same', () => {
    const docs = [doc('z', '2025-08-01', '100', 'SI-0002'), doc('y', '2025-08-01', '100', 'SI-0001')];
    expect(amounts(planOldestFirst(toPaisa('100'), docs))).toEqual([['y', toPaisa('100')]]);
    expect(amounts(planOldestFirst(toPaisa('100'), [...docs].reverse()))).toEqual([['y', toPaisa('100')]]);
  });

  it('skips documents with nothing outstanding, and handles no money or no documents', () => {
    expect(planOldestFirst(toPaisa('50'), [doc('paid', '2025-08-01', '0'), doc('open', '2025-08-02', '80')]).allocations.map((a) => a.id)).toEqual(['open']);
    expect(planOldestFirst(0n, [doc('a', '2025-08-01', '10')])).toEqual({ allocations: [], remainder: 0n });
    expect(planOldestFirst(toPaisa('10'), [])).toEqual({ allocations: [], remainder: toPaisa('10') });
  });

  it('never allocates more than the money available, nor more than any document’s outstanding (property check)', () => {
    let seed = 20251025;
    const rnd = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
    for (let round = 0; round < 300; round += 1) {
      const docs = Array.from({ length: rnd(8) }, (_, i) => ({ id: `d${i}`, txnDate: `2025-0${1 + rnd(9)}-1${rnd(9)}`, referenceNo: `R${rnd(50)}`, outstanding: BigInt(rnd(100_000)) }));
      const available = BigInt(rnd(300_000));
      const { allocations, remainder } = planOldestFirst(available, docs);
      const total = allocations.reduce((s, a) => s + a.amount, 0n);
      expect(total + remainder).toBe(available);
      for (const a of allocations) {
        expect(a.amount > 0n).toBe(true);
        expect(a.amount <= docs.find((d) => d.id === a.id).outstanding).toBe(true);
      }
      if (remainder > 0n) expect(allocations.length).toBe(docs.filter((d) => d.outstanding > 0n).length); // money left over => everything open was settled
    }
  });

  it('refuses a float or negative amount', () => {
    expect(() => planOldestFirst(5, [])).toThrow(TypeError);
    expect(() => planOldestFirst(-1n, [])).toThrow(TypeError);
  });
});

describe('paymentStatus', () => {
  it.each([
    ['1000', '0', 'unpaid'], ['1000', '0.01', 'partially_paid'], ['1000', '999.99', 'partially_paid'], ['1000', '1000', 'paid'],
  ])('total %s, paid %s -> %s', (total, paid, expected) => {
    expect(paymentStatus(toPaisa(total), toPaisa(paid))).toBe(expected);
  });
});

describe('isOverdue', () => {
  const base = { dueDate: '2025-08-10', outstanding: 100n, today: '2025-08-11' };
  it('needs a due date in the past AND something outstanding', () => {
    expect(isOverdue(base)).toBe(true);
    expect(isOverdue({ ...base, today: '2025-08-10' })).toBe(false); // due today is not yet late
    expect(isOverdue({ ...base, outstanding: 0n })).toBe(false); // fully paid
    expect(isOverdue({ ...base, dueDate: null })).toBe(false); // no due date: never overdue
  });
});
