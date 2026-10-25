import { defineDocumentsSuite } from '../helpers/documentsSuite.js';

defineDocumentsSuite({ type: 'purchase', path: '/api/purchases', prefix: 'PB', sign: '-', noun: 'purchase bill', side: 'payable' });
