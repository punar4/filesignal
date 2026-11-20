// Turns an uploaded file (CSV, XLSX, or GST-portal JSON) into plain row objects.
// Security: content type is decided from the bytes, not the filename; formulas are never
// evaluated (only cached results are read); row/column/sheet counts are capped.
'use strict';
const ExcelJS = require('exceljs');
const E = require('./engine.js');

const LIMITS = { maxRows: 50000, maxCols: 80, maxSheets: 30, maxCellChars: 500 };

class InputError extends Error {}

function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'xls';
  const head = buf.slice(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (/[\x00-\x08\x0e-\x1f]/.test(head)) return 'binary';
  return 'csv';
}

const clean = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  return s.length > LIMITS.maxCellChars ? s.slice(0, LIMITS.maxCellChars) : s;
};

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result); // formula: cached result only, never evaluated
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text); // hyperlink
    if (v.error) return '';
    return '';
  }
  return String(v);
}

// Exports put titles, company names and periods above the real header row.
// Find the row that names the most known columns; merge a second header row if the
// export uses two (the GST portal's 2B Excel does: "Tax Amount" over "Integrated Tax").
function findHeader(grid) {
  const score = (row) => E.fieldsFound(Object.fromEntries(row.map((h, i) => [h || '_' + i, '']))).length;
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const merged = grid[r + 1] ? grid[r].map((h, i) => (h && score([h]) ? h : grid[r + 1][i] || h)) : grid[r];
    const s = Math.max(score(grid[r]), score(merged));
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (best < 0 || bestScore < 3) return null;
  const one = score(grid[best]);
  const merged = grid[best + 1] ? grid[best].map((h, i) => (h && score([h]) ? h : grid[best + 1][i] || h)) : null;
  if (merged && score(merged) > one) return { headers: merged, start: best + 2 };
  return { headers: grid[best], start: best + 1 };
}

function gridToRows(grid) {
  const h = findHeader(grid);
  if (!h) return null;
  const headers = h.headers.map((x, i) => clean(x) || 'col' + (i + 1));
  const rows = [];
  for (let r = h.start; r < grid.length; r++) {
    const line = grid[r];
    if (!line || line.every((c) => !clean(c))) continue;
    if (/^(total|grand total)$/i.test(clean(line[0])) || /^(total|grand total)$/i.test(clean(line[1]))) continue;
    rows.push(Object.fromEntries(headers.map((k, i) => [k, clean(line[i])])));
  }
  return rows;
}

async function readXlsx(buf, prefer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch (e) { throw new InputError('This Excel file could not be opened. Save it again as .xlsx or .csv.'); }
  if (wb.worksheets.length > LIMITS.maxSheets) throw new InputError('Too many sheets in this workbook.');
  const sheets = [...wb.worksheets].sort((a, b) => (prefer.test(b.name) ? 1 : 0) - (prefer.test(a.name) ? 1 : 0));
  for (const ws of sheets) {
    if (ws.rowCount > LIMITS.maxRows + 30) throw new InputError(`Sheet "${ws.name}" has more than ${LIMITS.maxRows} rows.`);
    const grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = [];
      for (let c = 1; c <= Math.min(row.cellCount, LIMITS.maxCols); c++) vals.push(cellText(row.getCell(c).value));
      grid[n - 1] = vals;
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    const rows = gridToRows(grid);
    if (rows) return { rows, sheet: ws.name };
  }
  throw new InputError('No sheet in this workbook has recognisable column names (for example GSTIN, Invoice number, Taxable value).');
}

async function readUpload(buf, kind) {
  if (!buf || !buf.length) throw new InputError('The file is empty.');
  const type = sniff(buf);
  let rows, sheet = null;
  if (type === 'xls' ) throw new InputError('Old .xls files are not supported. Save it as .xlsx or .csv.');
  if (type === 'binary') throw new InputError('This does not look like a CSV, Excel or JSON file.');
  if (type === 'xlsx') ({ rows, sheet } = await readXlsx(buf, kind === '2b' ? /^b2b$/i : /purchase|register|bill/i));
  else if (type === 'json') {
    if (kind !== '2b') throw new InputError('JSON is only accepted for GSTR-2B (the GST portal download).');
    let obj; try { obj = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); } catch (e) { throw new InputError('The JSON file is not valid.'); }
    rows = E.from2BJSON(obj);
    if (!rows.length) throw new InputError('No B2B invoices found in this GSTR-2B JSON.');
  } else {
    const lines = E.parseGrid(buf.toString('utf8'));
    rows = gridToRows(lines);
    if (!rows) throw new InputError('Could not find the column names in this CSV (for example GSTIN, Invoice number, Taxable value).');
  }
  if (rows.length > LIMITS.maxRows) throw new InputError(`More than ${LIMITS.maxRows} rows.`);
  const found = rows.length ? E.fieldsFound(rows[0]) : [];
  const need = ['gstin', 'inv', 'date', 'taxable'];
  const missing = need.filter((f) => !found.includes(f) && !(kind === 'books' && f === 'gstin'));
  if (missing.length) {
    const names = { gstin: 'supplier GSTIN', inv: 'invoice number', date: 'invoice date', taxable: 'taxable value' };
    throw new InputError(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => names[m]).join(', ')}. Found: ${Object.keys(rows[0] || {}).slice(0, 12).join(', ')}.`);
  }
  return { rows, type, sheet };
}

module.exports = { readUpload, sniff, InputError, LIMITS };
