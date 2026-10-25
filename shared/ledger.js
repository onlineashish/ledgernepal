// Ledger vocabulary shared by server and client. The rules are written in docs/accounting-conventions.md.
//
// Balance = debits - credits, always from the point of view of what the CONTACT OWES THE BUSINESS:
//   debit  -> they owe you more        credit -> they owe you less
// Direct entries use khata words so nobody has to decide what "credit" means:
//   you_gave (दिएको) = debit      you_got (पाएको) = credit

export const DIRECTIONS = Object.freeze({
  you_gave: { effect: 'debit', label: 'You gave', meaning: 'they owe you more' },
  you_got: { effect: 'credit', label: 'You got', meaning: 'they owe you less' },
});
export const DIRECTION_KEYS = Object.freeze(Object.keys(DIRECTIONS));

// Opening balances are described by who owes whom, which is clearer than a direction.
export const OPENING_SIDES = Object.freeze({
  they_owe_me: { effect: 'debit', label: 'They owe me (receivable)' },
  i_owe_them: { effect: 'credit', label: 'I owe them (payable)' },
});
export const OPENING_SIDE_KEYS = Object.freeze(Object.keys(OPENING_SIDES));

export const directionOfEffect = (effect) => (effect === 'debit' ? 'you_gave' : 'you_got');
export const openingSideOfEffect = (effect) => (effect === 'debit' ? 'they_owe_me' : 'i_owe_them');

/** 'receivable' (contact owes you), 'payable' (you owe the contact) or 'settled', from a paisa BigInt balance. */
export function balanceSide(paisa) {
  if (typeof paisa !== 'bigint') throw new TypeError('balance must be BigInt paisa');
  return paisa > 0n ? 'receivable' : paisa < 0n ? 'payable' : 'settled';
}

/** Same, from the decimal string the API sends ("-250.00"). */
export function balanceSideOfAmount(amount) {
  const n = String(amount).trim();
  if (/^-0(\.0+)?$/.test(n) || /^0(\.0+)?$/.test(n)) return 'settled';
  return n.startsWith('-') ? 'payable' : 'receivable';
}

/** Words for a balance, e.g. "Ram owes you" / "You owe Ram" / "Settled". */
export function describeBalance(contactName, amount) {
  switch (balanceSideOfAmount(amount)) {
    case 'receivable': return `${contactName} owes you`;
    case 'payable': return `You owe ${contactName}`;
    default: return 'Settled';
  }
}

/** The balance after an entry, for the live preview: "You gave रु 2,000 → Ram will owe you रु 7,000". Pure paisa math. */
export function balanceAfter(currentPaisa, effect, amountPaisa) {
  return effect === 'debit' ? currentPaisa + amountPaisa : currentPaisa - amountPaisa;
}

/**
 * The sentence shown while someone fills in a direct entry, so the meaning is never a guess:
 *   "You gave रु 2,000.00. Ram will owe you रु 7,000.00."
 * `currentPaisa` may be null when the person is not allowed to see balances; then only the first half is shown.
 * Pure function over paisa BigInts; formatting of the rupee amounts is injected so this file stays free of display code.
 */
export function describeOutcome({ name, direction, amountPaisa, currentPaisa = null, format }) {
  const first = `${DIRECTIONS[direction].label} ${format(amountPaisa)}.`;
  if (currentPaisa === null) return first;
  const after = balanceAfter(currentPaisa, DIRECTIONS[direction].effect, amountPaisa);
  if (after === 0n) return `${first} ${name}'s account will be settled.`;
  return after > 0n
    ? `${first} ${name} will owe you ${format(after)}.`
    : `${first} You will owe ${name} ${format(-after)}.`;
}
