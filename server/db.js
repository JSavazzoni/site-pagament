'use strict';
/**
 * Abre (ou cria) o banco SQLite via node:sqlite -- nativo do Node, sem
 * dependencia externa. PRAGMA foreign_keys eh por conexao: precisa ser
 * reaplicado toda vez que o processo abre o arquivo, o que este modulo
 * ja faz na inicializacao.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
