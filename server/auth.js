'use strict';
/**
 * Senha (scrypt nativo do Node) e sessao (token opaco em cookie httpOnly,
 * guardado como sha256(token) -- nunca JWT/claims cacheados: toda verificacao
 * rebusca role/sector_id/active frescos do banco).
 *
 * Tudo que toca banco e async (ver server/db.js). O rate limit de login vive
 * na tabela login_attempts em vez de memoria: em serverless cada requisicao
 * pode ser uma instancia nova, contador em memoria nao protege nada.
 */
const crypto = require('node:crypto');
const db = require('./db.js');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000;

/* ---------------- senha (CPU-bound, continua sincrona) ---------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

// par fixo usado quando o username nao existe, pra verificacao gastar o mesmo
// tempo de um scrypt real -- login de username inexistente nao pode responder
// mais rapido que senha errada (denunciaria quais usernames sao validos).
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

/** Gasta o custo de um scrypt real sem revelar se o username existe. */
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

async function createSession(userId, meta) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
    [tokenHash(token), userId, (meta && meta.ip) || null, (meta && meta.userAgent) || null, expiresAt]
  );
  // limpeza oportunista: sem processo residente nao ha varredura periodica,
  // entao expiradas deste usuario saem aqui (barato, mantem a tabela pequena)
  await db.run(
    "DELETE FROM sessions WHERE user_id = ? AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    [userId]
  );
  return { token, expiresAt };
}

/** Retorna o usuario (camelCase, com sectorName) se a sessao for valida e ativa; senao null. */
async function verifySession(token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.expires_at AS session_expires_at,
            u.id, u.name, u.username, u.role, u.sector_id, u.active,
            sec.name AS sector_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN sectors sec ON sec.id = u.sector_id
     WHERE s.token_hash = ?`,
    [tokenHash(token)]
  );
  if (!row) return null;
  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    sectorId: row.sector_id,
    sectorName: row.sector_name || null
  };
}

async function revokeSession(token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
}

async function revokeAllSessionsForUser(userId) {
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/* ---------------- cookie ---------------- */

const COOKIE_NAME = 'sid';

function isSecureEnv() {
  if (process.env.FORCE_INSECURE_COOKIE === '1') return false;
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
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

/* ---------------- rate limit de login (persistido no banco) ---------------- */

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;

function rateLimitKey(ip, username) {
  return `${ip || '?'}|${username || '?'}`;
}

async function checkRateLimit(key) {
  const row = await db.get('SELECT count, first_attempt FROM login_attempts WHERE key = ?', [key]);
  if (!row) return { allowed: true };
  if (Date.now() - row.first_attempt > RATE_WINDOW_MS) {
    await db.run('DELETE FROM login_attempts WHERE key = ?', [key]);
    return { allowed: true };
  }
  if (row.count >= RATE_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((RATE_WINDOW_MS - (Date.now() - row.first_attempt)) / 1000) };
  }
  return { allowed: true };
}

async function recordLoginFailure(key) {
  const now = Date.now();
  // upsert com reset da janela quando a primeira tentativa ja expirou
  await db.run(
    `INSERT INTO login_attempts (key, count, first_attempt) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ? - first_attempt > ? THEN 1 ELSE count + 1 END,
       first_attempt = CASE WHEN ? - first_attempt > ? THEN ? ELSE first_attempt END`,
    [key, now, now, RATE_WINDOW_MS, now, RATE_WINDOW_MS, now]
  );
  await db.run('DELETE FROM login_attempts WHERE first_attempt < ?', [now - 2 * RATE_WINDOW_MS]);
}

async function recordLoginSuccess(key) {
  await db.run('DELETE FROM login_attempts WHERE key = ?', [key]);
}

module.exports = {
  hashPassword, verifyPassword, verifyDummy,
  normalizeUsername, isValidUsername, isValidPassword,
  createSession, verifySession, revokeSession, revokeAllSessionsForUser,
  COOKIE_NAME, serializeSessionCookie, serializeClearCookie,
  rateLimitKey, checkRateLimit, recordLoginFailure, recordLoginSuccess
};
