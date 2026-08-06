'use strict';
const db = require('../db.js');
const Calc = require('../../shared/calc.js');

function toPublic(row) {
  return {
    id: row.id,
    sectorId: row.sector_id,
    competencia: row.competencia,
    nome: row.nome,
    salarioBase: row.salario_base,
    comissao: row.comissao,
    aluguel: row.aluguel,
    bonificacao: row.bonificacao,
    cidade: row.cidade,
    cargo: row.cargo,
    data: row.data,
    obs: row.obs,
    wiseLink: row.wise_link,
    moedaPagamento: row.moeda_pagamento || 'USD',
    pago: !!row.pago,
    pagoEm: row.pago_em,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function calcRow(item, config) {
  return Calc.calcItem(item, config);
}

async function getById(id) {
  const row = await db.get('SELECT * FROM folha_itens WHERE id = ?', [id]);
  return row ? toPublic(row) : null;
}

async function listBySector(sectorId, competencia) {
  const rows = await db.all(
    'SELECT * FROM folha_itens WHERE sector_id = ? AND competencia = ? ORDER BY id',
    [sectorId, competencia]
  );
  return rows.map(toPublic);
}

function moedaValida(m) {
  return Calc.MOEDAS[String(m || '').toUpperCase()] ? String(m).toUpperCase() : 'USD';
}

const COLUNAS_INSERT =
  '(sector_id, competencia, nome, salario_base, comissao, aluguel, bonificacao, cidade, cargo, data, obs, wise_link, moeda_pagamento, created_by)';

function argsInsert(data) {
  return [
    data.sectorId, data.competencia, data.nome || '',
    Calc.parseNum(data.salarioBase), Calc.parseNum(data.comissao),
    Calc.parseNum(data.aluguel), Calc.parseNum(data.bonificacao),
    data.cidade || '', data.cargo || '', data.data || '', data.obs || '',
    data.wiseLink || '', moedaValida(data.moedaPagamento), data.createdBy || null
  ];
}

const SQL_INSERT = `INSERT INTO folha_itens ${COLUNAS_INSERT}
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;

async function create(data) {
  const rows = await db.all(SQL_INSERT, argsInsert(data));
  return rows.length ? toPublic(rows[0]) : null;
}

async function update(id, patch) {
  const v = (x) => (x != null ? x : null);
  const n = (x) => (x != null ? Calc.parseNum(x) : null);
  const rows = await db.all(
    `UPDATE folha_itens SET
       nome         = COALESCE(?, nome),
       salario_base = COALESCE(?, salario_base),
       comissao     = COALESCE(?, comissao),
       aluguel      = COALESCE(?, aluguel),
       bonificacao  = COALESCE(?, bonificacao),
       cidade       = COALESCE(?, cidade),
       cargo        = COALESCE(?, cargo),
       data         = COALESCE(?, data),
       obs          = COALESCE(?, obs),
       wise_link    = COALESCE(?, wise_link),
       moeda_pagamento = COALESCE(?, moeda_pagamento),
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? RETURNING *`,
    [
      v(patch.nome), n(patch.salarioBase), n(patch.comissao), n(patch.aluguel), n(patch.bonificacao),
      v(patch.cidade), v(patch.cargo), v(patch.data), v(patch.obs), v(patch.wiseLink),
      patch.moedaPagamento != null ? moedaValida(patch.moedaPagamento) : null,
      id
    ]
  );
  return rows.length ? toPublic(rows[0]) : null;
}

async function remove(id) {
  await db.run('DELETE FROM folha_itens WHERE id = ?', [id]);
}

async function setPago(id, pago) {
  const rows = await db.all(
    `UPDATE folha_itens SET pago = ?, pago_em = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? RETURNING *`,
    [pago ? 1 : 0, pago ? new Date().toISOString() : null, id]
  );
  return rows.length ? toPublic(rows[0]) : null;
}

async function setPagoEmLote(ids, pago) {
  if (!ids.length) return [];
  const marcas = ids.map(() => '?').join(',');
  const rows = await db.all(
    `UPDATE folha_itens SET pago = ?, pago_em = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id IN (${marcas}) RETURNING *`,
    [pago ? 1 : 0, pago ? new Date().toISOString() : null, ...ids]
  );
  return rows.map(toPublic);
}

async function copyPrevious({ sectorId, competencia, replace, createdBy }) {
  const existing = await db.all(
    'SELECT id FROM folha_itens WHERE sector_id = ? AND competencia = ?',
    [sectorId, competencia]
  );
  if (existing.length && !replace) {
    return { copied: 0, existing: existing.length };
  }

  const mesAnt = Calc.mesAnterior(competencia);
  let sourceItems = await db.all(
    'SELECT * FROM folha_itens WHERE sector_id = ? AND competencia = ? ORDER BY id',
    [sectorId, mesAnt]
  );
  if (!sourceItems.length) {
    const found = await db.get(
      'SELECT DISTINCT competencia FROM folha_itens WHERE sector_id = ? AND competencia < ? ORDER BY competencia DESC LIMIT 1',
      [sectorId, competencia]
    );
    if (found) {
      sourceItems = await db.all(
        'SELECT * FROM folha_itens WHERE sector_id = ? AND competencia = ? ORDER BY id',
        [sectorId, found.competencia]
      );
    }
  }
  if (!sourceItems.length) return { copied: 0, existing: existing.length };

  const comandos = [];
  if (existing.length && replace) {
    comandos.push({
      sql: `DELETE FROM folha_itens WHERE id IN (${existing.map(() => '?').join(',')})`,
      args: existing.map((r) => r.id)
    });
  }
  for (const row of sourceItems) {
    comandos.push({
      sql: SQL_INSERT,
      args: argsInsert({
        sectorId, competencia, createdBy,
        nome: row.nome, salarioBase: row.salario_base, comissao: row.comissao,
        aluguel: row.aluguel, bonificacao: row.bonificacao,
        cidade: row.cidade, cargo: row.cargo, data: '', obs: row.obs, wiseLink: row.wise_link,
        moedaPagamento: row.moeda_pagamento
      })
    });
  }
  await db.batch(comandos);

  return { copied: sourceItems.length, existing: 0 };
}

async function summaryRows(competencia) {
  return db.all(
    `SELECT f.*, s.name AS sector_name, s.active AS sector_active
     FROM folha_itens f JOIN sectors s ON s.id = f.sector_id
     WHERE f.competencia = ?
     ORDER BY s.name COLLATE NOCASE, f.id`,
    [competencia]
  );
}

async function summary(competencia, config) {
  return summaryFromRows(competencia, await summaryRows(competencia), config);
}

function summaryFromRows(competencia, rows, config) {
  const bySector = new Map();
  rows.forEach((row) => {
    if (!bySector.has(row.sector_id)) {
      bySector.set(row.sector_id, {
        sectorId: row.sector_id, sectorName: row.sector_name, sectorActive: !!row.sector_active, itens: []
      });
    }
    bySector.get(row.sector_id).itens.push(toPublic(row));
  });

  const sectors = Array.from(bySector.values())
    .map((s) => ({
      sectorId: s.sectorId,
      sectorName: s.sectorName,
      sectorActive: s.sectorActive,
      itensCount: s.itens.length,
      itens: s.itens,
      totals: Calc.calcTotais(s.itens, config)
    }))
    .sort((a, b) => a.sectorName.localeCompare(b.sectorName, 'pt-BR'));

  const allItens = rows.map(toPublic);
  const geral = Calc.calcTotais(allItens, config);

  return { competencia, sectors, geral, totalItens: allItens.length };
}

module.exports = {
  getById, listBySector, create, update, remove,
  setPago, setPagoEmLote, copyPrevious,
  summary, summaryRows, summaryFromRows, calcRow,
  SQL_INSERT, argsInsert
};
