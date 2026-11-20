// Generates a fictional sample: Sunrise Foods Pvt Ltd (Karnataka), return period Oct 2026.
// Every vendor is invented. GSTINs are built with a valid checksum.
const E = require('../src/engine.js');
const fs = require('fs');
const g = (state, pan, n = '1') => { const s = state + pan + n + 'Z'; return s + E.gstinCheckChar(s); };

const V = {
  annapurna: { name: 'Annapurna Agro Traders', pan: 'AAKFA4821K' },
  coastal: { name: 'Coastal Packaging Pvt Ltd', pan: 'AADCC7310P' },
  shree: { name: 'Shree Logistics', pan: 'BQSPS5528L' },
  blueline: { name: 'BlueLine Advertising LLP', pan: 'AAOFB9034D' },
  kumar: { name: 'Kumar & Associates (Advocates)', pan: 'AAFFK6612M' },
  prime: { name: 'Prime Facility Services Pvt Ltd', pan: 'AAHCP2219Q' },
  brigade: { name: 'Brigade Workspaces Pvt Ltd', pan: 'AAJCB4470R' },
  techserve: { name: 'TechServe IT Solutions Pvt Ltd', pan: 'AAKCT8853H' },
  nandi: { name: 'Nandi Equipment Hire', pan: 'CNHPN3317G' },
  greenleaf: { name: 'GreenLeaf Consultants', pan: 'DGLPG7742B' },
  metro: { name: 'Metro Commission Agents', pan: 'ELMPM1196C' },
  pristine: { name: 'Pristine Stationers', pan: 'AAPFP5503N' },
  bharat: { name: 'Bharat Cold Chain Pvt Ltd', pan: 'AABCB6648J' },
  zen: { name: 'Zen Cloud Software Pvt Ltd', pan: 'AAZCZ2290E' },
  vega: { name: 'Vega Office Supplies', pan: 'AAVFV3381T' },
  delta: { name: 'Delta Chemicals Pvt Ltd', pan: 'AADCD9921W' },
};
for (const k in V) V[k].gstin = g('29', V[k].pan);
V.metro.gstin = g('33', V.metro.pan); // Tamil Nadu supplier
V.zen.gstin = g('27', V.zen.pan); // Maharashtra supplier

const books = [];
const twoB = [];
const intra = (t, rate) => ({ igst: 0, cgst: +(t * rate / 200).toFixed(2), sgst: +(t * rate / 200).toFixed(2) });
const inter = (t, rate) => ({ igst: +(t * rate / 100).toFixed(2), cgst: 0, sgst: 0 });
let vno = 1000;
function book(v, inv, date, taxable, gst, ledger, section = '', tds = 0, over = {}) {
  books.push({ voucher_no: 'PUR-' + (vno++), vendor_name: v.name, vendor_gstin: over.gstin ?? v.gstin ?? '', vendor_pan: over.pan ?? '', invoice_no: inv, invoice_date: date, taxable_value: taxable, ...gst, expense_ledger: ledger, tds_section: section, tds_deducted: tds });
}
function in2B(v, inv, date, taxable, gst, itc = 'Yes', reason = '') {
  twoB.push({ 'GSTIN of supplier': v.gstin, 'Trade/Legal name': v.name, 'Invoice number': inv, 'Invoice Date': date, 'Taxable Value (₹)': taxable, 'Integrated Tax (₹)': gst.igst, 'Central Tax (₹)': gst.cgst, 'State/UT Tax (₹)': gst.sgst, 'ITC Availability': itc, Reason: reason });
}
const both = (v, inv, date, taxable, gst, ledger, section, tds) => { book(v, inv, date, taxable, gst, ledger, section, tds); in2B(v, inv, date, taxable, gst); };

// ---- earlier months (Apr–Sep 2026): feed TDS year-to-date thresholds only ----
['2026-04-12', '2026-05-10', '2026-06-14', '2026-07-11', '2026-08-13', '2026-09-12'].forEach((d, i) =>
  book(V.annapurna, `AAT/${101 + i}/26-27`, d, 800000, intra(800000, 5), 'Raw material purchase'));
book(V.blueline, 'BLA-2026-031', '2026-05-20', 30000, intra(30000, 18), 'Advertising & promotion');
book(V.blueline, 'BLA-2026-058', '2026-07-18', 28000, intra(28000, 18), 'Advertising & promotion');
book(V.blueline, 'BLA-2026-077', '2026-09-16', 25000, intra(25000, 18), 'Advertising & promotion');
book(V.techserve, 'TS/AMC/0712', '2026-07-05', 20000, intra(20000, 18), 'IT support AMC', '194J(a)', 400);

// ---- October 2026 ----
both(V.annapurna, 'AAT/107/26-27', '2026-10-09', 600000, intra(600000, 5), 'Raw material purchase', '', 0); // 194Q crosses 50L
both(V.shree, 'SL-2291', '2026-10-04', 42000, intra(42000, 5), 'Freight inward', '194C', 420);
both(V.bharat, 'BCC/OCT/118', '2026-10-15', 40000, intra(40000, 12), 'Transport - cold chain', '194C', 800);
both(V.pristine, 'PS-5541', '2026-10-06', 12000, intra(12000, 18), 'Office supplies', '', 0);
both(V.kumar, 'KA/26/044', '2026-10-17', 75000, intra(75000, 18), 'Legal fees', '', 0); // 194J(b) missed
both(V.techserve, 'TS/AMC/1014', '2026-10-14', 60000, intra(60000, 18), 'IT support AMC', '194J(a)', 1200);
both(V.nandi, 'NEH-0921', '2026-10-01', 55000, intra(55000, 18), 'Forklift hire (machinery rent)', '', 0); // 194I(a) missed
both(V.zen, 'ZCS-IN-88412', '2026-10-01', 36000, inter(36000, 18), 'Software subscription', '', 0); // no category → review
both(V.blueline, 'BLA-2026-096', '2026-10-21', 25000, intra(25000, 18), 'Advertising & promotion', '', 0); // aggregate crosses 1L

// format differs between books and 2B
book(V.coastal, 'CP/0412/26-27', '2026-10-08', 88000, intra(88000, 18), 'Packing material');
in2B(V.coastal, 'CP-412', '2026-10-08', 88000, intra(88000, 18));
// duplicate booking
both(V.coastal, 'CP/0431/26-27', '2026-10-22', 15000, intra(15000, 18), 'Packing material', '', 0);
book(V.coastal, 'CP/0431/26-27', '2026-10-22', 15000, intra(15000, 18), 'Packing material');
// vendor reported lower value in GSTR-1; TDS deducted at 1% instead of 2%
book(V.prime, 'PFS/OCT/2026/09', '2026-10-31', 120000, intra(120000, 18), 'Housekeeping manpower', '194C', 1200);
in2B(V.prime, 'PFS/OCT/2026/09', '2026-10-31', 108000, intra(108000, 18));
// landlord hasn't filed GSTR-1
book(V.brigade, 'BW/R/2026/10', '2026-10-01', 150000, intra(150000, 18), 'Office rent', '194I(b)', 15000);
// GSTIN typo in books; consultancy booked as 194C
const typo = V.greenleaf.gstin.slice(0, 13) + 'Z' + (V.greenleaf.gstin[14] === 'A' ? 'B' : 'A');
book(V.greenleaf, 'GLC-077', '2026-10-19', 80000, intra(80000, 18), 'Consultancy charges', '194C', 800, { gstin: typo, pan: V.greenleaf.pan });
in2B(V.greenleaf, 'GLC-077', '2026-10-19', 80000, intra(80000, 18));
// ITC blocked in 2B (place of supply); brokerage without TDS
book(V.metro, 'MCA-3310', '2026-10-25', 30000, inter(30000, 18), 'Brokerage on sales', '', 0);
in2B(V.metro, 'MCA-3310', '2026-10-25', 30000, inter(30000, 18), 'No', 'POS and supplier state are same but recipient state is different');
// unregistered contractor, no PAN
book({ name: 'Ravi Kumar (civil contractor)' }, 'Hand bill 14', '2026-10-27', 45000, { igst: 0, cgst: 0, sgst: 0 }, 'Repairs - civil work', '', 0, { gstin: '', pan: '' });
// in 2B, not in books
in2B(V.vega, 'VOS/2210', '2026-10-28', 8000, intra(8000, 18));
in2B(V.delta, 'DC/26/7781', '2026-10-30', 200000, intra(200000, 18));

const bookCols = Object.keys(books[0]);
const twoBCols = Object.keys(twoB[0]);
const csv = (rows, cols) => E.toCSV(rows, cols.map((c) => ({ key: c, label: c })));
fs.writeFileSync(require('path').join(__dirname,'sample_purchase_register.csv'), csv(books, bookCols));
fs.writeFileSync(require('path').join(__dirname,'sample_gstr2b_oct2026.csv'), csv(twoB, twoBCols));
console.log('books', books.length, '2B', twoB.length, 'typo valid?', E.validGSTIN(typo), 'greenleaf valid?', E.validGSTIN(V.greenleaf.gstin));
