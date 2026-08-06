'use strict';
const express = require('express');
const db = require('../db.js');
const auth = require('../auth.js');
const { HttpError, requireAuth, badRequest } = require('../middleware.js');

const router = express.Router();

const findUserForLogin = db.prepare(`
  SELECT id, name, username, password_hash, password_salt, role, sector_id, active
  FROM users WHERE username = ?
`);
const findSectorName = db.prepare('SELECT name FROM sectors WHERE id = ?');
const touchUserPassword = db.prepare(
  "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
);

function sectorNameOf(sectorId) {
  if (!sectorId) return null;
  const row = findSectorName.get(sectorId);
  return row ? row.name : null;
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    sectorId: row.sector_id || row.sectorId || null,
    sectorName: sectorNameOf(row.sector_id != null ? row.sector_id : row.sectorId)
  };
}

router.post('/login', (req, res, next) => {
  const body = req.body || {};
  const username = auth.normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = req.ip;
  const key = auth.rateLimitKey(ip, username);

  const rl = auth.checkRateLimit(key);
  if (!rl.allowed) {
    res.set('Retry-After', String(rl.retryAfterSeconds));
    return next(new HttpError(429, 'Muitas tentativas de login. Tente novamente mais tarde.'));
  }

  if (!username || !password) {
    return next(badRequest('Usuario e senha sao obrigatorios.'));
  }

  const row = findUserForLogin.get(username);
  if (!row || !row.active) {
    auth.verifyDummy(password); // gasta o mesmo tempo de um scrypt real, nao denuncia username valido
    auth.recordLoginFailure(key);
    return next(new HttpError(401, 'Usuario ou senha invalidos.'));
  }

  if (!auth.verifyPassword(password, row.password_hash, row.password_salt)) {
    auth.recordLoginFailure(key);
    return next(new HttpError(401, 'Usuario ou senha invalidos.'));
  }

  auth.recordLoginSuccess(key);
  const session = auth.createSession(row.id, { ip, userAgent: req.headers['user-agent'] });
  res.setHeader('Set-Cookie', auth.serializeSessionCookie(session.token, session.expiresAt));
  res.json({ user: toPublicUser(row) });
});

router.post('/logout', requireAuth, (req, res) => {
  auth.revokeSession(req.cookies[auth.COOKIE_NAME]);
  res.setHeader('Set-Cookie', auth.serializeClearCookie());
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

router.post('/change-password', requireAuth, (req, res, next) => {
  const body = req.body || {};
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!auth.isValidPassword(newPassword)) {
    return next(badRequest('A nova senha precisa ter entre 8 e 200 caracteres.'));
  }

  const row = findUserForLogin.get(req.user.username);
  if (!row || !auth.verifyPassword(currentPassword, row.password_hash, row.password_salt)) {
    return next(new HttpError(401, 'Senha atual incorreta.'));
  }

  const { hash, salt } = auth.hashPassword(newPassword);
  touchUserPassword.run(hash, salt, req.user.id);

  // gira a sessao: revoga todas e cria uma nova, ja com a troca de senha
  auth.revokeAllSessionsForUser(req.user.id);
  const session = auth.createSession(req.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
  res.setHeader('Set-Cookie', auth.serializeSessionCookie(session.token, session.expiresAt));
  res.json({ ok: true });
});

module.exports = { router, toPublicUser, sectorNameOf };
