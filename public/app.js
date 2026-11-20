{
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtINR(n) {
  n = Number(n) || 0; const neg = n < 0; n = Math.abs(n);
  const [i, d] = n.toFixed(2).split('.'); let last3 = i.slice(-3), rest = i.slice(0, -3);
  if (rest) last3 = ',' + last3;
  return (neg ? '-' : '') + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3 + (d === '00' ? '' : '.' + d);
}
const inr = (n) => '₹' + fmtINR(Math.round(n));
const inr2 = (n) => '₹' + fmtINR(n);
const GST = {
  MATCHED: ['Matched', 'ok'], MATCHED_FORMAT: ['Matched (format)', 'ok'], VALUE_MISMATCH: ['Value differs', 'warn'],
  MISSING_IN_2B: ['Not in 2B', 'risk'], GSTIN_MISMATCH: ['GSTIN differs', 'risk'], DUPLICATE: ['Duplicate in books', 'risk'],
  ITC_BLOCKED: ['ITC not available', 'risk'], NOT_IN_BOOKS: ['Not in books', 'warn'],
};
const TDS = { OK: ['OK', 'ok'], NOT_DEDUCTED: ['Not deducted', 'risk'], SHORT: ['Short', 'risk'], EXCESS: ['Excess', 'warn'], REVIEW: ['Review', 'warn'] };
const tag = (m, s) => `<span class="tag t-${m[s][1]}">${m[s][0]}</span>`;
let files = { books: null, gstr2b: null }, out = null, gstFilter = 'issues', tdsFilter = 'issues';

// table cell labels for the stacked phone layout
new MutationObserver(() => { for (const c of document.querySelectorAll('.stack td:not([data-l])')) { let i = 0, p = c; while ((p = p.previousElementSibling)) i += p.colSpan; c.dataset.l = c.closest('table').rows[0].cells[i]?.textContent || ''; } }).observe(document, { childList: true, subtree: true });

function form() {
  const fd = new FormData();
  fd.append('period', $('period').value);
  fd.append('asOf', $('asof').value);
  fd.append('company', $('company').value);
  fd.append('turnover10cr', $('q194').checked ? 'true' : 'false');
  fd.append('books', files.books, files.books.name);
  fd.append('gstr2b', files.gstr2b, files.gstr2b.name);
  return fd;
}
async function call(path) {
  const headers = {}; if ($('key').value) headers['x-access-key'] = $('key').value;
  const res = await fetch(path, { method: 'POST', body: form(), headers });
  if (res.status === 401) { $('keyWrap').classList.remove('hide'); throw new Error('This deployment is private. Enter the access key and try again.'); }
  if (!res.ok) { let m = 'The check failed.'; try { m = (await res.json()).error || m; } catch (e) { /* not json */ } throw new Error(m); }
  return res;
}
async function run() {
  if (!files.books || !files.gstr2b) return;
  $('err').textContent = '';
  document.body.classList.add('busy');
  try {
    out = await (await call('/api/check')).json();
    out.asOfDate = new Date(out.meta.asOf + 'T00:00:00Z');
    render();
  } catch (e) { $('err').textContent = e.message; }
  finally { document.body.classList.remove('busy'); }
}
async function loadSample() {
  const get = async (u, n) => new File([await (await fetch(u)).blob()], n);
  files = { books: await get('/samples/purchase-register.xlsx', 'purchase-register.xlsx'), gstr2b: await get('/samples/gstr2b.xlsx', 'gstr2b.xlsx') };
  $('pBooks').textContent = 'sample (Tally-style .xlsx)'; $('p2b').textContent = 'sample (portal-style .xlsx)';
  $('period').value = '2026-10'; $('company').value = 'Sunrise Foods Pvt Ltd';
  run();
}

function render() {
  const { rec, tds, cal, mails, fix, meta } = out;
  const monthName = meta.monthName.split(' ')[0];
  const s = rec.summary, t = tds.summary;
  const tdsDue = t.short + t.interest;
  const asOf = out.asOfDate;
  const next = cal.find((c) => c.state !== 'past') || cal[cal.length - 1];
  const days = Math.round((new Date(next.date + 'T00:00:00Z') - asOf) / 864e5);
  $('src').textContent = `Checked ${meta.booksRows} purchase-register rows against ${meta.twoBRows} GSTR-2B rows for ${meta.monthName}.`;
  $('finding').textContent = s.atRisk || tdsDue ? `${inr(s.atRisk)} of ${monthName}'s ITC can't be claimed yet, and ${inr(t.short)} of TDS was missed.` : `${monthName}'s books match GSTR-2B and TDS is in order.`;
  $('kRisk').textContent = inr(s.atRisk);
  $('kRiskL').textContent = `input tax credit on hold across ${rec.results.filter((r) => r.atRisk > 0).length} invoices`;
  $('kClaim').textContent = inr(s.claimable);
  $('kTds').textContent = inr(tdsDue);
  $('kTdsL').textContent = `TDS to fix, incl. ${inr(t.interest)} interest (${t.counts.NOT_DEDUCTED || 0} not deducted, ${t.counts.SHORT || 0} short)`;
  $('kNext').textContent = `${next.what} · ${days === 0 ? 'due today' : days > 0 ? `in ${days} day${days > 1 ? 's' : ''}` : `${-days} days ago`}`;
  $('kNextL').textContent = 'next deadline, ' + next.date;
  $('chartT').textContent = `Where ${monthName}'s ITC stands`;

  const groups = {};
  rec.results.forEach((r) => { if (r.taxBooks) groups[r.status] = (groups[r.status] || 0) + r.taxBooks; });
  const extra = rec.results.filter((r) => r.status === 'NOT_IN_BOOKS').reduce((a, r) => a + r.tax2B, 0);
  const max = Math.max(1, ...Object.values(groups), extra);
  const col = { ok: 'var(--ok)', warn: 'var(--warn)', risk: 'var(--risk)' };
  const order = ['MATCHED', 'MATCHED_FORMAT', 'VALUE_MISMATCH', 'MISSING_IN_2B', 'GSTIN_MISMATCH', 'ITC_BLOCKED', 'DUPLICATE'];
  $('bars').innerHTML = order.filter((k) => groups[k]).map((k) => `<div class="bar"><span>${GST[k][0]}</span><span class="t"><i style="width:${(groups[k] / max * 100).toFixed(1)}%;background:${col[GST[k][1]]}"></i></span><span class="n">${inr(groups[k])}</span></div>`).join('')
    + (extra ? `<div class="bar"><span>In 2B, not in books</span><span class="t"><i style="width:${(extra / max * 100).toFixed(1)}%;background:repeating-linear-gradient(45deg,var(--warn) 0 4px,transparent 4px 8px)"></i></span><span class="n">${inr(extra)}</span></div>` : '')
    || '<p class="k">No invoices for this period.</p>';

  const kindOf = (i) => (i.area === 'GST' ? GST[i.status] : TDS[i.status]) || ['Review', 'warn'];
  $('cFix').textContent = fix.length;
  $('fixList').innerHTML = fix.map((i) => `<div class="fix"><span class="tg"><span class="tag t-${kindOf(i)[1]}">${kindOf(i)[0]}</span></span><div><b>${esc(i.title)}</b><div class="d">${esc(i.detail)}</div><div class="when">${esc(i.by)}</div></div><span class="amt">${i.amount ? inr(i.amount) : ''}</span></div>`).join('') || '<p>Nothing to fix.</p>';

  const gIssues = rec.results.filter((r) => !r.status.startsWith('MATCHED'));
  $('cGst').textContent = gIssues.length;
  $('gstF').innerHTML = [['issues', `Needs action (${gIssues.length})`], ['all', `All (${rec.results.length})`]].map(([k, l]) => `<button data-gf="${k}" aria-pressed="${gstFilter === k}">${l}</button>`).join('');
  const gRows = gstFilter === 'all' ? rec.results : gIssues;
  $('gstT').innerHTML = gRows.map((r) => `<tr><td>${tag(GST, r.status)}</td><td>${esc(r.vendor)}<div class="k">${esc(r.gstin)}${r.gstinValid ? '' : ' · invalid checksum'}</div></td><td>${esc(r.invBooks || '—')}${r.inv2B && r.inv2B !== r.invBooks ? '<div class="k">2B: ' + esc(r.inv2B) + '</div>' : ''}</td><td style="white-space:nowrap">${esc(r.date)}</td><td class="r">${r.taxBooks ? inr2(r.taxBooks) : '—'}</td><td class="r">${r.tax2B ? inr2(r.tax2B) : '—'}</td><td class="r">${r.atRisk ? '<b>' + inr2(r.atRisk) + '</b>' : ''}</td><td class="why">${esc(r.reason)}</td></tr>`).join('') || '<tr><td colspan="8">No rows.</td></tr>';

  const tIssues = tds.results.filter((r) => r.status !== 'OK');
  $('cTds').textContent = tIssues.length;
  $('tdsF').innerHTML = [['issues', `Needs action (${tIssues.length})`], ['month', `${monthName} bills`], ['all', `Tax year so far (${tds.results.length})`]].map(([k, l]) => `<button data-tf="${k}" aria-pressed="${tdsFilter === k}">${l}</button>`).join('');
  const tRows = tdsFilter === 'all' ? tds.results : tdsFilter === 'month' ? tds.results.filter((r) => r.inPeriod) : tIssues;
  $('tdsT').innerHTML = tRows.map((r) => `<tr><td>${tag(TDS, r.status)}</td><td>${esc(r.vendor)}<div class="k">${r.pan ? esc(r.pan) + ' · ' + esc(r.panType) : 'No PAN'}</div></td><td style="white-space:nowrap">${esc(r.date)}</td><td>${r.section ? esc(r.section) + '<div class="k">' + esc(r.newRef) + '</div>' : '<span class="k">' + esc(r.ledger) + '</span>'}</td><td class="r">${inr2(r.amount)}</td><td class="r">${r.rate ? r.rate + '%' : '—'}</td><td class="r">${r.expected ? inr2(r.expected) : '—'}</td><td class="r">${r.deducted ? inr2(r.deducted) : '—'}</td><td class="r">${r.short ? '<b>' + inr2(r.short) + '</b>' + (r.interest ? '<div class="k">+ ' + inr2(r.interest) + ' int.</div>' : '') : ''}</td><td class="why">${esc(r.note)}${r.disallowance ? ' 30% disallowance risk: ' + inr2(r.disallowance) + '.' : ''}</td></tr>`).join('') || '<tr><td colspan="10">No rows.</td></tr>';

  $('cMail').textContent = mails.length;
  $('mails').innerHTML = mails.map((m, i) => `<div class="mail"><div class="secbar" style="margin:0"><div><b>${esc(m.vendor)}</b><div class="k">${m.count} invoice${m.count > 1 ? 's' : ''} · ITC ${inr(m.total)} on hold</div></div><button data-mail="${i}">Copy email</button></div><pre><b>Subject:</b> ${esc(m.subject)}\n\n${esc(m.body)}</pre></div>`).join('') || '<p>No supplier follow-ups needed.</p>';

  $('datesP').textContent = `Monthly-filer dates for ${meta.monthName}, as on ${meta.asOf}. QRMP filers file GSTR-1 by the 13th after the quarter and pay monthly through PMT-06.`;
  $('cal').innerHTML = cal.map((c) => `<div class="cal ${esc(c.state)}"><span class="dt">${new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span><div><b>${esc(c.what)}</b><div class="s">${esc(c.law)} · if late: ${esc(c.late)}</div></div></div>`).join('');
}

function toCSV(rows, cols) {
  const e = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map((c) => e(c[1])).join(',')].concat(rows.map((r) => cols.map((c) => e(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))).join('\n');
}
function csvFor(kind) {
  if (kind === 'gst') return toCSV(out.rec.results, [[(r) => GST[r.status][0], 'Status'], ['vendor', 'Vendor'], ['gstin', 'GSTIN'], ['invBooks', 'Invoice (books)'], ['inv2B', 'Invoice (2B)'], ['date', 'Date'], ['taxBooks', 'Tax in books'], ['tax2B', 'Tax in 2B'], ['claimable', 'Claimable'], ['atRisk', 'On hold'], ['reason', 'Why']]);
  return toCSV(out.tds.results, [[(r) => TDS[r.status][0], 'Status'], ['vendor', 'Vendor'], ['pan', 'PAN'], ['date', 'Date'], ['inv', 'Invoice'], ['ledger', 'Ledger'], ['section', 'Old section'], ['newRef', 'Income-tax Act 2025'], ['amount', 'Amount'], ['rate', 'Rate %'], ['expected', 'Should deduct'], ['deducted', 'Deducted'], ['short', 'Short'], ['interest', 'Interest'], ['note', 'Why']]);
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1800); }
async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast(what + ' copied'); } catch (e) { toast('Copy was blocked by the browser'); } }

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || !out && !['sample', 'report'].includes(b.id)) return;
  if (b.dataset.gf) { gstFilter = b.dataset.gf; render(); }
  else if (b.dataset.tf) { tdsFilter = b.dataset.tf; render(); }
  else if (b.dataset.mail) { const m = out.mails[+b.dataset.mail]; copy('Subject: ' + m.subject + '\n\n' + m.body, 'Email'); }
  else if (b.dataset.copy === 'fix') copy(out.fix.map((i, n) => `${n + 1}. ${i.title}${i.amount ? ' (' + inr(i.amount) + ')' : ''}\n   ${i.detail}\n   ${i.by}`).join('\n'), 'Fix list');
  else if (b.dataset.copy) copy(csvFor(b.dataset.copy), 'CSV');
  else if (b.id === 'sample') loadSample();
  else if (b.id === 'report') {
    if (!files.books || !files.gstr2b) return;
    b.disabled = true;
    try {
      const blob = await (await call('/api/report')).blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fileready-${$('period').value}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { $('err').textContent = err.message; } finally { b.disabled = false; }
  }
});
['period', 'asof', 'q194', 'company'].forEach((id) => $(id).addEventListener('change', run));
$('fBooks').addEventListener('change', (e) => { if (e.target.files[0]) { files.books = e.target.files[0]; $('pBooks').textContent = files.books.name; run(); } });
$('f2b').addEventListener('change', (e) => { if (e.target.files[0]) { files.gstr2b = e.target.files[0]; $('p2b').textContent = files.gstr2b.name; run(); } });

const TABS = ['fix', 'gst', 'tds', 'emails', 'dates', 'how'];
function route() {
  const h = location.hash.slice(1); const cur = TABS.includes(h) ? h : 'fix';
  TABS.forEach((t) => $('s-' + t).classList.toggle('on', t === cur));
  document.querySelectorAll('#tabs a').forEach((a) => { if (a.getAttribute('href') === '#' + cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
window.addEventListener('hashchange', route);
route();
loadSample();
}
