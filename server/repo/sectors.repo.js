'use strict';
const db = require('../db.js');

const insertSector = db.prepare('INSERT INTO sectors (name) VALUES (?)');
const listSectors = db.prepare(`
  SELECT s.id, s.name, s.active, s.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.sector_id = s.id AND u.role = 'gestor' AND u.active = 1) AS gestor_count
  FROM sectors s
  ORDER BY s.name COLLATE NOCASE
`);
const findSectorById = db.prepare('SELECT id, name, active, created_at FROM sectors WHERE id = ?');
const updateSectorName = db.prepare("UPDATE sectors SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");
const updateSectorActive = db.prepare("UPDATE sectors SET active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    gestorCount: row.gestor_count == null ? undefined : row.gestor_count,
    createdAt: row.created_at
  };
}

function list() {
  return listSectors.all().map(toPublic);
}

function getById(id) {
  const row = findSectorById.get(id);
  return row ? toPublic(row) : null;
}

function nameTaken(name, excludeId) {
  return list().some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== excludeId);
}

function create(name) {
  const info = insertSector.run(name);
  return getById(Number(info.lastInsertRowid));
}

function rename(id, name) {
  updateSectorName.run(name, id);
  return getById(id);
}

function setActive(id, active) {
  updateSectorActive.run(active ? 1 : 0, id);
  return getById(id);
}

module.exports = { list, getById, nameTaken, create, rename, setActive };
