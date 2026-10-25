import { defineSettlementsSuite } from '../helpers/settlementsSuite.js';

defineSettlementsSuite({ kind: 'payment', path: '/api/payments', otherPath: '/api/receipts', docPath: '/api/purchases', docType: 'purchase', prefix: 'PM', effect: 'debit' });
