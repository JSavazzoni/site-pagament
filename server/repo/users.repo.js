'use strict';
const db = require('../db.js');
const auth = require('../auth.js');

const insertUser = db.prepare(`
  INSERT INTO users (name, username, password_hash, password_salt, role, sector_id)
  VALUES (@name, @username, @passwordHash, @passwordSalt, @role, @sectorId)
`);
const listUsers = db.prepare(`
  SELECT u.id, u.name, u.username, u.role, u.sector_id, u.active, u.created_at, s.name AS sector_name
  FROM users u LEFT JOIN sectors s ON s.id = u.sector_id
  ORDER BY u.role, u.name COLLATE NOCASE
`);
const findUserById = db.prepare(`
  SELECT u.id, u.name, u.username, u.role, u.sector_id, u.active, u.created_at, s.name AS sector_name
  FROM users u LEFT JOIN sectors s ON s.id = u.sector_id
  WHERE u.id = ?
`);
const findUserByUsername = db.prepare('SELECT id FROM users WHERE username = ?');
const updateUserFields = db.prepare(`
  UPDATE users SET name = @name, sector_id = @sectorId, active = @active,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = @id
`);
const setPasswordStmt = db.prepare(
  "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
);

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    sectorId: row.sector_id || null,
    sectorName: row.sector_name || null,
    active: !!row.active,
    createdAt: row.created_at
  };
}

function list() {
  return listUsers.all().map(toPublic);
}

function getById(id) {
  const row = findUserById.get(id);
  return row ? toPublic(row) : null;
}

function usernameTaken(username) {
  return !!findUserByUsername.get(username);
}

/** @param {{name,username,password,role,sectorId}} data */
function create(data) {
  const { hash, salt } = auth.hashPassword(data.password);
  const info = insertUser.run({
    name: data.name,
    username: data.username,
    passwordHash: hash,
    passwordSalt: salt,
    role: data.role,
    sectorId: data.role === 'gestor' ? data.sectorId : null
  });
  return getById(Number(info.lastInsertRowid));
}

/** @param {{name?,sectorId?,active?}} patch */
function update(id, patch) {
  const current = findUserById.get(id);
  if (!current) return null;
  const nextActive = typeof patch.active === 'boolean' ? (patch.active ? 1 : 0) : current.active;
  updateUserFields.run({
    id,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name,
    sectorId: current.role === 'gestor' ? (patch.sectorId != null ? patch.sectorId : current.sector_id) : null,
    active: nextActive
  });
  if (nextActive === 0 && current.active === 1) {
    auth.revokeAllSessionsForUser(id); // desativar derruba sessoes abertas na hora
  }
  return getById(id);
}

function resetPassword(id, password) {
  const { hash, salt } = auth.hashPassword(password);
  setPasswordStmt.run(hash, salt, id);
  auth.revokeAllSessionsForUser(id);
  return getById(id);
}

module.exports = { list, getById, usernameTaken, create, update, resetPassword };
