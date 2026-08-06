'use strict';
/**
 * Senha (scrypt nativo do Node, sem bcrypt) e sessao (token opaco em
 * cookie httpOnly, guardado como sha256(token) -- nunca o token em
 * claro, nunca JWT/claims cacheados: toda verificacao rebusca role/
 * sector_id/active frescos do banco via requireAuth em middleware.js).
 */
const crypto = require('node:crypto');
const db = require('./db.js');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000;

/* ---------------- senha ---------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

// par fixo (gerado 1x, em memoria) usado quando o username nao existe,
// pra a verificacao gastar o mesmo tempo de um scrypt real -- sem isso,
// login com username inexistente responderia mais rapido que senha
// errada, o que denuncia quais usernames sao validos.
const DUMMY = hashPassword(crypto.randomBytes(24).toString('hex'));

function verifyPassword(password, hash, salt) {
  try {
    const attempt = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
    const stored = Buffer.from(hash, 'hex');
    if (attempt.length !== stored.length) return false;
    return crypto.timingSafeEqual(attempt, stored);
  } catch {
    return false;
  }
}

/** Roda um scrypt de custo equivalente sem revelar se o username existe. */
function verifyDummy(password) {
  verifyPassword(password, DUMMY.hash, DUMMY.salt);
  return false;
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function normalizeUsername(v) {
  return String(v || '').trim().toLowerCase();
}

function isValidUsername(v) {
  return USERNAME_RE.test(v);
}

function isValidPassword(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 200;
}

/* ---------------- sessao ---------------- */

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const insertSession = db.prepare(
  'INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)'
);
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const deleteSessionsForUser = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const deleteExpiredSessions = db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
const findSessionWithUser = db.prepare(`
  SELECT s.expires_at AS session_expires_at,
         u.id, u.name, u.username, u.role, u.sector_id, u.active
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);

function createSession(userId, meta) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession.run(tokenHash(token), userId, (meta && meta.ip) || null, (meta && meta.userAgent) || null, expiresAt);
  return { token, expiresAt };
}

/** Retorna o usuario (camelCase) se a sessao for valida e o usuario ativo; caso contrario null. */
function verifySession(token) {
  if (!token) return null;
  const row = findSessionWithUser.get(tokenHash(token));
  if (!row) return null;
  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    deleteSession.run(tokenHash(token));
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    sectorId: row.sector_id
  };
}

function revokeSession(token) {
  if (!token) return;
  deleteSession.run(tokenHash(token));
}

function revokeAllSessionsForUser(userId) {
  deleteSessionsForUser.run(userId);
}

// varredura periodica de sessoes expiradas -- nao precisa ser exata,
// so evita a tabela crescer indefinidamente num processo de longa duracao.
const sweepTimer = setInterval(() => {
  try { deleteExpiredSessions.run(); } catch { /* processo encerrando */ }
}, 60 * 60 * 1000);
sweepTimer.unref();

/* ---------------- cookie ---------------- */

const COOKIE_NAME = 'sid';

function isSecureEnv() {
  return process.env.NODE_ENV === 'production' && process.env.FORCE_INSECURE_COOKIE !== '1';
}

function serializeSessionCookie(token, expiresAt) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (isSecureEnv()) parts.push('Secure');
  return parts.join('; ');
}

function serializeClearCookie() {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureEnv()) parts.push('Secure');
  return parts.join('; ');
}

/* ---------------- rate limit de login (em memoria, por processo) ---------------- */

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;
const attempts = new Map(); // chave "ip|username" -> { count, firstAttempt }

function rateLimitKey(ip, username) {
  return `${ip || '?'}|${username || '?'}`;
}

function checkRateLimit(key) {
  const entry = attempts.get(key);
  if (!entry) return { allowed: true };
  if (Date.now() - entry.firstAttempt > RATE_WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true };
  }
  if (entry.count >= RATE_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((RATE_WINDOW_MS - (Date.now() - entry.firstAttempt)) / 1000) };
  }
  return { allowed: true };
}

function recordLoginFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAttempt > RATE_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function recordLoginSuccess(key) {
  attempts.delete(key);
}

const rateSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.firstAttempt > RATE_WINDOW_MS) attempts.delete(key);
  }
}, 10 * 60 * 1000);
rateSweepTimer.unref();

module.exports = {
  hashPassword, verifyPassword, verifyDummy,
  normalizeUsername, isValidUsername, isValidPassword,
  createSession, verifySession, revokeSession, revokeAllSessionsForUser,
  COOKIE_NAME, serializeSessionCookie, serializeClearCookie,
  rateLimitKey, checkRateLimit, recordLoginFailure, recordLoginSuccess
};
