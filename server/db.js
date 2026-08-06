'use strict';

const fs = require('node:fs');
const path = require('node:path');

class DbNotConfiguredError extends Error {
  constructor() {
    super('Banco de dados nao configurado.');
    this.name = 'DbNotConfiguredError';
  }
}

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');


const MIGRACOES = [
  'ALTER TABLE config_mes ADD COLUMN taxa_conversao_gbp REAL NOT NULL DEFAULT 6.5',
  'ALTER TABLE config_mes ADD COLUMN taxa_conversao_eur REAL NOT NULL DEFAULT 5.8',
  "ALTER TABLE folha_itens ADD COLUMN moeda_pagamento TEXT NOT NULL DEFAULT 'USD' CHECK (moeda_pagamento IN ('BRL','USD','EUR','GBP'))"
];

function ehColunaDuplicada(err) {
  return /duplicate column name/i.test(String((err && err.message) || err));
}

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
    },
    async batch(comandos) {
      const saida = [];
      db.exec('BEGIN');
      try {
        for (const c of comandos) saida.push(db.prepare(c.sql).all(...(c.args || [])));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return saida;
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
        try {
          await client.execute('SELECT taxa_conversao_eur FROM config_mes LIMIT 1');
          await client.execute('SELECT moeda_pagamento FROM folha_itens LIMIT 1');
          return; 
        } catch { }

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
    },

    async batch(comandos) {
      const rss = await client.batch(
        comandos.map((c) => ({ sql: c.sql, args: c.args || [] })),
        'write'
      );
      return rss.map((rs) => rs.rows.map((r) => rowToObject(r, rs.columns)));
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

function init() {
  if (!initPromise) {
    initPromise = (async () => {
      backend = pickBackend();
      if (backend.ensureSchema) await backend.ensureSchema();
    })().catch((err) => {
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
/** @param {{sql:string,args?:any[]}[]} comandos - executados juntos, em transacao */
async function batch(comandos) { await init(); return backend.batch(comandos); }

function backendName() { return backend ? backend.name : '(nao inicializado)'; }

module.exports = { init, all, get, run, batch, backendName, DbNotConfiguredError };
