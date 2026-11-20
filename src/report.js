// Builds the downloadable Excel workpaper. Every text cell is written as a plain string
// with formula-like starts neutralised, so a malicious vendor name can't run in Excel.
'use strict';
const ExcelJS = require('exceljs');

const LABEL = {
  MATCHED: 'Matched', MATCHED_FORMAT: 'Matched (format)', VALUE_MISMATCH: 'Value differs', MISSING_IN_2B: 'Not in 2B',
  GSTIN_MISMATCH: 'GSTIN differs', DUPLICATE: 'Duplicate in books', ITC_BLOCKED: 'ITC not available', NOT_IN_BOOKS: 'Not in books',
  OK: 'OK', NOT_DEDUCTED: 'Not deducted', SHORT: 'Short', EXCESS: 'Excess', REVIEW: 'Review',
};
const safe = (v) => {
  if (typeof v === 'number') return v;
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
};
const MONEY = '#,##,##0.00;[Red]-#,##,##0.00;"–"';

function sheet(wb, name, cols, rows, moneyKeys = []) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: c.width || 14 }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(cols.map((c) => [c.key, safe(typeof c.get === 'function' ? c.get(r) : r[c.key])]))));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101418' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (moneyKeys.includes(c.key)) col.numFmt = MONEY;
    if (c.wrap) col.alignment = { wrapText: true, vertical: 'top' };
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

async function buildWorkbook(out) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FileSignal Ready';
  wb.created = new Date();
  const { meta, rec, tds, cal, mails, fix } = out;

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 46 }, { width: 22 }];
  const lines = [
	  ['FileSignal Ready: GST and TDS check', ''],
    ['Company', safe(meta.company || '')],
    ['Return period', meta.monthName],
    ['Checked as on', meta.asOf],
    ['', ''],
    ['ITC in books (this period)', rec.summary.booksTax],
    ['ITC claimable in GSTR-3B', rec.summary.claimable],
    ['ITC on hold', rec.summary.atRisk],
    ['TDS short or not deducted', tds.summary.short],
    ['Interest on TDS so far', tds.summary.interest],
    ['Expense at risk of 30% disallowance', tds.summary.disallowance],
    ['Items to fix', fix.length],
    ['', ''],
    ['Every figure comes from a written rule; the reason is in each sheet. Working aid, not tax advice.', ''],
  ];
  lines.forEach((l) => sum.addRow(l));
  sum.getRow(1).font = { bold: true, size: 14 };
  sum.mergeCells('A14:E14');
  sum.getCell('A14').alignment = { wrapText: true, vertical: 'top' };
  sum.getRow(14).height = 32;
  sum.getCell('A14').font = { italic: true, color: { argb: 'FF5B6673' } };
  for (let r = 6; r <= 11; r++) sum.getCell(r, 2).numFmt = MONEY;
  sum.getCell(8, 1).fill = sum.getCell(8, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD84A' } };

  sheet(wb, 'Fix list', [
    { key: 'n', label: '#', width: 5, get: (r) => fix.indexOf(r) + 1 }, { key: 'area', label: 'Area', width: 7 },
    { key: 'title', label: 'What to do', width: 60, wrap: true }, { key: 'detail', label: 'Why', width: 70, wrap: true },
    { key: 'by', label: 'By', width: 24 }, { key: 'amount', label: 'Amount (₹)', width: 16 },
  ], fix, ['amount']);

  sheet(wb, 'GST vs 2B', [
    { key: 'status', label: 'Status', width: 18, get: (r) => LABEL[r.status] }, { key: 'vendor', label: 'Vendor', width: 30 },
    { key: 'gstin', label: 'GSTIN', width: 18 }, { key: 'invBooks', label: 'Invoice (books)', width: 18 }, { key: 'inv2B', label: 'Invoice (2B)', width: 18 },
    { key: 'date', label: 'Date', width: 12 }, { key: 'taxBooks', label: 'Tax in books', width: 14 }, { key: 'tax2B', label: 'Tax in 2B', width: 14 },
    { key: 'claimable', label: 'Claimable', width: 14 }, { key: 'atRisk', label: 'On hold', width: 14 }, { key: 'reason', label: 'Why', width: 80, wrap: true },
  ], rec.results, ['taxBooks', 'tax2B', 'claimable', 'atRisk']);

  sheet(wb, 'TDS check', [
    { key: 'status', label: 'Status', width: 14, get: (r) => LABEL[r.status] }, { key: 'vendor', label: 'Vendor', width: 30 }, { key: 'pan', label: 'PAN', width: 12 },
    { key: 'date', label: 'Date', width: 12 }, { key: 'inv', label: 'Invoice', width: 16 }, { key: 'ledger', label: 'Ledger', width: 26 },
    { key: 'section', label: 'Old section', width: 10 }, { key: 'newRef', label: 'Income-tax Act 2025', width: 22 }, { key: 'amount', label: 'Amount', width: 14 },
    { key: 'rate', label: 'Rate %', width: 8 }, { key: 'expected', label: 'Should deduct', width: 14 }, { key: 'deducted', label: 'Deducted', width: 12 },
    { key: 'short', label: 'Short', width: 12 }, { key: 'interest', label: 'Interest', width: 10 }, { key: 'disallowance', label: '30% disallowance risk', width: 14 },
    { key: 'note', label: 'Why', width: 80, wrap: true },
  ], tds.results, ['amount', 'expected', 'deducted', 'short', 'interest', 'disallowance']);

  sheet(wb, 'Supplier emails', [
    { key: 'vendor', label: 'Supplier', width: 30 }, { key: 'gstin', label: 'GSTIN', width: 18 }, { key: 'total', label: 'ITC on hold', width: 14 },
    { key: 'subject', label: 'Subject', width: 50, wrap: true }, { key: 'body', label: 'Email', width: 90, wrap: true },
  ], mails, ['total']);

  sheet(wb, 'Deadlines', [
    { key: 'date', label: 'Date', width: 12 }, { key: 'what', label: 'What', width: 56, wrap: true },
    { key: 'law', label: 'Under', width: 30 }, { key: 'late', label: 'If late', width: 44, wrap: true },
  ], cal);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
