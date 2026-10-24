import { describe, expect, it } from 'vitest';
import { toPaisa } from '../money.js';
import {
  DIRECTIONS,
  OPENING_SIDES,
  balanceAfter,
  balanceSide,
  balanceSideOfAmount,
  describeBalance,
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

describe('balanceAfter (the live preview)', () => {
  it('gave: they owe more; got: they owe less; can cross zero', () => {
    const current = toPaisa('5000.00');
    expect(balanceAfter(current, 'debit', toPaisa('2000.00'))).toBe(toPaisa('7000.00'));
    expect(balanceAfter(current, 'credit', toPaisa('2000.00'))).toBe(toPaisa('3000.00'));
    expect(balanceAfter(current, 'credit', toPaisa('6000.00'))).toBe(-toPaisa('1000.00')); // now you owe them
  });
});
