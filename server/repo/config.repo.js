'use strict';
const db = require('../db.js');

const DEFAULTS = { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5, taxaConversaoGbp: 6.5, taxaConversaoAuto: 0 };

function toPublic(row) {
  return {
    competencia: row.competencia,
    diasUteis: row.dias_uteis,
    taxaWisePct: row.taxa_wise_pct,
    taxaConversao: row.taxa_conversao,
    // bancos criados antes da libra podem nao ter a coluna preenchida
    taxaConversaoGbp: row.taxa_conversao_gbp != null ? row.taxa_conversao_gbp : DEFAULTS.taxaConversaoGbp,
    taxaConversaoAuto: !!row.taxa_conversao_auto,
    updatedAt: row.updated_at
  };
}

/** Garante que a competencia tem uma linha (auto-vivify com defaults). */
async function ensure(competencia) {
  let row = await db.get('SELECT * FROM config_mes WHERE competencia = ?', [competencia]);
  if (!row) {
    await db.run(
      `INSERT OR IGNORE INTO config_mes
         (competencia, dias_uteis, taxa_wise_pct, taxa_conversao, taxa_conversao_gbp, taxa_conversao_auto)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [competencia, DEFAULTS.diasUteis, DEFAULTS.taxaWisePct, DEFAULTS.taxaConversao,
        DEFAULTS.taxaConversaoGbp, DEFAULTS.taxaConversaoAuto]
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
    `UPDATE config_mes SET dias_uteis = ?, taxa_wise_pct = ?, taxa_conversao = ?, taxa_conversao_gbp = ?,
       taxa_conversao_auto = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE competencia = ?`,
    [
      patch.diasUteis != null ? Number(patch.diasUteis) : current.diasUteis,
      patch.taxaWisePct != null ? Number(patch.taxaWisePct) : current.taxaWisePct,
      patch.taxaConversao != null ? Number(patch.taxaConversao) : current.taxaConversao,
      patch.taxaConversaoGbp != null ? Number(patch.taxaConversaoGbp) : current.taxaConversaoGbp,
      (patch.taxaConversaoAuto != null ? patch.taxaConversaoAuto : current.taxaConversaoAuto) ? 1 : 0,
      updatedBy || null,
      competencia
    ]
  );
  return get(competencia);
}

/**
 * Aplica a cotacao ao vivo em toda competencia marcada como auto-sync.
 * Uma taxa indisponivel no provedor nao pode zerar a que ja esta gravada --
 * por isso cada moeda so entra no UPDATE se veio um numero valido.
 */
async function syncAutoRates(usdRate, gbpRate) {
  const sets = [];
  const args = [];
  if (usdRate > 0) { sets.push('taxa_conversao = ?'); args.push(usdRate); }
  if (gbpRate > 0) { sets.push('taxa_conversao_gbp = ?'); args.push(gbpRate); }
  if (!sets.length) return;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  await db.run(`UPDATE config_mes SET ${sets.join(', ')} WHERE taxa_conversao_auto = 1`, args);
}

module.exports = { get, update, syncAutoRates, DEFAULTS };
