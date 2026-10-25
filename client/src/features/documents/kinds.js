// The two kinds of document share every screen; only the words, the URLs and the permissions differ.
export const KINDS = {
  sale: {
    type: 'sale',
    path: '/sales',
    api: '/sales',
    plural: 'Sales',
    singular: 'Sales invoice',
    newLabel: 'New sales invoice',
    partyLabel: 'Customer',
    refLabel: 'Your reference (optional)',
    refHint: "For example the customer's purchase order number.",
    effect: 'debit',
    afterPosting: (name) => `Posting adds this to ${name}'s account.`,
    perms: { view: 'sales.view', create: 'sales.create', update: 'sales.update', void: 'sales.void' },
  },
  purchase: {
    type: 'purchase',
    path: '/purchases',
    api: '/purchases',
    plural: 'Purchases',
    singular: 'Purchase bill',
    newLabel: 'Record purchase bill',
    partyLabel: 'Supplier',
    refLabel: "Supplier's bill number",
    refHint: 'The number printed on the supplier’s bill.',
    effect: 'credit',
    afterPosting: (name) => `Posting adds this to what you owe ${name}.`,
    perms: { view: 'purchases.view', create: 'purchases.create', update: 'purchases.update', void: 'purchases.void' },
  },
};

export const STATUS_TONES = { draft: 'amber', posted: 'green', voided: 'red' };
export const STATUS_LABELS = { draft: 'Draft', posted: 'Posted', voided: 'Voided' };
