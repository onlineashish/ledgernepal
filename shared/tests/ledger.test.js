import { describe, expect, it } from 'vitest';
import { toPaisa } from '../money.js';
import {
  DIRECTIONS,
  OPENING_SIDES,
  balanceAfter,
  balanceSide,
  balanceSideOfAmount,
  describeBalance,
  describeBalanceAfter,
  describeOutcome,
  directionOfEffect,
  openingSideOfEffect,
} from '../ledger.js';

describe('directions', () => {
  it('"You gave" raises what they owe you (debit); "You got" lowers it (credit)', () => {
    expect(DIRECTIONS.you_gave.effect).toBe('debit');
    expect(DIRECTIONS.you_got.effect).toBe('credit');
  });

  it('maps both ways without loss', () => {
    for (const [key, { effect }] of Object.entries(DIRECTIONS)) expect(directionOfEffect(effect)).toBe(key);
    for (const [key, { effect }] of Object.entries(OPENING_SIDES)) expect(openingSideOfEffect(effect)).toBe(key);
  });

  it('opening balances: "they owe me" is a debit, "I owe them" a credit', () => {
    expect(OPENING_SIDES.they_owe_me.effect).toBe('debit');
    expect(OPENING_SIDES.i_owe_them.effect).toBe('credit');
  });
});

describe('balance sides', () => {
  it.each([
    [500000n, 'receivable'], [-1n, 'payable'], [0n, 'settled'],
  ])('%s paisa is %s', (paisa, side) => expect(balanceSide(paisa)).toBe(side));

  it.each([
    ['5000.00', 'receivable'], ['0.01', 'receivable'], ['-300.50', 'payable'],
    ['0.00', 'settled'], ['0', 'settled'], ['-0.00', 'settled'],
  ])('"%s" is %s', (amount, side) => expect(balanceSideOfAmount(amount)).toBe(side));

  it('refuses a float', () => {
    expect(() => balanceSide(5)).toThrow(TypeError);
  });

  it('describes balances in plain words', () => {
    expect(describeBalance('Ram', '5000.00')).toBe('Ram owes you');
    expect(describeBalance('Ram', '-5000.00')).toBe('You owe Ram');
    expect(describeBalance('Ram', '0.00')).toBe('Settled');
  });
});

describe('describeOutcome (the sentence under the form)', () => {
  const format = (paisa) => `Rs ${Number(paisa) / 100}`;
  const say = (direction, amount, current) =>
    describeOutcome({ name: 'Ram', direction, amountPaisa: toPaisa(amount), currentPaisa: current === null ? null : current, format });

  it('says what the balance will become after giving', () => {
    expect(say('you_gave', '2000', toPaisa('5000'))).toBe('You gave Rs 2000. Ram will owe you Rs 7000.');
  });

  it('says what the balance will become after getting', () => {
    expect(say('you_got', '2000', toPaisa('5000'))).toBe('You got Rs 2000. Ram will owe you Rs 3000.');
  });

  it('says so when the account becomes settled, and when the direction flips', () => {
    expect(say('you_got', '5000', toPaisa('5000'))).toBe("You got Rs 5000. Ram's account will be settled.");
    expect(say('you_got', '6000', toPaisa('5000'))).toBe('You got Rs 6000. You will owe Ram Rs 1000.');
    expect(say('you_gave', '100', -toPaisa('300'))).toBe('You gave Rs 100. You will owe Ram Rs 200.');
  });

  it('starts from a zero balance', () => {
    expect(say('you_gave', '10', 0n)).toBe('You gave Rs 10. Ram will owe you Rs 10.');
  });

  it('shows only the first half when the person may not see balances', () => {
    expect(say('you_gave', '2000', null)).toBe('You gave Rs 2000.');
  });
});

describe('describeBalanceAfter', () => {
  const format = (paisa) => `Rs ${Number(paisa) / 100}`;
  it('words a positive, negative and zero balance', () => {
    expect(describeBalanceAfter({ name: 'Ram', balancePaisa: toPaisa('700'), format })).toBe('Ram will owe you Rs 700');
    expect(describeBalanceAfter({ name: 'Ram', balancePaisa: -toPaisa('200'), format })).toBe('You will owe Ram Rs 200');
    expect(describeBalanceAfter({ name: 'Ram', balancePaisa: 0n, format })).toBe("Ram's account will be settled");
  });
});

describe('balanceAfter (the live preview)', () => {
  it('gave: they owe more; got: they owe less; can cross zero', () => {
    const current = toPaisa('5000.00');
    expect(balanceAfter(current, 'debit', toPaisa('2000.00'))).toBe(toPaisa('7000.00'));
    expect(balanceAfter(current, 'credit', toPaisa('2000.00'))).toBe(toPaisa('3000.00'));
    expect(balanceAfter(current, 'credit', toPaisa('6000.00'))).toBe(-toPaisa('1000.00')); // now you owe them
  });
});
