// Builds Excel versions of the fictional sample, laid out like real exports:
// - GSTR-2B: "Read me" sheet + "B2B" sheet with title rows and a two-row header (as on the GST portal)
// - Purchase register: Tally-style, company title rows on top, a Total row at the bottom
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const dir = __dirname;
const books = E.parseCSV(fs.readFileSync(path.join(dir, 'sample_purchase_register.csv'), 'utf8'));
const twoB = E.parseCSV(fs.readFileSync(path.join(dir, 'sample_gstr2b_oct2026.csv'), 'utf8'));
const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };

(async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Read me').addRow(['Goods and Services Tax - GSTR-2B (fictional sample for testing)']);
  const s = wb.addWorksheet('B2B');
  s.addRow(['Taxable inward supplies received from registered persons']);
  s.addRow([]);
  s.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Invoice details', '', '', '', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value (₹)', 'Tax Amount', '', '', '', 'GSTR-1/IFF/GSTR-5 Period', 'GSTR-1/IFF/GSTR-5 Filing Date', 'ITC Availability', 'Reason', 'Applicable % of Tax Rate']);
  s.addRow(['', '', 'Invoice number', 'Invoice type', 'Invoice Date', 'Invoice Value(₹)', '', '', '', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)', '', '', '', '', '']);
  twoB.forEach((r) => {
    const tx = +r['Taxable Value (₹)'], i = +r['Integrated Tax (₹)'], c = +r['Central Tax (₹)'], st = +r['State/UT Tax (₹)'];
    s.addRow([r['GSTIN of supplier'], r['Trade/Legal name'], r['Invoice number'], 'Regular', d(r['Invoice Date']), tx + i + c + st, 'Karnataka', 'N', tx, i, c, st, 0, 'Oct 2026', d('2026-11-10'), r['ITC Availability'], r.Reason, '']);
  });
  await wb.xlsx.writeFile(path.join(dir, 'sample_gstr2b_portal_style.xlsx'));

  const wb2 = new ExcelJS.Workbook();
  const t = wb2.addWorksheet('Purchase Register');
  t.addRow(['Sunrise Foods Pvt Ltd (fictional)']);
  t.addRow(['Purchase Register']);
  t.addRow(['1-Apr-2026 to 31-Oct-2026']);
  t.addRow([]);
  t.addRow(['Date', 'Particulars', 'Voucher No.', 'GSTIN/UIN', 'Supplier Invoice No.', 'Supplier Invoice Date', 'Purchase Account', 'Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State Tax Amount', 'TDS Section', 'TDS Deducted']);
  let tot = 0;
  books.forEach((r) => {
    tot += +r.taxable_value;
    t.addRow([d(r.invoice_date), r.vendor_name, r.voucher_no, r.vendor_gstin, r.invoice_no, d(r.invoice_date), r.expense_ledger, +r.taxable_value, +r.igst, +r.cgst, +r.sgst, r.tds_section, +r.tds_deducted]);
  });
  t.addRow(['', 'Grand Total', '', '', '', '', '', tot]);
  await wb2.xlsx.writeFile(path.join(dir, 'sample_purchase_register_tally_style.xlsx'));
  console.log('written');
})();
