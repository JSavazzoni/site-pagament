'use strict';
const db = require('../db.js');

const DEFAULTS = { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5, taxaConversaoAuto: 0 };

const findConfig = db.prepare('SELECT * FROM config_mes WHERE competencia = ?');
const insertDefault = db.prepare(`
  INSERT INTO config_mes (competencia, dias_uteis, taxa_wise_pct, taxa_conversao, taxa_conversao_auto)
  VALUES (?, ?, ?, ?, ?)
`);
const updateConfigStmt = db.prepare(`
  UPDATE config_mes SET dias_uteis=@diasUteis, taxa_wise_pct=@taxaWisePct, taxa_conversao=@taxaConversao,
    taxa_conversao_auto=@taxaConversaoAuto, updated_by=@updatedBy, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE competencia=@competencia
`);
const syncAutoRatesStmt = db.prepare(`
  UPDATE config_mes SET taxa_conversao = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE taxa_conversao_auto = 1
`);

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
function ensure(competencia) {
  let row = findConfig.get(competencia);
  if (!row) {
    insertDefault.run(competencia, DEFAULTS.diasUteis, DEFAULTS.taxaWisePct, DEFAULTS.taxaConversao, DEFAULTS.taxaConversaoAuto);
    row = findConfig.get(competencia);
  }
  return toPublic(row);
}

function get(competencia) {
  return ensure(competencia);
}

function update(competencia, patch, updatedBy) {
  const current = ensure(competencia);
  updateConfigStmt.run({
    competencia,
    diasUteis: patch.diasUteis != null ? Number(patch.diasUteis) : current.diasUteis,
    taxaWisePct: patch.taxaWisePct != null ? Number(patch.taxaWisePct) : current.taxaWisePct,
    taxaConversao: patch.taxaConversao != null ? Number(patch.taxaConversao) : current.taxaConversao,
    taxaConversaoAuto: (patch.taxaConversaoAuto != null ? patch.taxaConversaoAuto : current.taxaConversaoAuto) ? 1 : 0,
    updatedBy: updatedBy || null
  });
  return get(competencia);
}

/** Aplica a cotacao ao vivo em toda competencia marcada como auto-sync. */
function syncAutoRates(usdRate) {
  if (!(usdRate > 0)) return;
  syncAutoRatesStmt.run(usdRate);
}

module.exports = { get, update, syncAutoRates, DEFAULTS };
