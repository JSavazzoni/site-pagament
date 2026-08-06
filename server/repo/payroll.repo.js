'use strict';
const db = require('../db.js');
const Calc = require('../../shared/calc.js');

const insertItem = db.prepare(`
  INSERT INTO folha_itens
    (sector_id, competencia, nome, salario_base, comissao, aluguel, bonificacao, cidade, cargo, data, obs, wise_link, created_by)
  VALUES (@sectorId, @competencia, @nome, @salarioBase, @comissao, @aluguel, @bonificacao, @cidade, @cargo, @data, @obs, @wiseLink, @createdBy)
`);
const findById = db.prepare('SELECT * FROM folha_itens WHERE id = ?');
const listBySectorComp = db.prepare('SELECT * FROM folha_itens WHERE sector_id = ? AND competencia = ? ORDER BY id');
const updateItemStmt = db.prepare(`
  UPDATE folha_itens SET
    nome=@nome, salario_base=@salarioBase, comissao=@comissao, aluguel=@aluguel, bonificacao=@bonificacao,
    cidade=@cidade, cargo=@cargo, data=@data, obs=@obs, wise_link=@wiseLink,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=@id
`);
const deleteItemStmt = db.prepare('DELETE FROM folha_itens WHERE id = ?');
const setPagoStmt = db.prepare(`
  UPDATE folha_itens SET pago = ?, pago_em = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
`);
const mostRecentCompetenciaBefore = db.prepare(`
  SELECT DISTINCT competencia FROM folha_itens WHERE sector_id = ? AND competencia < ? ORDER BY competencia DESC LIMIT 1
`);
const summaryRows = db.prepare(`
  SELECT f.*, s.name AS sector_name, s.active AS sector_active
  FROM folha_itens f JOIN sectors s ON s.id = f.sector_id
  WHERE f.competencia = ?
  ORDER BY s.name COLLATE NOCASE, f.id
`);

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

function getById(id) {
  const row = findById.get(id);
  return row ? toPublic(row) : null;
}

function listBySector(sectorId, competencia) {
  return listBySectorComp.all(sectorId, competencia).map(toPublic);
}

function create(data) {
  const info = insertItem.run({
    sectorId: data.sectorId,
    competencia: data.competencia,
    nome: data.nome || '',
    salarioBase: Calc.parseNum(data.salarioBase),
    comissao: Calc.parseNum(data.comissao),
    aluguel: Calc.parseNum(data.aluguel),
    bonificacao: Calc.parseNum(data.bonificacao),
    cidade: data.cidade || '',
    cargo: data.cargo || '',
    data: data.data || '',
    obs: data.obs || '',
    wiseLink: data.wiseLink || '',
    createdBy: data.createdBy || null
  });
  return getById(Number(info.lastInsertRowid));
}

/** sectorId/competencia/pago sao imutaveis por aqui -- ver setPago() e rotas. */
function update(id, patch) {
  const current = findById.get(id);
  if (!current) return null;
  updateItemStmt.run({
    id,
    nome: patch.nome != null ? patch.nome : current.nome,
    salarioBase: patch.salarioBase != null ? Calc.parseNum(patch.salarioBase) : current.salario_base,
    comissao: patch.comissao != null ? Calc.parseNum(patch.comissao) : current.comissao,
    aluguel: patch.aluguel != null ? Calc.parseNum(patch.aluguel) : current.aluguel,
    bonificacao: patch.bonificacao != null ? Calc.parseNum(patch.bonificacao) : current.bonificacao,
    cidade: patch.cidade != null ? patch.cidade : current.cidade,
    cargo: patch.cargo != null ? patch.cargo : current.cargo,
    data: patch.data != null ? patch.data : current.data,
    obs: patch.obs != null ? patch.obs : current.obs,
    wiseLink: patch.wiseLink != null ? patch.wiseLink : current.wise_link
  });
  return getById(id);
}

function remove(id) {
  deleteItemStmt.run(id);
}

function setPago(id, pago) {
  setPagoStmt.run(pago ? 1 : 0, pago ? new Date().toISOString() : null, id);
  return getById(id);
}

/** Copia os itens do mes anterior (ou do mes nao-vazio mais recente antes da competencia) para a competencia atual. */
function copyPrevious({ sectorId, competencia, replace, createdBy }) {
  const existing = listBySectorComp.all(sectorId, competencia);
  if (existing.length && !replace) {
    return { copied: 0, existing: existing.length };
  }

  const mesAnt = Calc.mesAnterior(competencia);
  let sourceItems = listBySectorComp.all(sectorId, mesAnt);
  if (!sourceItems.length) {
    const found = mostRecentCompetenciaBefore.get(sectorId, competencia);
    if (found) sourceItems = listBySectorComp.all(sectorId, found.competencia);
  }
  if (!sourceItems.length) return { copied: 0, existing: existing.length };

  if (existing.length && replace) {
    existing.forEach((row) => deleteItemStmt.run(row.id));
  }

  sourceItems.forEach((row) => {
    create({
      sectorId, competencia, createdBy,
      nome: row.nome, salarioBase: row.salario_base, comissao: row.comissao,
      aluguel: row.aluguel, bonificacao: row.bonificacao,
      cidade: row.cidade, cargo: row.cargo, data: '', obs: row.obs, wiseLink: row.wise_link
    });
  });

  return { copied: sourceItems.length, existing: 0 };
}

/** Agregado por setor (inclui setores inativos que tenham itens nesta competencia) + total geral. */
function summary(competencia, config) {
  const rows = summaryRows.all(competencia);
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
