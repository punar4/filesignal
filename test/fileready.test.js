'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const E = require('../src/engine.js');
const { readUpload } = require('../src/readers.js');
const { createApp } = require('../src/server.js');
const S = (f) => fs.readFileSync(path.join(__dirname, '..', 'samples', f));
const ASOF = new Date(Date.UTC(2026, 10, 20));

async function serve(env = {}) {
  Object.assign(process.env, env);
  const app = createApp();
  for (const k of Object.keys(env)) delete process.env[k];
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
function fd(books, twoB, extra = {}) {
  const f = new FormData();
  const p = { period: '2026-10', asOf: '2026-11-20', company: 'Test Co', turnover10cr: 'true', ...extra };
  for (const [k, v] of Object.entries(p)) f.append(k, v);
  if (books) f.append('books', new Blob([books[0]]), books[1]);
  if (twoB) f.append('gstr2b', new Blob([twoB[0]]), twoB[1]);
  return f;
}
const XL = () => fd([S('sample_purchase_register_tally_style.xlsx'), 'pr.xlsx'], [S('sample_gstr2b_portal_style.xlsx'), '2b.xlsx']);

test('engine: sample month finds every planted problem with exact amounts', () => {
  const o = E.runAll({ booksRows: E.parseCSV(S('sample_purchase_register.csv').toString()), twoBRows: E.parseCSV(S('sample_gstr2b_oct2026.csv').toString()), period: 202610, asOf: ASOF, buyerTurnoverAbove10Cr: true, company: 'X' });
  assert.equal(o.rec.summary.atRisk, 51660);
  assert.equal(o.rec.summary.claimable, 122220);
  assert.equal(o.tds.summary.short, 29160);
  assert.deepEqual(o.rec.summary.counts, { MATCHED: 10, DUPLICATE: 1, VALUE_MISMATCH: 1, ITC_BLOCKED: 1, MATCHED_FORMAT: 1, MISSING_IN_2B: 1, GSTIN_MISMATCH: 1, NOT_IN_BOOKS: 2 });
  const legal = o.tds.results.find((r) => r.vendor.startsWith('Kumar'));
  assert.equal(legal.section, '194J(b)'); assert.equal(legal.expected, 7500);
  const noPan = o.tds.results.find((r) => r.vendor.startsWith('Ravi'));
  assert.equal(noPan.rate, 20);
});

test('engine: rules on known cases', () => {
  assert.ok(E.validGSTIN('27AAPFU0939F1ZV'));
  assert.ok(!E.validGSTIN('27AAPFU0939F1ZW'));
  assert.equal(E.invCore('CP/0412/26-27'), E.invCore('CP-412'));
  assert.equal(E.classify('Legal fees'), '194J(b)');
  assert.equal(E.classify('Office rent'), '194I(b)');
});

test('readers: Tally-style and portal-style Excel give the same result as CSV', async () => {
  const b = await readUpload(S('sample_purchase_register_tally_style.xlsx'), 'books');
  const t = await readUpload(S('sample_gstr2b_portal_style.xlsx'), '2b');
  assert.equal(t.sheet, 'B2B');
  assert.equal(b.rows.length, 27); // Grand Total row skipped
  const o = E.runAll({ booksRows: b.rows, twoBRows: t.rows, period: 202610, asOf: ASOF, buyerTurnoverAbove10Cr: true, company: '' });
  assert.equal(o.rec.summary.atRisk, 51660);
  assert.equal(o.tds.summary.short, 29160);
});

test('readers: rejects disguised or unusable files', async () => {
  await assert.rejects(readUpload(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'books'), /does not look like/);
  await assert.rejects(readUpload(Buffer.alloc(0), 'books'), /empty/);
  await assert.rejects(readUpload(Buffer.from('PK\x03\x04garbage'), 'books'), /could not be opened/);
  await assert.rejects(readUpload(Buffer.from('{"a":1}'), 'books'), /only accepted for GSTR-2B/);
  await assert.rejects(readUpload(Buffer.from('foo,bar\n1,2'), 'books'), /column names/);
});

test('readers: formulas in uploaded Excel are never evaluated', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('B2B');
  ws.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Invoice number', 'Invoice Date', 'Taxable Value', 'Integrated Tax']);
  ws.addRow(['27AAPFU0939F1ZV', { formula: 'WEBSERVICE("http://evil")', result: 'Acme' }, 'A1', '2026-10-02', 100, 18]);
  const r = await readUpload(Buffer.from(await wb.xlsx.writeBuffer()), '2b');
  assert.equal(r.rows[0]['Trade/Legal name'], 'Acme');
});

test('api: check and Excel report work end to end', async () => {
  const s = await serve();
  try {
    const res = await fetch(s.url + '/api/check', { method: 'POST', body: XL() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const j = await res.json();
    assert.equal(j.rec.summary.atRisk, 51660);
    assert.ok(j.fix.length >= 10);
    const rep = await fetch(s.url + '/api/report', { method: 'POST', body: XL() });
    assert.equal(rep.status, 200);
    const buf = Buffer.from(await rep.arrayBuffer());
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Fix list', 'GST vs 2B', 'TDS check', 'Supplier emails', 'Deadlines']);
  } finally { s.close(); }
});

test('api: formula injection in vendor names is neutralised in the Excel report', async () => {
  const csv = 'vendor_name,vendor_gstin,invoice_no,invoice_date,taxable_value,igst,expense_ledger\n"=HYPERLINK(""http://evil"",""x"")",27AAPFU0939F1ZV,INV1,2026-10-05,1000,180,Office supplies\n';
  const two = 'GSTIN of supplier,Trade/Legal name,Invoice number,Invoice Date,Taxable Value,Integrated Tax\n';
  const s = await serve();
  try {
    const rep = await fetch(s.url + '/api/report', { method: 'POST', body: fd([csv, 'b.csv'], [two + '27AAPFU0939F1ZV,X,ZZ9,2026-10-01,5,1\n', '2b.csv']) });
    assert.equal(rep.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await rep.arrayBuffer()));
    const ws = wb.getWorksheet('GST vs 2B');
    const vals = []; ws.eachRow((row) => row.eachCell((c) => vals.push(c.value)));
    assert.ok(vals.some((v) => typeof v === 'string' && v.startsWith("'=HYPERLINK")));
    assert.ok(!vals.some((v) => v && typeof v === 'object' && v.formula));
  } finally { s.close(); }
});

test('api: input validation and upload limits', async () => {
  const s = await serve({ MAX_FILE_MB: '1' });
  try {
    const post = (body) => fetch(s.url + '/api/check', { method: 'POST', body });
    assert.equal((await post(fd(null, null))).status, 400);
    assert.equal((await post(fd([S('sample_purchase_register.csv'), 'evil.exe'], [S('sample_gstr2b_oct2026.csv'), '2b.csv']))).status, 400);
    assert.equal((await post(fd([Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3, 4]), 'fake.csv'], [S('sample_gstr2b_oct2026.csv'), '2b.csv']))).status, 400);
    assert.equal((await post(fd([Buffer.alloc(2 * 1024 * 1024, 65), 'big.csv'], [S('sample_gstr2b_oct2026.csv'), '2b.csv']))).status, 400);
    const bad = await post(fd([S('sample_purchase_register.csv'), 'a.csv'], [S('sample_gstr2b_oct2026.csv'), 'b.csv'], { period: '2026-13' }));
    assert.equal(bad.status, 400); assert.match((await bad.json()).error, /Return period/);
    const r500 = await post(fd([S('sample_purchase_register.csv'), 'a.csv'], [S('sample_gstr2b_oct2026.csv'), 'b.csv'], { asOf: "2026-11-20'; DROP" }));
    assert.equal(r500.status, 400);
  } finally { s.close(); }
});

test('api: optional access key protects the API', async () => {
  const s = await serve({ ACCESS_KEY: 'secret-key-123' });
  try {
    assert.equal((await fetch(s.url + '/api/check', { method: 'POST', body: XL() })).status, 401);
    assert.equal((await fetch(s.url + '/api/check', { method: 'POST', body: XL(), headers: { 'x-access-key': 'wrong' } })).status, 401);
    assert.equal((await fetch(s.url + '/api/check', { method: 'POST', body: XL(), headers: { 'x-access-key': 'secret-key-123' } })).status, 200);
  } finally { s.close(); }
});

test('api: rate limit kicks in', async () => {
  const s = await serve({ RATE_LIMIT: '3' });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(s.url + '/api/check', { method: 'POST', body: fd(null, null) })).status);
    assert.ok(codes.includes(429), String(codes));
  } finally { s.close(); }
});

test('web: security headers, no path traversal, no stack traces', async () => {
  const s = await serve();
  try {
    const r = await fetch(s.url + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
    for (const p of ['/samples/..%2Fsrc%2Fserver.js', '/samples/../src/server.js', '/../src/server.js', '/src/server.js', '/package.json']) {
      const x = await fetch(s.url + p); assert.notEqual(x.status, 200, p);
    }
    assert.equal((await fetch(s.url + '/samples/gstr2b.xlsx')).status, 200);
  } finally { s.close(); }
});
