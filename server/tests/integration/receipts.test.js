import { defineSettlementsSuite } from '../helpers/settlementsSuite.js';

defineSettlementsSuite({ kind: 'receipt', path: '/api/receipts', otherPath: '/api/payments', docPath: '/api/sales', docType: 'sale', prefix: 'RC', effect: 'credit' });
