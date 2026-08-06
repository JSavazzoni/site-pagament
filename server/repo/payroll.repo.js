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

async function create(data) {
  const info = await db.run(
    `INSERT INTO folha_itens
       (sector_id, competencia, nome, salario_base, comissao, aluguel, bonificacao, cidade, cargo, data, obs, wise_link, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.sectorId, data.competencia, data.nome || '',
      Calc.parseNum(data.salarioBase), Calc.parseNum(data.comissao),
      Calc.parseNum(data.aluguel), Calc.parseNum(data.bonificacao),
      data.cidade || '', data.cargo || '', data.data || '', data.obs || '',
      data.wiseLink || '', data.createdBy || null
    ]
  );
  return getById(info.lastInsertRowid);
}

/** sectorId/competencia/pago sao imutaveis por aqui -- ver setPago() e rotas. */
async function update(id, patch) {
  const current = await db.get('SELECT * FROM folha_itens WHERE id = ?', [id]);
  if (!current) return null;
  await db.run(
    `UPDATE folha_itens SET
       nome = ?, salario_base = ?, comissao = ?, aluguel = ?, bonificacao = ?,
       cidade = ?, cargo = ?, data = ?, obs = ?, wise_link = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [
      patch.nome != null ? patch.nome : current.nome,
      patch.salarioBase != null ? Calc.parseNum(patch.salarioBase) : current.salario_base,
      patch.comissao != null ? Calc.parseNum(patch.comissao) : current.comissao,
      patch.aluguel != null ? Calc.parseNum(patch.aluguel) : current.aluguel,
      patch.bonificacao != null ? Calc.parseNum(patch.bonificacao) : current.bonificacao,
      patch.cidade != null ? patch.cidade : current.cidade,
      patch.cargo != null ? patch.cargo : current.cargo,
      patch.data != null ? patch.data : current.data,
      patch.obs != null ? patch.obs : current.obs,
      patch.wiseLink != null ? patch.wiseLink : current.wise_link,
      id
    ]
  );
  return getById(id);
}

async function remove(id) {
  await db.run('DELETE FROM folha_itens WHERE id = ?', [id]);
}

async function setPago(id, pago) {
  await db.run(
    "UPDATE folha_itens SET pago = ?, pago_em = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [pago ? 1 : 0, pago ? new Date().toISOString() : null, id]
  );
  return getById(id);
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

  if (existing.length && replace) {
    for (const row of existing) await db.run('DELETE FROM folha_itens WHERE id = ?', [row.id]);
  }

  for (const row of sourceItems) {
    await create({
      sectorId, competencia, createdBy,
      nome: row.nome, salarioBase: row.salario_base, comissao: row.comissao,
      aluguel: row.aluguel, bonificacao: row.bonificacao,
      cidade: row.cidade, cargo: row.cargo, data: '', obs: row.obs, wiseLink: row.wise_link
    });
  }

  return { copied: sourceItems.length, existing: 0 };
}

/** Agregado por setor (inclui setores inativos que tenham itens nesta competencia) + total geral. */
async function summary(competencia, config) {
  const rows = await db.all(
    `SELECT f.*, s.name AS sector_name, s.active AS sector_active
     FROM folha_itens f JOIN sectors s ON s.id = f.sector_id
     WHERE f.competencia = ?
     ORDER BY s.name COLLATE NOCASE, f.id`,
    [competencia]
  );

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

module.exports = { getById, listBySector, create, update, remove, setPago, copyPrevious, summary, calcRow };
