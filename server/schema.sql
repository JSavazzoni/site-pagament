-- Schema da folha de pagamento multiusuario.
-- PRAGMA foreign_keys eh por conexao (nao fica gravado no arquivo .db) --
-- server/db.js precisa aplicar de novo toda vez que abre o banco.

CREATE TABLE IF NOT EXISTS sectors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('cco','gestor')),
  sector_id      INTEGER REFERENCES sectors(id) ON DELETE RESTRICT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (role = 'gestor' AND sector_id IS NOT NULL) OR
    (role = 'cco'    AND sector_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_users_sector ON users(sector_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Dolar e libra tem cada um a sua taxa; taxa_conversao_auto vale para as duas
-- (marcar "seguir a cotacao ao vivo" sincroniza ambas).
CREATE TABLE IF NOT EXISTS config_mes (
  competencia          TEXT PRIMARY KEY CHECK (competencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  dias_uteis           INTEGER NOT NULL DEFAULT 26 CHECK (dias_uteis BETWEEN 1 AND 31),
  taxa_wise_pct        REAL    NOT NULL DEFAULT 1  CHECK (taxa_wise_pct >= 0),
  taxa_conversao       REAL    NOT NULL DEFAULT 5  CHECK (taxa_conversao > 0),
  taxa_conversao_eur   REAL    NOT NULL DEFAULT 5.8 CHECK (taxa_conversao_eur > 0),
  taxa_conversao_gbp   REAL    NOT NULL DEFAULT 6.5 CHECK (taxa_conversao_gbp > 0),
  taxa_conversao_auto  INTEGER NOT NULL DEFAULT 0  CHECK (taxa_conversao_auto IN (0,1)),
  updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS folha_itens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sector_id     INTEGER NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
  competencia   TEXT NOT NULL CHECK (competencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  nome          TEXT NOT NULL DEFAULT '',
  salario_base  REAL NOT NULL DEFAULT 0,
  comissao      REAL NOT NULL DEFAULT 0,
  aluguel       REAL NOT NULL DEFAULT 0,
  bonificacao   REAL NOT NULL DEFAULT 0,
  cidade        TEXT NOT NULL DEFAULT '',
  cargo         TEXT NOT NULL DEFAULT '',
  data          TEXT NOT NULL DEFAULT '',
  obs           TEXT NOT NULL DEFAULT '',
  wise_link     TEXT NOT NULL DEFAULT '',
  -- moeda em que a pessoa recebe de fato; o salario continua definido em real
  moeda_pagamento TEXT NOT NULL DEFAULT 'USD' CHECK (moeda_pagamento IN ('BRL','USD','EUR','GBP')),
  pago          INTEGER NOT NULL DEFAULT 0 CHECK (pago IN (0,1)),
  pago_em       TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_folha_sector_comp ON folha_itens(sector_id, competencia);
CREATE INDEX IF NOT EXISTS idx_folha_comp ON folha_itens(competencia);

-- Rate limit de login persistido no banco: em serverless cada requisicao pode
-- cair numa instancia nova, entao contador em memoria nao segura brute-force.
CREATE TABLE IF NOT EXISTS login_attempts (
  key            TEXT PRIMARY KEY,
  count          INTEGER NOT NULL DEFAULT 1,
  first_attempt  INTEGER NOT NULL
);
