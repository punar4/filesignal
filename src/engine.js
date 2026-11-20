// FileReady engine: GSTR-2B reconciliation, TDS check, compliance calendar.
// Deterministic rules only. Every output row carries the reason it was produced.
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const CP = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const num = (v) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd-mm-yyyy (Indian)
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
    }
    m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-](\d{2,4})$/); // 05-Oct-2026
    if (m) {
      const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3;
      let y = +m[3]; if (y < 100) y += 2000;
      if (mon >= 0) return new Date(Date.UTC(y, mon, +m[1]));
    }
    return null;
  }
  const fmtDate = (d) => d ? d.toISOString().slice(0, 10) : '';
  const ymKey = (d) => d ? d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1) : 0;
  // Indian financial (tax) year start: April
  const fyOf = (d) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

  function gstinCheckChar(first14) {
    let f = 2, sum = 0;
    for (let i = first14.length - 1; i >= 0; i--) {
      let a = f * CP.indexOf(first14[i]);
      f = f === 2 ? 1 : 2;
      a = Math.floor(a / 36) + (a % 36);
      sum += a;
    }
    return CP[(36 - (sum % 36)) % 36];
  }
  function validGSTIN(g) {
    if (!g) return false;
    g = String(g).toUpperCase().trim();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
    return gstinCheckChar(g.slice(0, 14)) === g[14];
  }
  const validPAN = (p) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(p || '').toUpperCase().trim());

  // PAN 4th character → holder type. Individual/HUF get the lower contractor rate.
  const PAN_TYPES = { P: 'Individual', H: 'HUF', C: 'Company', F: 'Firm/LLP', A: 'AOP', T: 'Trust', B: 'BOI', L: 'Local authority', J: 'Artificial juridical person', G: 'Government' };

  // Invoice number normalisation: suppliers and bookkeepers write the same invoice differently.
  function normInv(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function invCore(s) {
    // drop financial-year fragments (2026-27, 26-27, FY27) and leading zeros, keep alnum core
    let t = String(s || '').toUpperCase();
    t = t.replace(/(FY)?\s*20\d{2}\s*[-\/]\s*(20)?\d{2}/g, ' ').replace(/\bFY\s*\d{2,4}\b/g, ' ');
    t = t.replace(/(\d{2})\s*[-\/]\s*(\d{2})\s*$/, (m, a, b) => (+b === +a + 1 ? ' ' : m)); // trailing 26-27
    t = t.replace(/[^A-Z0-9]/g, ' ').trim();
    const digits = (t.match(/\d+/g) || []).map((d) => String(parseInt(d, 10)));
    const letters = t.replace(/[^A-Z]/g, '');
    return letters + '|' + digits.join('-');
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = parseGrid(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  function parseGrid(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }
  function toCSV(rows, cols) {
    const esc = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map((c) => esc(c.label)).join(',')].concat(rows.map((r) => cols.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))).join('\n');
  }

  // Header aliases so a Tally / Zoho export or the GST portal's 2B Excel (saved as CSV) loads as-is.
  const ALIASES = {
    gstin: ['gst identification number (gstin)', 'supplier gstin/uin', 'gstin', 'vendor_gstin', 'supplier_gstin', 'gstin of supplier', 'gstin/uin of supplier', 'party gstin', 'gstin/uin', 'ctin'],
    vendor: ['vendor name', 'supplier name', 'party a/c name', 'vendor', 'vendor_name', 'supplier_name', 'party name', 'party', 'trade/legal name', 'trade name', 'legal name', 'particulars', 'trdnm'],
    pan: ['pan', 'vendor_pan', 'party pan', 'pan no'],
    inv: ['supplier invoice no.', 'supplier invoice no', 'bill number', 'bill#', 'invoice_no', 'invoice number', 'invoice no', 'inv no', 'bill no', 'supplier invoice no', 'reference no', 'inum'],
    date: ['supplier invoice date', 'invoice_date', 'invoice date', 'bill date', 'date', 'dt'],
    taxable: ['sub total', 'subtotal', 'taxable', 'taxable_value', 'taxable value', 'taxable value (₹)', 'taxable amount', 'assessable value', 'txval', 'value'],
    igst: ['integrated tax amount', 'igst amt', 'igst', 'integrated tax', 'integrated tax (₹)', 'igst amount'],
    cgst: ['central tax amount', 'cgst amt', 'cgst', 'central tax', 'central tax (₹)', 'cgst amount'],
    sgst: ['state tax amount', 'state/ut tax amount', 'sgst amt', 'sgst', 'state/ut tax', 'state/ut tax (₹)', 'sgst amount', 'sgst/utgst'],
    cess: ['cess', 'cess (₹)', 'cess amount'],
    ledger: ['account name', 'purchase account', 'expense_ledger', 'ledger', 'expense head', 'account', 'nature', 'purchase ledger', 'nature of expense'],
    section: ['tds_section', 'tds section', 'section', 'tds nature'],
    tds: ['tds_deducted', 'tds deducted', 'tds amount', 'tds'],
    itcavl: ['itc_availability', 'itc availability', 'itc available', 'itcavl'],
    reason: ['reason', 'rsn'],
    voucher: ['voucher no.', 'voucher_no', 'voucher no', 'vch no', 'voucher'],
  };
  const nk = (s) => String(s).toLowerCase().replace(/₹|\(rs\.?\)|rs\./g, '').replace(/[^a-z0-9]/g, '');
  function pick(row, field) {
    const keys = Object.keys(row).map((k) => [nk(k), k]);
    for (const a of ALIASES[field]) {
      const hit = keys.find(([n]) => n === nk(a));
      if (hit && row[hit[1]] !== '') return row[hit[1]];
    }
    return '';
  }
  function fieldsFound(row) { return Object.keys(ALIASES).filter((f) => Object.keys(row).some((k) => ALIASES[f].some((a) => nk(a) === nk(k)))); }

  function normalizeBooks(rows) {
    return rows.map((r, i) => {
      const gstin = String(pick(r, 'gstin')).toUpperCase().trim();
      let pan = String(pick(r, 'pan')).toUpperCase().trim();
      let panSource = pan ? 'register' : '';
      if (!pan && gstin.length === 15) { pan = gstin.slice(2, 12); panSource = 'from GSTIN'; }
      const d = parseDate(pick(r, 'date'));
      return {
        row: i + 2, voucher: pick(r, 'voucher'), vendor: pick(r, 'vendor'), gstin, pan, panSource,
        inv: pick(r, 'inv'), date: d, taxable: r2(num(pick(r, 'taxable'))),
        igst: r2(num(pick(r, 'igst'))), cgst: r2(num(pick(r, 'cgst'))), sgst: r2(num(pick(r, 'sgst'))), cess: r2(num(pick(r, 'cess'))),
        ledger: pick(r, 'ledger'), section: String(pick(r, 'section')).trim(), tds: r2(num(pick(r, 'tds'))),
      };
    });
  }
  function normalize2B(rows) {
    return rows.map((r, i) => ({
      row: i + 2, vendor: pick(r, 'vendor'), gstin: String(pick(r, 'gstin')).toUpperCase().trim(), inv: pick(r, 'inv'),
      date: parseDate(pick(r, 'date')), taxable: r2(num(pick(r, 'taxable'))),
      igst: r2(num(pick(r, 'igst'))), cgst: r2(num(pick(r, 'cgst'))), sgst: r2(num(pick(r, 'sgst'))), cess: r2(num(pick(r, 'cess'))),
      itcavl: (String(pick(r, 'itcavl') || 'Yes').trim().toUpperCase()[0] || 'Y') !== 'N',
      reason: pick(r, 'reason'),
    }));
  }
  // GST portal GSTR-2B JSON (data.docdata.b2b[].inv[])
  function from2BJSON(obj) {
    const d = obj && (obj.data || obj);
    const b2b = (d && d.docdata && d.docdata.b2b) || [];
    const out = [];
    b2b.forEach((s) => (s.inv || []).forEach((v) => out.push({
      gstin: s.ctin, vendor: s.trdnm, inum: v.inum, dt: v.dt, txval: v.txval, igst: v.igst, cgst: v.cgst, sgst: v.sgst, cess: v.cess, itcavl: v.itcavl, rsn: v.rsn,
    })));
    return out.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === undefined ? '' : String(v)])));
  }

  const taxOf = (x) => r2(x.igst + x.cgst + x.sgst + x.cess);

  // ---------- GSTR-2B reconciliation ----------
  function reconcile(booksAll, twoB, opts) {
    const period = opts.period; // YYYYMM of the return period
    const tol = opts.tolerance ?? 1;
    const books = booksAll.filter((b) => b.gstin && taxOf(b) > 0 && ymKey(b.date) === period);
    const results = [];
    const used2B = new Set();

    // duplicates in books (same GSTIN + invoice booked twice)
    const seen = new Map();
    const dupes = new Set();
    books.forEach((b, i) => {
      const k = b.gstin + '#' + normInv(b.inv);
      if (seen.has(k)) dupes.add(i); else seen.set(k, i);
    });

    const by2B = new Map();
    twoB.forEach((t, j) => {
      const k = t.gstin + '#' + normInv(t.inv);
      if (!by2B.has(k)) by2B.set(k, j);
    });

    const pending = [];
    books.forEach((b, i) => {
      if (dupes.has(i)) {
        results.push(mk('DUPLICATE', b, null, `Invoice ${b.inv} from this GSTIN is booked twice. Claiming both would double the ITC.`, taxOf(b)));
        return;
      }
      const j = by2B.get(b.gstin + '#' + normInv(b.inv));
      if (j !== undefined && !used2B.has(j)) { used2B.add(j); results.push(compare(b, twoB[j], 'exact')); }
      else pending.push(b);
    });

    // pass 2: same GSTIN, invoice number written differently
    const pending2 = [];
    pending.forEach((b) => {
      let best = -1, bestScore = 1e9;
      twoB.forEach((t, j) => {
        if (used2B.has(j) || t.gstin !== b.gstin) return;
        const sameCore = invCore(t.inv) === invCore(b.inv);
        const d = lev(normInv(t.inv), normInv(b.inv));
        const close = sameCore || (d <= 1 && Math.max(normInv(t.inv).length, 1) >= 4);
        const amtOk = Math.abs(t.taxable - b.taxable) <= Math.max(tol, 0.02 * b.taxable);
        if (close && amtOk) { const s = sameCore ? 0 : d; if (s < bestScore) { best = j; bestScore = s; } }
      });
      if (best >= 0) { used2B.add(best); results.push(compare(b, twoB[best], 'fuzzy')); }
      else pending2.push(b);
    });

    // pass 3: same invoice + amount but a different GSTIN (typo in books, or vendor's other branch)
    pending2.forEach((b) => {
      let hit = -1;
      twoB.forEach((t, j) => {
        if (hit >= 0 || used2B.has(j)) return;
        if (invCore(t.inv) === invCore(b.inv) && Math.abs(taxOf(t) - taxOf(b)) <= tol && t.gstin.slice(2, 12) === b.gstin.slice(2, 12)) hit = j;
        else if (invCore(t.inv) === invCore(b.inv) && Math.abs(taxOf(t) - taxOf(b)) <= tol && lev(t.gstin, b.gstin) <= 2) hit = j;
      });
      if (hit >= 0) {
        used2B.add(hit);
        const t = twoB[hit];
        results.push(mk('GSTIN_MISMATCH', b, t, `Same invoice and tax found in 2B under GSTIN ${t.gstin}, but books have ${b.gstin}${validGSTIN(b.gstin) ? '' : ' (which fails the GSTIN checksum, likely a typo)'}. Correct the vendor master before claiming.`, taxOf(b)));
        return;
      }
      results.push(mk('MISSING_IN_2B', b, null, 'Not in GSTR-2B. The supplier has not reported it in GSTR-1/IFF (or it is pending/rejected in IMS). Since Apr 2026, 3B cannot claim ITC above 2B, so hold this ITC and chase the supplier.', taxOf(b)));
    });

    // 2B lines with no books entry
    twoB.forEach((t, j) => {
      if (used2B.has(j)) return;
      results.push(mk('NOT_IN_BOOKS', null, t, 'In GSTR-2B but not in the purchase register. Either the purchase is unrecorded (book it) or it is not yours (reject it in IMS before filing 3B).', 0, taxOf(t)));
    });

    function compare(b, t, how) {
      const note = how === 'fuzzy' ? ` Invoice number differs in format (books "${b.inv}", 2B "${t.inv}").` : '';
      if (!t.itcavl) return mk('ITC_BLOCKED', b, t, `2B marks ITC as not available${t.reason ? ' (' + t.reason + ')' : ''}. Do not claim.` + note, taxOf(b));
      const dTax = r2(taxOf(b) - taxOf(t));
      const dTaxable = r2(b.taxable - t.taxable);
      if (Math.abs(dTax) <= tol && Math.abs(dTaxable) <= Math.max(tol, 1)) {
        return mk(how === 'fuzzy' ? 'MATCHED_FORMAT' : 'MATCHED', b, t, how === 'fuzzy' ? 'Matched.' + note : 'Matched.', 0);
      }
      const atRisk = dTax > 0 ? dTax : 0;
      const kind = (b.igst > 0) !== (t.igst > 0) ? ' Books and 2B disagree on IGST vs CGST+SGST (place of supply).' : '';
      return mk('VALUE_MISMATCH', b, t, `Tax in books ₹${fmtINR(taxOf(b))} vs 2B ₹${fmtINR(taxOf(t))}.${kind}${dTax > 0 ? ' Claim only the 2B amount until the supplier amends (GSTR-1A).' : ' 2B shows more than books; check for a missed debit note or booking error.'}` + note, atRisk);
    }
    function mk(status, b, t, reason, atRisk, extra) {
      return {
        status, reason, atRisk: r2(atRisk), extraIn2B: r2(extra || 0),
        vendor: (b && b.vendor) || (t && t.vendor) || '', gstin: (b && b.gstin) || (t && t.gstin) || '',
        invBooks: b ? b.inv : '', inv2B: t ? t.inv : '', date: fmtDate((b && b.date) || (t && t.date)),
        taxBooks: b ? taxOf(b) : 0, tax2B: t ? taxOf(t) : 0, taxable: b ? b.taxable : t.taxable,
        claimable: status === 'MATCHED' || status === 'MATCHED_FORMAT' ? (b ? taxOf(b) : 0) : status === 'VALUE_MISMATCH' ? Math.min(taxOf(b), taxOf(t)) : 0,
        gstinValid: validGSTIN((b && b.gstin) || (t && t.gstin)),
      };
    }

    const sum = (f) => r2(results.reduce((a, r) => a + f(r), 0));
    const summary = {
      booksTax: sum((r) => r.taxBooks), twoBTax: sum((r) => r.tax2B), claimable: sum((r) => r.claimable), atRisk: sum((r) => r.atRisk),
      counts: results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}), lines: results.length,
    };
    return { results, summary };
  }

  // ---------- TDS check (Income-tax Act 2025, s.393 — legacy sections kept for familiarity) ----------
  // Rates & thresholds for tax year 2026-27. Payment codes intentionally omitted: published mappings disagree; pick from the RPU master.
  const TDS_RULES = {
    '194C': { name: 'Contractor / work (incl. manpower)', newRef: '393(1) Table Sl. 6(i)', rateIndHuf: 1, rateOther: 2, single: 30000, aggregate: 100000 },
    '194J(a)': { name: 'Technical services', newRef: '393(1) Table Sl. 6(iii)', rate: 2, aggregate: 50000 },
    '194J(b)': { name: 'Professional services', newRef: '393(1) Table Sl. 6(iii)', rate: 10, aggregate: 50000 },
    '194H': { name: 'Commission / brokerage', newRef: '393(1) Table Sl. 1(ii)', rate: 2, aggregate: 20000 },
    '194I(a)': { name: 'Rent – plant & machinery', newRef: '393(1) Table Sl. 2(ii)', rate: 2, monthly: 50000 },
    '194I(b)': { name: 'Rent – land & building', newRef: '393(1) Table Sl. 2(ii)', rate: 10, monthly: 50000 },
    '194Q': { name: 'Purchase of goods', newRef: '393(1) Table Sl. 8(ii)', rate: 0.1, excessOver: 5000000 },
  };
  const NO_PAN_RATE = 20;

  const KEYWORDS = [
    ['194I(a)', /(rent|hire|lease).*(machine|equipment|plant|generator|forklift|crane)|(machine|equipment|plant).*(rent|hire|lease)/i],
    ['194I(b)', /(rent|lease).*(office|premises|building|warehouse|godown|shop|land|space)|office rent|warehouse rent|^rent$/i],
    ['194H', /commission|brokerage/i],
    ['194J(b)', /legal|lawyer|advocate|audit fee|professional|consult|chartered|\bca fee|architect|medical|valuer|company secretary/i],
    ['194J(a)', /technical|it support|software (maintenance|support|implementation)|call cent|data processing|annual maintenance|\bamc\b/i],
    ['194C', /contract|job ?work|manpower|housekeeping|security|cleaning|catering|printing|advertis|transport|freight|courier|logistics|labour|repair|civil work|event/i],
    ['SOFTWARE', /software (licen|subscription)|saas|cloud subscription/i],
    ['194Q', /raw material|purchase of goods|stock purchase|trading goods|packing material|stationery|office supplies|consumables|purchase/i],
  ];
  function classify(ledger) {
    for (const [sec, re] of KEYWORDS) if (re.test(ledger || '')) return sec;
    return null;
  }
  function normSection(s) {
    s = String(s || '').toUpperCase().replace(/\s+/g, '');
    if (!s) return null;
    if (/^194C/.test(s) || /6\(I\)$/.test(s)) return '194C';
    if (/^194J\(?A\)?/.test(s)) return '194J(a)';
    if (/^194J/.test(s)) return '194J(b)';
    if (/^194H/.test(s)) return '194H';
    if (/^194I\(?A\)?/.test(s)) return '194I(a)';
    if (/^194I/.test(s)) return '194I(b)';
    if (/^194Q/.test(s)) return '194Q';
    if (/^NO|^NA|^NIL/.test(s)) return 'NONE';
    return null;
  }
  // "Month or part of a month" counting used for TDS interest
  function monthsOrPart(from, to) {
    if (!from || !to || to < from) return 0;
    let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    if (to.getUTCDate() >= from.getUTCDate()) m += 1;
    return Math.max(m, 1);
  }

  function tdsCheck(booksAll, opts) {
    const asOf = opts.asOf;
    const periodEnd = new Date(Date.UTC(Math.floor(opts.period / 100), opts.period % 100, 0));
    const fy = fyOf(periodEnd);
    const buyerTurnoverAbove10Cr = !!opts.buyerTurnoverAbove10Cr;
    const rows = booksAll.filter((b) => b.date && fyOf(b.date) === fy && b.date <= periodEnd && b.taxable > 0);

    // classify each line
    const lines = rows.map((b) => {
      const booked = normSection(b.section);
      const inferred = classify(b.ledger);
      const sec = booked && booked !== 'NONE' ? booked : inferred;
      const conflict = booked && booked !== 'NONE' && inferred && TDS_RULES[inferred] && inferred !== booked;
      return { b, booked, inferred, sec, conflict: !!conflict && inferred !== '194Q' };
    });

    // aggregate per vendor (PAN, else name) per section for the tax year
    const vkey = (b) => (b.pan || b.vendor.toUpperCase());
    const agg = new Map();
    lines.forEach((l) => {
      if (!l.sec) return;
      const k = vkey(l.b) + '|' + l.sec;
      agg.set(k, r2((agg.get(k) || 0) + l.b.taxable));
    });
    const rentMonth = new Map();
    lines.forEach((l) => {
      if (!l.sec || !l.sec.startsWith('194I')) return;
      const k = vkey(l.b) + '|' + l.sec + '|' + ymKey(l.b.date);
      rentMonth.set(k, r2((rentMonth.get(k) || 0) + l.b.taxable));
    });

    // 194Q: TDS only on purchases from a seller above ₹50 lakh in the year; walk in date order
    const q194 = new Map();

    // conflicting lines also count toward the inferred section's aggregate
    lines.forEach((l) => {
      if (!l.conflict) return;
      const k = vkey(l.b) + '|' + l.inferred;
      agg.set(k, r2((agg.get(k) || 0) + l.b.taxable));
    });

    // date on which a vendor's year-to-date total first crossed the section's threshold
    const crossed = new Map();
    const running = new Map();
    lines.slice().sort((a, b) => a.b.date - b.b.date).forEach((l) => {
      [l.sec, l.conflict ? l.inferred : null].forEach((sec) => {
        const rule = sec && TDS_RULES[sec];
        if (!rule || !rule.aggregate) return;
        const k = vkey(l.b) + '|' + sec;
        const run = r2((running.get(k) || 0) + l.b.taxable);
        running.set(k, run);
        if (run > rule.aggregate && !crossed.has(k)) crossed.set(k, l.b.date);
      });
    });

    const out = [];
    lines.sort((a, b) => a.b.date - b.b.date).forEach((l) => {
      const b = l.b;
      const panOk = validPAN(b.pan);
      const panType = panOk ? (PAN_TYPES[b.pan[3]] || 'Other') : 'No PAN';
      let ev = evaluate(l, l.sec);
      if (l.conflict) {
        const alt = evaluate(l, l.inferred);
        if (alt.expected > ev.expected) {
          alt.notes.unshift(`Booked as ${l.booked}, but the ledger "${b.ledger}" reads as ${TDS_RULES[l.inferred].name} (${l.inferred}); computed under ${l.inferred} because it gives the higher deduction.`);
          ev = alt;
        } else ev.notes.push(`Ledger "${b.ledger}" also reads as ${l.inferred}; confirm the section.`);
      }
      const { expected, rate, rule, notes, sec, base, from } = ev;

      const short = r2(Math.max(0, expected - b.tds));
      const excess = r2(Math.max(0, b.tds - expected));
      const months = short > 0 ? monthsOrPart(from || b.date, asOf) : 0;
      const interest = r2(short * 0.01 * months);
      let status = 'OK';
      if (!rule) status = l.booked === 'NONE' ? 'OK' : 'REVIEW';
      else if (short > 0.5 && b.tds === 0) status = 'NOT_DEDUCTED';
      else if (short > 0.5) status = 'SHORT';
      else if (excess > 0.5) status = 'EXCESS';
      if (l.conflict && status === 'OK') status = 'REVIEW';
      out.push({
        status, vendor: b.vendor, pan: panOk ? b.pan : '', panType, date: fmtDate(b.date), inv: b.inv, ledger: b.ledger,
        section: rule ? sec : '', sectionName: rule ? rule.name : '', newRef: rule ? rule.newRef : '', booked: b.section,
        amount: b.taxable, rate, expected, deducted: b.tds, short, excess, months, interest,
        disallowance: status === 'NOT_DEDUCTED' ? r2((base || 0) * 0.3) : 0, deductibleFrom: fmtDate(from || b.date),
        inPeriod: ymKey(b.date) === opts.period, note: notes.join(' '),
      });
    });

    function evaluate(l, sec) {
      const b = l.b;
      const notes = [];
      let expected = 0, rate = 0, applies = false, base = 0, from = b.date;
      const rule = sec && sec !== 'NONE' ? TDS_RULES[sec] : null;
      const panOk = validPAN(b.pan);
      if (!rule) {
        notes.push(l.booked === 'NONE' ? 'Booked as no-TDS.' : sec === 'SOFTWARE' ? 'Software licence/subscription: may be royalty under 194J (393(1) Sl. 6(iii)) or a goods purchase. Needs a judgement call.' : 'No TDS category recognised from the ledger. Review manually.');
      } else {
        rate = rule.rate ?? ((b.pan[3] === 'P' || b.pan[3] === 'H') ? rule.rateIndHuf : rule.rateOther);
        const key = vkey(b) + '|' + sec;
        const yearAgg = agg.get(key) || 0;
        const cross = crossed.get(key);
        if (sec === '194C') {
          applies = b.taxable > rule.single || yearAgg > rule.aggregate;
          if (!(b.taxable > rule.single) && cross && cross > b.date) from = cross;
          notes.push(applies ? (b.taxable > rule.single ? `Single bill above ₹30,000.` : `Year-to-date payments to this vendor ₹${fmtINR(yearAgg)} cross the ₹1,00,000 aggregate.`) : 'Below ₹30,000 single and ₹1,00,000 aggregate thresholds.');
        } else if (rule.aggregate) {
          applies = yearAgg > rule.aggregate;
          if (cross && cross > b.date) from = cross;
          notes.push(applies ? `Year-to-date ₹${fmtINR(yearAgg)} crosses the ₹${fmtINR(rule.aggregate)} threshold.` : `Year-to-date ₹${fmtINR(yearAgg)} is within the ₹${fmtINR(rule.aggregate)} threshold.`);
        } else if (rule.monthly) {
          const m = rentMonth.get(key + '|' + ymKey(b.date)) || 0;
          applies = m > rule.monthly;
          notes.push(applies ? `Rent ₹${fmtINR(m)} for the month is above ₹50,000.` : 'Monthly rent within ₹50,000.');
        } else if (sec === '194Q') {
          if (!buyerTurnoverAbove10Cr) { notes.push('194Q applies only if your previous-year turnover exceeded ₹10 crore (setting is off).'); }
          else {
            // running total per seller, in date order (lines are evaluated in date order)
            const before = q194.get(vkey(b)) || 0;
            const after = r2(before + b.taxable);
            q194.set(vkey(b), after);
            const excess = Math.max(0, after - Math.max(before, rule.excessOver));
            applies = excess > 0;
            if (applies) { base = excess; expected = r2(excess * rate / 100); notes.push(`Purchases from this seller crossed ₹50 lakh this year (₹${fmtINR(after)} so far); TDS on the ₹${fmtINR(excess)} above the limit.`); }
            else notes.push(`Purchases from this seller ₹${fmtINR(after)} so far, within ₹50 lakh.`);
          }
        }
        if (applies && sec !== '194Q') {
          if (!panOk) { rate = NO_PAN_RATE; notes.push('No valid PAN: higher 20% rate applies.'); }
          expected = r2(b.taxable * rate / 100);
          base = b.taxable;
          if (from > b.date) notes.push(`TDS became due on ${fmtDate(from)}, when the year's total crossed the threshold; interest runs from then.`);
        }
        if (!l.booked && applies) notes.push('Section inferred from the ledger name.');
      }
      return { expected, rate, rule, notes, sec, base, from };
    }

    const sum = (f, rs) => r2((rs || out).reduce((a, r) => a + f(r), 0));
    return {
      results: out,
      summary: {
        short: sum((r) => r.short), interest: sum((r) => r.interest), disallowance: sum((r) => r.disallowance),
        issues: out.filter((r) => r.status !== 'OK').length, lines: out.length,
        counts: out.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}),
      },
    };
  }

  // ---------- calendar ----------
  function calendar(period, asOf) {
    const y = Math.floor(period / 100), m = period % 100; // return period (month)
    const next = (d) => new Date(Date.UTC(y, m, d)); // day d of the following month
    const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const items = [
      { date: next(7), what: `Deposit TDS deducted in ${mon}`, law: 'Income-tax Act 2025 (Rule 218)', late: 'Interest 1.5% per month from deduction date' },
      { date: next(11), what: `GSTR-1 for ${mon} (monthly filers)`, law: 'CGST Act', late: '₹50/day late fee (₹20 nil), capped' },
      { date: next(14), what: `GSTR-2B for ${mon} generated; finish IMS accept/reject`, law: 'GST portal', late: 'Unactioned invoices are deemed accepted' },
      { date: next(20), what: `GSTR-3B for ${mon}: pay GST, claim ITC up to 2B`, law: 'CGST Act', late: '₹50/day + 18% p.a. interest on unpaid tax' },
    ];
    const q = Math.floor(((m + 8) % 12) / 3); // 0:Apr-Jun 1:Jul-Sep 2:Oct-Dec 3:Jan-Mar
    const qEnd = [6, 9, 12, 3][q];
    {
      const due = q === 3 ? new Date(Date.UTC(y, 4, 31)) : new Date(Date.UTC(qEnd === 12 ? y + 1 : y, qEnd === 12 ? 0 : qEnd, 31));
      items.push({ date: due, what: `Form 140 (old 26Q) TDS return for Q${q + 1} (${['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'][q]})`, law: 'Income-tax Act 2025, s.397(3)(b)', late: '₹200/day late fee' });
    }
    return items.map((it) => ({ ...it, dateStr: fmtDate(it.date), state: it.date < asOf ? 'past' : (it.date - asOf) / 864e5 <= 5 ? 'soon' : 'later' }));
  }

  // ---------- vendor follow-ups ----------
  function followUps(recon, company) {
    const byVendor = new Map();
    recon.results.forEach((r) => {
      if (!['MISSING_IN_2B', 'VALUE_MISMATCH', 'GSTIN_MISMATCH'].includes(r.status)) return;
      const k = r.gstin + '|' + r.vendor;
      if (!byVendor.has(k)) byVendor.set(k, []);
      byVendor.get(k).push(r);
    });
    return [...byVendor.entries()].map(([k, rs]) => {
      const [gstin, vendor] = k.split('|');
      const total = r2(rs.reduce((a, r) => a + (r.atRisk || r.taxBooks), 0));
      const lines = rs.map((r) => {
        if (r.status === 'MISSING_IN_2B') return `- Invoice ${r.invBooks} dated ${r.date}: tax ₹${fmtINR(r.taxBooks)} is not showing in our GSTR-2B. Please report it in your GSTR-1/IFF.`;
        if (r.status === 'VALUE_MISMATCH') return `- Invoice ${r.invBooks} dated ${r.date}: you reported tax ₹${fmtINR(r.tax2B)}, our invoice shows ₹${fmtINR(r.taxBooks)}. Please amend via GSTR-1A or confirm the correct value.`;
        return `- Invoice ${r.invBooks}: please confirm your GSTIN. Our records have ${r.gstin}.`;
      }).join('\n');
      const subject = `GST: ${rs.length} invoice${rs.length > 1 ? 's' : ''} not matching our GSTR-2B (ITC ₹${fmtINR(total)})`;
      const body = `Dear ${vendor} team,\n\nWhile reconciling our GSTR-2B with our purchase register, we found the following:\n\n${lines}\n\nUntil these reflect correctly, we cannot claim the input tax credit (₹${fmtINR(total)}), and payment of the GST portion may be held. Could you please correct this before the 11th of next month so it appears in our next GSTR-2B?\n\nYour GSTIN on our records: ${gstin}\n\nThank you,\n${company || 'Accounts team'}`;
      return { vendor, gstin, count: rs.length, total, subject, body };
    }).sort((a, b) => b.total - a.total);
  }

  // Ranked to-do list: every item says what to do, why, by when, and the rupee impact.
  function fixList(rec, tds, cal, asOf) {
    const due3B = cal.find((c) => c.what.startsWith('GSTR-3B'));
    const n7 = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + (asOf.getUTCDate() > 7 ? 1 : 0), 7));
    const R = (n) => '₹' + fmtINR(n);
    const items = [];
    rec.results.forEach((r) => {
      const m = {
        MISSING_IN_2B: [`Hold ITC on ${r.invBooks}; ask ${r.vendor} to report it in GSTR-1`, 'Not in this month\'s GSTR-2B, so it cannot be claimed yet. A supplier email is ready.'],
        VALUE_MISMATCH: [`Claim only the 2B amount for ${r.invBooks} (${r.vendor})`, `Books ${R(r.taxBooks)}, 2B ${R(r.tax2B)}. Ask the supplier to amend through GSTR-1A.`],
        GSTIN_MISMATCH: [`Fix ${r.vendor}'s GSTIN in the vendor master`, `Books say ${r.gstin}; the invoice is in 2B under another GSTIN. Correct it, then claim.`],
        DUPLICATE: [`Delete the duplicate entry of ${r.invBooks} (${r.vendor})`, 'Booked twice. Claiming both would double the credit.'],
        ITC_BLOCKED: [`Don't claim ITC on ${r.invBooks} (${r.vendor})`, '2B marks it as not available. Check place of supply with the supplier.'],
        NOT_IN_BOOKS: [`${r.vendor} ${r.inv2B}: book it, or reject it in IMS`, `In your 2B (tax ${R(r.tax2B)}) but not in books. If it is not your purchase, reject it in IMS before filing 3B.`],
      }[r.status];
      if (m) items.push({ area: 'GST', status: r.status, amount: r.atRisk || r.tax2B, title: m[0], detail: m[1], by: 'Before GSTR-3B, ' + due3B.dateStr });
    });
    const byV = new Map();
    tds.results.filter((r) => r.status === 'NOT_DEDUCTED' || r.status === 'SHORT').forEach((r) => {
      const k = r.vendor + '|' + r.section;
      const v = byV.get(k) || { vendor: r.vendor, sec: r.section, newRef: r.newRef, short: 0, int: 0, n: 0, note: r.note, status: r.status };
      v.short += r.short; v.int += r.interest; v.n++; byV.set(k, v);
    });
    byV.forEach((v) => items.push({ area: 'TDS', status: v.status, amount: r2(v.short + v.int), title: `Deduct ${R(r2(v.short))} TDS for ${v.vendor} (${v.sec} → ${v.newRef})`, detail: `${v.n} bill${v.n > 1 ? 's' : ''}. Interest so far ${R(Math.round(v.int))}. ${v.note.split('. ')[0]}.`, by: 'Deposit by ' + fmtDate(n7) }));
    tds.results.filter((r) => r.status === 'REVIEW').forEach((r) => items.push({ area: 'TDS', status: 'REVIEW', amount: 0, title: `Decide the TDS section for ${r.vendor} (${r.ledger})`, detail: r.note, by: 'Before Form 140' }));
    return items.sort((a, b) => b.amount - a.amount);
  }

  // One call that runs everything. Inputs are row objects (from CSV/XLSX/JSON readers).
  function runAll({ booksRows, twoBRows, period, asOf, buyerTurnoverAbove10Cr, company }) {
    const books = normalizeBooks(booksRows);
    const twoB = normalize2B(twoBRows);
    const rec = reconcile(books, twoB, { period });
    const tds = tdsCheck(books, { period, asOf, buyerTurnoverAbove10Cr });
    const cal = calendar(period, asOf);
    const mails = followUps(rec, company);
    const fix = fixList(rec, tds, cal, asOf);
    const monthName = new Date(Date.UTC(Math.floor(period / 100), (period % 100) - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { meta: { period, asOf: fmtDate(asOf), monthName, company, booksRows: booksRows.length, twoBRows: twoBRows.length }, rec, tds, cal: cal.map((c) => ({ ...c, date: c.dateStr })), mails, fix };
  }

  function fmtINR(n) {
    n = Number(n) || 0;
    const neg = n < 0; n = Math.abs(n);
    const [i, d] = n.toFixed(2).split('.');
    let last3 = i.slice(-3), rest = i.slice(0, -3);
    if (rest) last3 = ',' + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    const s = rest + last3 + (d === '00' ? '' : '.' + d);
    return (neg ? '-' : '') + s;
  }

  const api = { parseGrid, runAll, fixList, fieldsFound, parseCSV, toCSV, normalizeBooks, normalize2B, from2BJSON, reconcile, tdsCheck, calendar, followUps, fmtINR, validGSTIN, gstinCheckChar, parseDate, invCore, normInv, TDS_RULES, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FileReady = api;
})(typeof window !== 'undefined' ? window : globalThis);
