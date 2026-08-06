'use strict';
/**
 * Camada de acesso ao banco com DOIS backends atras da mesma interface async:
 *
 *  - Local (npm start / testes / seed sem env):  node:sqlite em arquivo,
 *    exatamente como antes. Sincrono por baixo, exposto como async.
 *  - Producao serverless (Vercel + Turso):       @libsql/client em modo HTTP
 *    (fetch puro, zero codigo nativo). Mesmo dialeto SQLite -- o schema e as
 *    queries validadas nao mudam.
 *
 * Por que async: no Vercel cada requisicao pode cair numa instancia nova, e o
 * unico armazenamento durvel e um banco remoto -- toda query vira uma chamada
 * de rede. A interface unica evita manter dois conjuntos de repos.
 *
 * Selecao de backend:
 *   TURSO_DATABASE_URL definida  -> Turso (com TURSO_AUTH_TOKEN)
 *   rodando no Vercel sem Turso  -> erro claro de configuracao (503 na API)
 *   caso contrario               -> arquivo local (DB_PATH ou data/app.db)
 */
const fs = require('node:fs');
const path = require('node:path');

class DbNotConfiguredError extends Error {
  constructor() {
    super('Banco de dados nao configurado. No Vercel, defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN (veja o README, secao "Deploy no Vercel").');
    this.name = 'DbNotConfiguredError';
  }
}

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * O schema roda com CREATE TABLE IF NOT EXISTS, entao coluna nova nao chega em
 * banco que ja existe. Cada migracao e um ALTER idempotente: se a coluna ja
 * esta la o SQLite responde "duplicate column name" e a gente ignora.
 * Ordem importa -- sempre acrescente no fim.
 */
const MIGRACOES = [
  'ALTER TABLE config_mes ADD COLUMN taxa_conversao_gbp REAL NOT NULL DEFAULT 6.5'
];

function ehColunaDuplicada(err) {
  return /duplicate column name/i.test(String((err && err.message) || err));
}

/* ---------------- backend: node:sqlite (local) ---------------- */

function createSqliteBackend() {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  for (const sql of MIGRACOES) {
    try { db.exec(sql); } catch (err) { if (!ehColunaDuplicada(err)) throw err; }
  }

  return {
    name: 'sqlite-local',
    async all(sql, params) { return db.prepare(sql).all(...(params || [])); },
    async get(sql, params) { return db.prepare(sql).get(...(params || [])); },
    async run(sql, params) {
      const info = db.prepare(sql).run(...(params || []));
      return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) };
    }
  };
}

/* ---------------- backend: Turso / libSQL sobre HTTP ---------------- */

function createTursoBackend() {
  const { createClient } = require('@libsql/client/http');
  const url = String(process.env.TURSO_DATABASE_URL).replace(/^libsql:/, 'https:');
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  let schemaReady = null;
  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        await client.executeMultiple(fs.readFileSync(SCHEMA_PATH, 'utf8'));
        for (const sql of MIGRACOES) {
          try { await client.execute(sql); } catch (err) { if (!ehColunaDuplicada(err)) throw err; }
        }
      })();
    }
    return schemaReady;
  }

  function rowToObject(row, columns) {
    const out = {};
    for (const col of columns) out[col] = row[col];
    return out;
  }

  return {
    name: 'turso',
    ensureSchema,
    async all(sql, params) {
      const rs = await client.execute({ sql, args: params || [] });
      return rs.rows.map((r) => rowToObject(r, rs.columns));
    },
    async get(sql, params) {
      const rs = await client.execute({ sql, args: params || [] });
      return rs.rows.length ? rowToObject(rs.rows[0], rs.columns) : undefined;
    },
    async run(sql, params) {
      const rs = await client.execute({ sql, args: params || [] });
      return {
        lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : 0,
        changes: rs.rowsAffected != null ? Number(rs.rowsAffected) : 0
      };
    }
  };
}

/* ---------------- selecao + init memoizado ---------------- */

let backend = null;
let initPromise = null;

function pickBackend() {
  if (process.env.TURSO_DATABASE_URL) return createTursoBackend();
  if (process.env.VERCEL) throw new DbNotConfiguredError();
  return createSqliteBackend();
}

/** Garante backend escolhido e schema criado. Memoizado -- barato chamar em toda requisicao. */
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      backend = pickBackend();
      if (backend.ensureSchema) await backend.ensureSchema();
    })().catch((err) => {
      // falhou (ex.: rede) -- permite tentar de novo na proxima requisicao
      initPromise = null;
      backend = null;
      throw err;
    });
  }
  return initPromise;
}

async function all(sql, params) { await init(); return backend.all(sql, params); }
async function get(sql, params) { await init(); return backend.get(sql, params); }
async function run(sql, params) { await init(); return backend.run(sql, params); }

function backendName() { return backend ? backend.name : '(nao inicializado)'; }

module.exports = { init, all, get, run, backendName, DbNotConfiguredError };
