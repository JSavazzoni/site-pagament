'use strict';
const db = require('../db.js');

const DEFAULTS = { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5, taxaConversaoAuto: 0 };

function toPublic(row) {
  return {
    competencia: row.competencia,
    diasUteis: row.dias_uteis,
    taxaWisePct: row.taxa_wise_pct,
    taxaConversao: row.taxa_conversao,
    taxaConversaoAuto: !!row.taxa_conversao_auto,
    updatedAt: row.updated_at
  };
}

/** Garante que a competencia tem uma linha (auto-vivify com defaults). */
async function ensure(competencia) {
  let row = await db.get('SELECT * FROM config_mes WHERE competencia = ?', [competencia]);
  if (!row) {
    await db.run(
      'INSERT OR IGNORE INTO config_mes (competencia, dias_uteis, taxa_wise_pct, taxa_conversao, taxa_conversao_auto) VALUES (?, ?, ?, ?, ?)',
      [competencia, DEFAULTS.diasUteis, DEFAULTS.taxaWisePct, DEFAULTS.taxaConversao, DEFAULTS.taxaConversaoAuto]
    );
    row = await db.get('SELECT * FROM config_mes WHERE competencia = ?', [competencia]);
  }
  return toPublic(row);
}

async function get(competencia) {
  return ensure(competencia);
}

async function update(competencia, patch, updatedBy) {
  const current = await ensure(competencia);
  await db.run(
    `UPDATE config_mes SET dias_uteis = ?, taxa_wise_pct = ?, taxa_conversao = ?, taxa_conversao_auto = ?,
       updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE competencia = ?`,
    [
      patch.diasUteis != null ? Number(patch.diasUteis) : current.diasUteis,
      patch.taxaWisePct != null ? Number(patch.taxaWisePct) : current.taxaWisePct,
      patch.taxaConversao != null ? Number(patch.taxaConversao) : current.taxaConversao,
      (patch.taxaConversaoAuto != null ? patch.taxaConversaoAuto : current.taxaConversaoAuto) ? 1 : 0,
      updatedBy || null,
      competencia
    ]
  );
  return get(competencia);
}

/** Aplica a cotacao ao vivo em toda competencia marcada como auto-sync. */
async function syncAutoRates(usdRate) {
  if (!(usdRate > 0)) return;
  await db.run(
    "UPDATE config_mes SET taxa_conversao = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE taxa_conversao_auto = 1",
    [usdRate]
  );
}

module.exports = { get, update, syncAutoRates, DEFAULTS };
