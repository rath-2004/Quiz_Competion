import { stringify } from 'csv-stringify/sync';

// Spreadsheet apps execute cells starting with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

/** columns: [{ header, value: (row) => any }] */
export function toCsv(rows, columns) {
  const records = [columns.map((c) => c.header), ...rows.map((row) => columns.map((c) => safeCell(c.value(row))))];
  return stringify(records);
}

export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  // BOM so Excel opens UTF-8 (e.g. names with non-ASCII characters) correctly.
  res.send(`﻿${csv}`);
}
