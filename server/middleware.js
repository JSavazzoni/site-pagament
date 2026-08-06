'use strict';
const auth = require('./auth.js');
const db = require('./db.js');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function cookieParser(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

/**
 * Garante o banco pronto antes de qualquer rota de API. Memoizado no db --
 * custo ~zero depois da primeira requisicao da instancia. Se estiver no
 * Vercel sem Turso configurado, cai no errorHandler com um 503 explicativo
 * em vez de um 500 criptico.
 */
function ensureDb(req, res, next) {
  db.init().then(() => next(), next);
}

/** Sempre rebusca role/sector_id/active frescos do banco -- nunca confia em cache. */
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[auth.COOKIE_NAME];
  const user = await auth.verifySession(token);
  if (!user) throw new HttpError(401, 'Sessao invalida ou expirada.');
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Nao autenticado.'));
    if (req.user.role !== role) return next(new HttpError(403, 'Acesso restrito.'));
    next();
  };
}

/** Recurso de outro setor: 404 (nunca 403) -- nao confirma existencia pra quem nao tem acesso. */
function notFound(message) {
  return new HttpError(404, message || 'Recurso nao encontrado.');
}

function badRequest(message) {
  return new HttpError(400, message || 'Requisicao invalida.');
}

function conflict(message) {
  return new HttpError(409, message || 'Conflito com um registro existente.');
}

function forbidden(message) {
  return new HttpError(403, message || 'Acao nao permitida.');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof db.DbNotConfiguredError) {
    return res.status(503).json({ error: err.message });
  }
  // constraints valem para os dois backends (node:sqlite e libsql/Turso);
  // os codigos de erro diferem entre eles, a mensagem nao.
  const msg = String((err && err.message) || '');
  if (/UNIQUE constraint failed/.test(msg)) {
    return res.status(409).json({ error: 'Ja existe um registro com esses dados.' });
  }
  if (/CHECK constraint failed/.test(msg)) {
    return res.status(400).json({ error: 'Dados invalidos para este registro.' });
  }
  if (/FOREIGN KEY constraint failed/.test(msg)) {
    return res.status(409).json({ error: 'Este registro ainda tem dados vinculados.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = {
  HttpError, cookieParser, ensureDb, requireAuth, requireRole,
  notFound, badRequest, conflict, forbidden, errorHandler
};
