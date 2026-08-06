'use strict';
const auth = require('./auth.js');

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

/** Sempre rebusca role/sector_id/active frescos do banco -- nunca confia em cache. */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[auth.COOKIE_NAME];
  const user = auth.verifySession(token);
  if (!user) return next(new HttpError(401, 'Sessao invalida ou expirada.'));
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
  if (err && err.code === 'ERR_SQLITE_ERROR') {
    if (/UNIQUE constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'Ja existe um registro com esses dados.' });
    }
    if (/CHECK constraint failed/.test(err.message)) {
      return res.status(400).json({ error: 'Dados invalidos para este registro.' });
    }
    if (/FOREIGN KEY constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'Este registro ainda tem dados vinculados.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erro no banco de dados.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = {
  HttpError, cookieParser, requireAuth, requireRole,
  notFound, badRequest, conflict, forbidden, errorHandler
};
