'use strict';
const db = require('../db.js');

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    gestorCount: row.gestor_count == null ? undefined : row.gestor_count,
    createdAt: row.created_at
  };
}

async function list() {
  const rows = await db.all(`
    SELECT s.id, s.name, s.active, s.created_at,
           (SELECT COUNT(*) FROM users u WHERE u.sector_id = s.id AND u.role = 'gestor' AND u.active = 1) AS gestor_count
    FROM sectors s
    ORDER BY s.name COLLATE NOCASE
  `);
  return rows.map(toPublic);
}

async function getById(id) {
  const row = await db.get('SELECT id, name, active, created_at FROM sectors WHERE id = ?', [id]);
  return row ? toPublic(row) : null;
}

async function nameTaken(name, excludeId) {
  const rows = await list();
  return rows.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== excludeId);
}

async function create(name) {
  const info = await db.run('INSERT INTO sectors (name) VALUES (?)', [name]);
  return getById(info.lastInsertRowid);
}

async function rename(id, name) {
  await db.run("UPDATE sectors SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [name, id]);
  return getById(id);
}

async function setActive(id, active) {
  await db.run("UPDATE sectors SET active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [active ? 1 : 0, id]);
  return getById(id);
}

module.exports = { list, getById, nameTaken, create, rename, setActive };
