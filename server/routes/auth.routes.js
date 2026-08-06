'use strict';
const express = require('express');
const db = require('../db.js');
const auth = require('../auth.js');
const { HttpError, requireAuth, badRequest } = require('../middleware.js');

const router = express.Router();

const SELECT_LOGIN = `
  SELECT u.id, u.name, u.username, u.password_hash, u.password_salt, u.role, u.sector_id, u.active,
         s.name AS sector_name
  FROM users u LEFT JOIN sectors s ON s.id = u.sector_id
  WHERE u.username = ?
`;

function toPublicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    sectorId: u.sector_id != null ? u.sector_id : (u.sectorId || null),
    sectorName: u.sector_name != null ? u.sector_name : (u.sectorName || null)
  };
}

router.post('/login', async (req, res, next) => {
  const body = req.body || {};
  const username = auth.normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = req.ip;
  const key = auth.rateLimitKey(ip, username);

  const rl = await auth.checkRateLimit(key);
  if (!rl.allowed) {
    res.set('Retry-After', String(rl.retryAfterSeconds));
    return next(new HttpError(429, 'Muitas tentativas de login. Tente novamente mais tarde.'));
  }

  if (!username || !password) {
    return next(badRequest('Usuario e senha sao obrigatorios.'));
  }

  const row = await db.get(SELECT_LOGIN, [username]);
  if (!row || !row.active) {
    auth.verifyDummy(password); // gasta o mesmo tempo de um scrypt real, nao denuncia username valido
    await auth.recordLoginFailure(key);
    return next(new HttpError(401, 'Usuario ou senha invalidos.'));
  }

  if (!auth.verifyPassword(password, row.password_hash, row.password_salt)) {
    await auth.recordLoginFailure(key);
    return next(new HttpError(401, 'Usuario ou senha invalidos.'));
  }

  await auth.recordLoginSuccess(key);
  const session = await auth.createSession(row.id, { ip, userAgent: req.headers['user-agent'] });
  res.setHeader('Set-Cookie', auth.serializeSessionCookie(session.token, session.expiresAt));
  res.json({ user: toPublicUser(row) });
});

router.post('/logout', requireAuth, async (req, res) => {
  await auth.revokeSession(req.cookies[auth.COOKIE_NAME]);
  res.setHeader('Set-Cookie', auth.serializeClearCookie());
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  // requireAuth ja rebuscou o usuario do banco (com sectorName) nesta requisicao
  res.json({ user: toPublicUser(req.user) });
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!auth.isValidPassword(newPassword)) {
    return next(badRequest('A nova senha precisa ter entre 8 e 200 caracteres.'));
  }

  const row = await db.get(SELECT_LOGIN, [req.user.username]);
  if (!row || !auth.verifyPassword(currentPassword, row.password_hash, row.password_salt)) {
    return next(new HttpError(401, 'Senha atual incorreta.'));
  }

  const { hash, salt } = auth.hashPassword(newPassword);
  await db.run(
    "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [hash, salt, req.user.id]
  );

  // gira a sessao: revoga todas e cria uma nova, ja com a troca de senha
  await auth.revokeAllSessionsForUser(req.user.id);
  const session = await auth.createSession(req.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
  res.setHeader('Set-Cookie', auth.serializeSessionCookie(session.token, session.expiresAt));
  res.json({ ok: true });
});

module.exports = { router };
