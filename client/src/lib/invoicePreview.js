import { calculateDocument } from '@ledgernepal/shared/invoice';
import { MoneyError, toPaisa } from '@ledgernepal/shared/money';

/** A row the person has not started on (no description, no price) is ignored, not an error. */
export const isBlankLine = (line) => !line.description.trim() && !String(line.unitPrice).trim() && !String(line.discount).trim();

const parseMoney = (text, label) => {
  const trimmed = String(text).trim();
  if (trimmed === '') return 0n;
  try {
    return toPaisa(trimmed);
  } catch {
    throw new MoneyError(`${label} must be an amount with at most 2 decimal places`);
  }
};

/**
 * Works out the totals while the person types, using the SAME rules as the server (shared/invoice.js).
 * The server recalculates and is the authority; this is only a preview.
 *
 * @returns {{ ok: true, lines, totals, lineCount } | { ok: false, message: string, lineProblems: Record<number, string> }}
 */
export function previewDocument({ lines, invoiceDiscount }, { isVatRegistered, defaultVatRate }) {
  const lineProblems = {};
  const inputs = [];
  const indexMap = []; // position in the calculation -> position in the form

  lines.forEach((line, formIndex) => {
    if (isBlankLine(line)) return;
    try {
      if (!line.description.trim()) throw new MoneyError('Describe the item');
      if (String(line.unitPrice).trim() === '') throw new MoneyError('Enter a unit price');
      const taxable = isVatRegistered && line.taxable;
      const rate = taxable ? (String(line.taxRate).trim() || defaultVatRate) : null;
      if (taxable && (rate === null || rate === undefined)) throw new MoneyError('Enter a VAT rate, or set a default rate in Settings');
      inputs.push({
        quantity: String(line.quantity).trim(),
        unitPrice: parseMoney(line.unitPrice, 'Unit price'),
        discount: parseMoney(line.discount, 'Discount'),
        taxRate: taxable ? String(rate) : null,
      });
      indexMap.push(formIndex);
    } catch (err) {
      lineProblems[formIndex] = err.message;
    }
  });

  if (Object.keys(lineProblems).length > 0) return { ok: false, message: 'Fix the highlighted lines to see the total', lineProblems };
  if (inputs.length === 0) return { ok: false, message: 'Add a line to see the total', lineProblems };

  try {
    const result = calculateDocument({ lines: inputs, invoiceDiscount: parseMoney(invoiceDiscount, 'Invoice discount') });
    // Map a per-line result back to its row in the form.
    const byFormIndex = {};
    result.lines.forEach((r, i) => { byFormIndex[indexMap[i]] = r; });
    return { ok: true, lines: byFormIndex, totals: result.totals, lineCount: inputs.length };
  } catch (err) {
    if (!(err instanceof MoneyError)) throw err;
    // calculateDocument names the line as "Line N:" counting only the lines it was given; translate to the form's numbering.
    const message = err.message.replace(/^Line (\d+):/, (_m, n) => `Line ${indexMap[Number(n) - 1] + 1}:`);
    const match = /^Line (\d+):/.exec(message);
    if (match) lineProblems[Number(match[1]) - 1] = message.replace(/^Line \d+: /, '');
    return { ok: false, message: match ? 'Fix the highlighted lines to see the total' : message, lineProblems };
  }
}
