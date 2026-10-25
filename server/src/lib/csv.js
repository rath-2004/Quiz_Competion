import { parse } from 'csv-parse/sync';
import { badRequest } from './errors.js';

/** Parses CSV text into objects keyed by normalised header (lowercase, spaces/dashes → underscores). */
export function parseCsv(text) {
  if (typeof text !== 'string' || text.trim() === '') throw badRequest('CSV file is empty');
  try {
    return parse(text, {
      bom: true,
      columns: (headers) => headers.map((h) => String(h).trim().toLowerCase().replace(/[\s\-/.]+/g, '_')),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw badRequest(`Could not read CSV: ${err.message}`);
  }
}

// Spreadsheet apps execute cells starting with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  // BOM so Excel opens UTF-8 (e.g. Indian-language names) correctly.
  res.send(`﻿${csv}`);
}
