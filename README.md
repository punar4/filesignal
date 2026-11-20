# FileSignal Ready
Month-end GST and TDS check for Indian SME books, built for a virtual-CFO desk that runs the same close for many clients.

Upload a purchase register (Tally or Zoho export) and GSTR-2B (GST portal Excel or JSON). FileSignal Ready:

- **Matches books against GSTR-2B** in three passes: exact, invoice-number format differences, then GSTIN typos. It also catches duplicates, ITC marked not available, and 2B invoices missing from the books. Since April 2026, GSTR-3B can't claim ITC above 2B, so anything unmatched is shown as **on hold**.
- **Checks TDS under the Income-tax Act, 2025** (section 393) next to the old 194C/194J/194H/194I/194Q labels. It covers rates, per-bill and yearly thresholds, missing PAN (20%), booked-section vs ledger conflicts, interest from the date TDS became due, and the 30% disallowance risk.
- Produces a **fix list** ranked by rupees with deadlines, **supplier emails**, the **deadline calendar**, and a downloadable **Excel workpaper**.

**No AI model is used.** Every number comes from a written rule, and the reason is printed beside it, so a CA can audit any line.

## Run it

```bash
npm install
npm test        # 11 tests: rules, Excel parsing, API, security
npm start       # http://localhost:3000 (opens with a sample company loaded)
```

## Security

| Guardrail | How |
|---|---|
| Nothing stored | Uploads stay in memory for one request; no disk, no database |
| No data in logs | Only method, path, status and timing are logged |
| File checks | Type decided from the file's bytes, not its name; only .csv/.xlsx/.json; 10 MB cap; 50,000-row cap |
| Formulas never run | Uploaded Excel formulas are not evaluated; text starting with `= + - @` is neutralised in exports (CSV/Excel injection) |
| Browser hardening | Strict Content-Security-Policy (no inline or third-party scripts), no framing, no referrer, HSTS |
| Abuse limits | 30 API requests per minute per IP; request and header timeouts |
| Private mode | Set `ACCESS_KEY` on the host; the API then requires it (constant-time compare) |
| Errors | Specific messages for bad input; generic message for anything else, with no stack traces |
| Container | Alpine image, runs as the non-root `node` user |
| Dependencies | `npm audit`: 0 known vulnerabilities |

Each guardrail has a test in `test/fileready.test.js`.

## Deploy

**Render (free):** push this repo to GitHub, then on Render go to New → Blueprint and pick the repo. `render.yaml` does the rest. To make it private, set `ACCESS_KEY`.

**Docker anywhere:** `docker build -t fileready . && docker run -p 3000:3000 fileready`

## Layout

```
src/engine.js    rules: reconcile(), tdsCheck(), calendar(), followUps(), fixList()
src/readers.js   CSV / XLSX / GST-portal JSON → rows (header detection, limits)
src/report.js    Excel workpaper (6 sheets)
src/server.js    Express API + security
public/          web page (no inline scripts)
samples/         fictional company, Oct 2026, every mismatch type planted
test/            node:test suite
```

## Limits

- Form 140 payment codes are not filled in, because published mappings disagree. Take them from the return utility.
- GST dates assume monthly filers. QRMP filers use different dates.
- For yearly TDS thresholds, upload the tax year to date.
- Working aid, not tax advice.
