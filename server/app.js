'use strict';
/**
 * Monta o app Express SEM dar listen -- usado por dois pontos de entrada:
 *   server/index.js  -> modo local (app.listen + loop de cotacao)
 *   api/index.js     -> Vercel (exporta o app como serverless function)
 */
const path = require('node:path');
const express = require('express');

const { cookieParser, ensureDb, errorHandler } = require('./middleware.js');
const authRoutes = require('./routes/auth.routes.js');
const sectorsRoutes = require('./routes/sectors.routes.js');
const usersRoutes = require('./routes/users.routes.js');
const configRoutes = require('./routes/config.routes.js');
const payrollRoutes = require('./routes/payroll.routes.js');

const app = express();
app.disable('x-powered-by');
// atras do proxy do Vercel, req.ip precisa vir do X-Forwarded-For
app.set('trust proxy', Number(process.env.TRUST_PROXY) || (process.env.VERCEL ? 1 : 0));

app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
app.use(cookieParser);

// garante schema/conexao antes das rotas de API; se o banco nao estiver
// configurado (Vercel sem Turso), vira um 503 explicativo em vez de 500
app.use('/api', ensureDb);

app.use('/api/auth', authRoutes.router);
app.use('/api/sectors', sectorsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', configRoutes);
app.use('/api/payroll', payrollRoutes);

// No Vercel, o CDN serve public/ direto (nem chega aqui); estas montagens
// atendem o modo local e, em producao, o /shared/calc.js e eventuais misses.
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(errorHandler);

module.exports = app;
