'use strict';

const path = require('node:path');
const express = require('express');

const { cookieParser, ensureDb, requireAuth, errorHandler } = require('./middleware.js');
const authRoutes = require('./routes/auth.routes.js');
const sectorsRoutes = require('./routes/sectors.routes.js');
const usersRoutes = require('./routes/users.routes.js');
const configRoutes = require('./routes/config.routes.js');
const payrollRoutes = require('./routes/payroll.routes.js');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY) || (process.env.VERCEL ? 1 : 0));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
app.use(cookieParser);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, regiao: process.env.VERCEL_REGION || 'local', em: new Date().toISOString() });
});

app.use('/api', ensureDb);

app.get('/api/db-ping', requireAuth, async (req, res, next) => {
  try {
    const ini = Date.now();
    await require('./db.js').get('SELECT 1 AS ok');
    res.json({ ok: true, bancoMs: Date.now() - ini, regiao: process.env.VERCEL_REGION || 'local' });
  } catch (e) { next(e); }
});

app.use('/api/auth', authRoutes.router);
app.use('/api/sectors', sectorsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', configRoutes);
app.use('/api/payroll', payrollRoutes);

const CACHE_ASSET = 'public, max-age=60, stale-while-revalidate=86400';

app.get(/^\/(.+)\.html$/i, (req, res) => {
  const busca = req.originalUrl.slice(req.path.length);
  res.redirect(308, '/' + req.params[0] + busca);
});

app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), {
  setHeaders: (res) => res.setHeader('Cache-Control', CACHE_ASSET)
}));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: (res, arquivo) => {
    if (!/\.html$/i.test(arquivo)) res.setHeader('Cache-Control', CACHE_ASSET);
  }
}));

app.use(errorHandler);

module.exports = app;
