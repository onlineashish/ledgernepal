// Receipts (money in, settles sales invoices) and payments (money out, settles purchase bills) share every screen.
export const SETTLEMENTS = {
  receipt: {
    type: 'receipt',
    api: '/receipts',
    base: '/receipts-payments/receipts',
    newPath: '/receipts-payments/new-receipt',
    plural: 'Receipts',
    singular: 'Receipt',
    newLabel: 'Record receipt',
    partyLabel: 'Customer',
    documentNoun: 'sales invoice',
    documentsPath: '/sales',
    intro: 'Money you received from customers.',
    effectText: (name) => `${name} will owe you less.`,
    perms: { view: 'receipts.view', create: 'receipts.create', void: 'receipts.void' },
  },
  payment: {
    type: 'payment',
    api: '/payments',
    base: '/receipts-payments/payments',
    newPath: '/receipts-payments/new-payment',
    plural: 'Payments',
    singular: 'Payment',
    newLabel: 'Record payment',
    partyLabel: 'Supplier',
    documentNoun: 'purchase bill',
    documentsPath: '/purchases',
    intro: 'Money you paid to suppliers.',
    effectText: (name) => `You will owe ${name} less.`,
    perms: { view: 'payments.view', create: 'payments.create', void: 'payments.void' },
  },
};

export const METHODS = [
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank transfer'],
  ['cheque', 'Cheque'],
  ['esewa', 'eSewa'],
  ['khalti', 'Khalti'],
  ['other', 'Other'],
];
export const METHOD_LABELS = Object.fromEntries(METHODS);

