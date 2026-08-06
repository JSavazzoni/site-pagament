'use strict';
const db = require('../db.js');
const auth = require('../auth.js');

const SELECT_USER = `
  SELECT u.id, u.name, u.username, u.role, u.sector_id, u.active, u.created_at, s.name AS sector_name
  FROM users u LEFT JOIN sectors s ON s.id = u.sector_id
`;

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

async function list() {
  const rows = await db.all(SELECT_USER + ' ORDER BY u.role, u.name COLLATE NOCASE');
  return rows.map(toPublic);
}

async function getById(id) {
  const row = await db.get(SELECT_USER + ' WHERE u.id = ?', [id]);
  return row ? toPublic(row) : null;
}

async function usernameTaken(username) {
  return !!(await db.get('SELECT id FROM users WHERE username = ?', [username]));
}

/** @param {{name,username,password,role,sectorId}} data */
async function create(data) {
  const { hash, salt } = auth.hashPassword(data.password);
  const info = await db.run(
    'INSERT INTO users (name, username, password_hash, password_salt, role, sector_id) VALUES (?, ?, ?, ?, ?, ?)',
    [data.name, data.username, hash, salt, data.role, data.role === 'gestor' ? data.sectorId : null]
  );
  return getById(info.lastInsertRowid);
}

/** @param {{name?,sectorId?,active?}} patch */
async function update(id, patch) {
  const current = await db.get('SELECT id, name, role, sector_id, active FROM users WHERE id = ?', [id]);
  if (!current) return null;
  const nextActive = typeof patch.active === 'boolean' ? (patch.active ? 1 : 0) : current.active;
  await db.run(
    `UPDATE users SET name = ?, sector_id = ?, active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [
      typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name,
      current.role === 'gestor' ? (patch.sectorId != null ? patch.sectorId : current.sector_id) : null,
      nextActive,
      id
    ]
  );
  if (nextActive === 0 && current.active === 1) {
    await auth.revokeAllSessionsForUser(id); // desativar derruba sessoes abertas na hora
  }
  return getById(id);
}

async function resetPassword(id, password) {
  const { hash, salt } = auth.hashPassword(password);
  await db.run(
    "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [hash, salt, id]
  );
  await auth.revokeAllSessionsForUser(id);
  return getById(id);
}

module.exports = { list, getById, usernameTaken, create, update, resetPassword };
