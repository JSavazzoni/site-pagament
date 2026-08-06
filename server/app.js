'use strict';
/**
 * Monta o app Express SEM dar listen -- usado por dois pontos de entrada:
 *   server/index.js  -> modo local (app.listen + loop de cotacao)
 *   api/index.js     -> Vercel (exporta o app como serverless function)
 */
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
// atras do proxy do Vercel, req.ip precisa vir do X-Forwarded-For
app.set('trust proxy', Number(process.env.TRUST_PROXY) || (process.env.VERCEL ? 1 : 0));

/**
 * Cabecalhos de seguranca em toda resposta.
 *
 * A CSP e restritiva de proposito: o app nao carrega nada de terceiros, entao
 * 'self' basta para script/style/conexao. `style-src` precisa de 'unsafe-inline'
 * porque as telas usam atributos style= em alguns pontos; `img-src data:` porque
 * o favicon e um SVG embutido. Nada disso abre porta para script externo, que e
 * o vetor que importa aqui.
 */
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
  // resposta de API nunca pode ficar em cache: sao dados por usuario/sessao
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
app.use(cookieParser);

/**
 * Sonda sem banco: mede o custo puro de chamar a funcao (rede + cold start),
 * separado do custo de falar com o banco. A diferenca para /api/db-ping diz
 * quanto do tempo e distancia ate o Turso.
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, regiao: process.env.VERCEL_REGION || 'local', em: new Date().toISOString() });
});

// garante schema/conexao antes das rotas de API; se o banco nao estiver
// configurado (Vercel sem Turso), vira um 503 explicativo em vez de 500
app.use('/api', ensureDb);

/**
 * Mesma sonda, mas indo ao banco. Exige sessao de proposito: endpoint publico
 * que dispara consulta e um amplificador barato para quem quiser martelar.
 */
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

// No Vercel, o CDN serve public/ direto (nem chega aqui); estas montagens
// atendem o modo local e, em producao, o /shared/calc.js e eventuais misses.
// /shared NAO esta em public/, entao passa pela funcao e precisa do
// Cache-Control aqui -- o do vercel.json so alcanca o que a borda serve.
const CACHE_ASSET = 'public, max-age=60, stale-while-revalidate=86400';

/**
 * Endereco sem ".html": /painel em vez de /painel.html.
 *
 * Este redirecionamento vem ANTES do express.static -- senao o static entrega
 * painel.html com 200 e o ".html" continua na barra de endereco. Quem tiver o
 * link antigo salvo cai aqui e e levado para o novo, sem quebrar.
 * Em producao o cleanUrls do Vercel faz o mesmo ja na borda.
 */
app.get(/^\/(.+)\.html$/i, (req, res) => {
  const busca = req.originalUrl.slice(req.path.length); // preserva ?a=b#c
  res.redirect(308, '/' + req.params[0] + busca);
});

app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), {
  setHeaders: (res) => res.setHeader('Cache-Control', CACHE_ASSET)
}));

/** `extensions: ['html']` faz /painel servir painel.html. */
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders: (res, arquivo) => {
    if (!/\.html$/i.test(arquivo)) res.setHeader('Cache-Control', CACHE_ASSET);
  }
}));

app.use(errorHandler);

module.exports = app;
