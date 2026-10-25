// CSV files that open correctly in Excel and cannot run formulas.
//
// Text cells that start with = + - @ (or a tab / carriage return) would be run as a formula by a spreadsheet,
// so they get a leading apostrophe. Money is passed as num('1250.50') and written as-is, so a negative amount
// stays a number. A byte-order mark makes Excel read the file as UTF-8 (Nepali names, the रु sign).

const NUMBER = Symbol('csv-number');

/** Marks an exact decimal string ("-12.50") as a number rather than text. */
export const num = (value) => ({ [NUMBER]: String(value) });

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && NUMBER in value) return value[NUMBER];
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** headers: string[]; rows: unknown[][]. */
export function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(cell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
