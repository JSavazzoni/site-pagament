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
    pago: !!row.pago,
    pagoEm: row.pago_em,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Recalcula total/diario/dolar/fee/totalUsd a partir dos campos armazenados -- nunca confia no que o cliente mandou. */
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

const COLUNAS_INSERT =
  '(sector_id, competencia, nome, salario_base, comissao, aluguel, bonificacao, cidade, cargo, data, obs, wise_link, created_by)';

/** Argumentos do INSERT na ordem de COLUNAS_INSERT. */
function argsInsert(data) {
  return [
    data.sectorId, data.competencia, data.nome || '',
    Calc.parseNum(data.salarioBase), Calc.parseNum(data.comissao),
    Calc.parseNum(data.aluguel), Calc.parseNum(data.bonificacao),
    data.cidade || '', data.cargo || '', data.data || '', data.obs || '',
    data.wiseLink || '', data.createdBy || null
  ];
}

/**
 * RETURNING evita o SELECT de volta: antes era INSERT + SELECT (2 viagens de
 * rede ate o Turso); agora e uma so. O mesmo vale para update() e setPago().
 */
const SQL_INSERT = `INSERT INTO folha_itens ${COLUNAS_INSERT}
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;

async function create(data) {
  const rows = await db.all(SQL_INSERT, argsInsert(data));
  return rows.length ? toPublic(rows[0]) : null;
}

/**
 * sectorId/competencia/pago sao imutaveis por aqui -- ver setPago() e rotas.
 * O COALESCE deixa o "so mexe no que veio no patch" acontecer dentro do proprio
 * UPDATE, sem precisar ler a linha antes (eram 3 viagens: SELECT, UPDATE, SELECT).
 */
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
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? RETURNING *`,
    [
      v(patch.nome), n(patch.salarioBase), n(patch.comissao), n(patch.aluguel), n(patch.bonificacao),
      v(patch.cidade), v(patch.cargo), v(patch.data), v(patch.obs), v(patch.wiseLink),
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

/**
 * Marca/desmarca varios lancamentos de uma vez, numa unica viagem de rede.
 * O painel fazia um PATCH por colaborador ao "pagar setor inteiro" -- 12
 * colaboradores eram 12 requisicoes em serie.
 */
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

/** Copia os itens do mes anterior (ou do mes nao-vazio mais recente antes da competencia) para a competencia atual. */
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

  // Tudo numa unica viagem de rede e numa unica transacao: se um insert falhar,
  // nada e gravado -- antes era um DELETE/INSERT por linha, em serie.
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
        cidade: row.cidade, cargo: row.cargo, data: '', obs: row.obs, wiseLink: row.wise_link
      })
    });
  }
  await db.batch(comandos);

  return { copied: sourceItems.length, existing: 0 };
}

/** So a leitura -- separada para poder rodar em paralelo com a busca da config. */
async function summaryRows(competencia) {
  return db.all(
    `SELECT f.*, s.name AS sector_name, s.active AS sector_active
     FROM folha_itens f JOIN sectors s ON s.id = f.sector_id
     WHERE f.competencia = ?
     ORDER BY s.name COLLATE NOCASE, f.id`,
    [competencia]
  );
}

/** Agregado por setor (inclui setores inativos que tenham itens nesta competencia) + total geral. */
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
