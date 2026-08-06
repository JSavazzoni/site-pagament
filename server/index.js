'use strict';
const path = require('node:path');
const express = require('express');

require('./db.js'); // garante schema criado antes de tudo

const { cookieParser, errorHandler } = require('./middleware.js');
const authRoutes = require('./routes/auth.routes.js');
const sectorsRoutes = require('./routes/sectors.routes.js');
const usersRoutes = require('./routes/users.routes.js');
const configRoutes = require('./routes/config.routes.js');
const payrollRoutes = require('./routes/payroll.routes.js');
const quote = require('./quote.js');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);

app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
app.use(cookieParser);

app.use('/api/auth', authRoutes.router);
app.use('/api/sectors', sectorsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', configRoutes);
app.use('/api/payroll', payrollRoutes);

app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Folha de pagamento rodando em http://localhost:${PORT}`);
  quote.startAutoSync();
});
