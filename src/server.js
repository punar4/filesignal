// FileReady HTTP server.
// Security posture: nothing is stored (uploads live in memory for one request), no request
// bodies or file contents are logged, strict CSP, rate limits, size/type caps, validated
// inputs, generic errors, and an optional access key for private deployments.
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const E = require('./engine.js');
const { readUpload, InputError } = require('./readers.js');
const { buildWorkbook } = require('./report.js');




function createApp() {
  const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 10);
  const ACCESS_KEY = process.env.ACCESS_KEY || ''; // set on the host to make the app private
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render/Railway's proxy, so rate limits see the real IP

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });

  // Minimal access log: method, path, status, time. Never bodies, files, or query strings.
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => { if (process.env.NODE_ENV !== 'test') console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`); });
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT || 30), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Wait a minute and try again.' } }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!ACCESS_KEY) return next();
    const got = Buffer.from(String(req.get('x-access-key') || ''));
    const want = Buffer.from(ACCESS_KEY);
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
    return res.status(401).json({ error: 'Access key required.' });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 2, fields: 8, fieldSize: 1024, parts: 12, headerPairs: 50 },
    fileFilter: (req, file, cb) => {
      const okField = file.fieldname === 'books' || file.fieldname === 'gstr2b';
      const okExt = /\.(csv|xlsx|json)$/i.test(file.originalname || '');
      cb(okField && okExt ? null : new InputError('Upload a .csv, .xlsx or .json file in the purchase register and GSTR-2B slots.'), okField && okExt);
    },
  }).fields([{ name: 'books', maxCount: 1 }, { name: 'gstr2b', maxCount: 1 }]);

  function params(body) {
    const period = String(body.period || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new InputError('Return period must look like 2026-10.');
    const [y, m] = period.split('-').map(Number);
    if (y < 2017 || y > 2100) throw new InputError('Return period is out of range.');
    const asOfStr = String(body.asOf || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfStr)) throw new InputError('"Check as on" must be a date like 2026-11-20.');
    const asOf = E.parseDate(asOfStr);
    if (!asOf || isNaN(asOf)) throw new InputError('"Check as on" is not a valid date.');
    const company = String(body.company || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 80);
    return { period: y * 100 + m, asOf, company, buyerTurnoverAbove10Cr: body.turnover10cr === 'true' || body.turnover10cr === 'on' };
  }

  async function analyse(req) {
    const p = params(req.body || {});
    const f = req.files || {};
    if (!f.books || !f.gstr2b) throw new InputError('Attach both files: the purchase register and GSTR-2B.');
    const books = await readUpload(f.books[0].buffer, 'books');
    const twoB = await readUpload(f.gstr2b[0].buffer, '2b');
    // drop references to the uploaded bytes as soon as they're parsed
    f.books[0].buffer = null; f.gstr2b[0].buffer = null;
    return E.runAll({ booksRows: books.rows, twoBRows: twoB.rows, ...p });
  }

  const handle = (fn) => (req, res, next) => upload(req, res, (err) => (err ? next(err) : Promise.resolve(fn(req, res)).catch(next)));

  app.post('/api/check', handle(async (req, res) => res.json(await analyse(req))));
  app.post('/api/report', handle(async (req, res) => {
    const out = await analyse(req);
    const buf = await buildWorkbook(out);
    const name = `fileready-${out.meta.period}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(buf));
  }));

  // Sample files (fixed allow-list; never a user-supplied path)
  const SAMPLES = {
    'purchase-register.xlsx': 'sample_purchase_register_tally_style.xlsx',
    'gstr2b.xlsx': 'sample_gstr2b_portal_style.xlsx',
    'purchase-register.csv': 'sample_purchase_register.csv',
    'gstr2b.csv': 'sample_gstr2b_oct2026.csv',
  };
  app.get('/samples/:name', (req, res) => {
    const file = SAMPLES[req.params.name];
    if (!file) return res.status(404).end();
    res.download(path.join(__dirname, '..', 'samples', file), req.params.name);
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));

  // Errors: specific message for bad input, generic for everything else (no stack traces).
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Each file must be under ${MAX_FILE_MB} MB.` : 'The upload was not accepted. Attach exactly two files.';
      return res.status(400).json({ error: msg });
    }
    if (process.env.NODE_ENV !== 'test') console.error('internal error:', err && err.name);
    return res.status(500).json({ error: 'Something went wrong while checking. No data was kept.' });
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp().listen(port, () => console.log(`FileReady on http://localhost:${port}`));
  server.requestTimeout = 60 * 1000;
  server.headersTimeout = 20 * 1000;
}

module.exports = { createApp };
