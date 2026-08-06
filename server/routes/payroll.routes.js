'use strict';
const express = require('express');
const Calc = require('../../shared/calc.js');
const payrollRepo = require('../repo/payroll.repo.js');
const sectorsRepo = require('../repo/sectors.repo.js');
const configRepo = require('../repo/config.repo.js');
const csv = require('../csv.js');
const { requireAuth, requireRole, badRequest, notFound, forbidden } = require('../middleware.js');

const router = express.Router();
const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

function withCalc(item, config) {
  return { ...item, ...payrollRepo.calcRow(item, config) };
}

/** Gestor: sempre o proprio setor. CCO: le de onde a chamada indicar (query ou body). */
function sectorIdFor(req, raw) {
  if (req.user.role === 'gestor') return req.user.sectorId;
  return raw != null && raw !== '' ? Number(raw) : null;
}

/** Carrega o item e confere posse; gestor de outro setor recebe 404 (nao 403 -- nao confirma existencia). */
async function loadOwnedItem(req) {
  const id = Number(req.params.id);
  const item = await payrollRepo.getById(id);
  if (!item) return { error: notFound('Lancamento nao encontrado.') };
  if (req.user.role === 'gestor' && item.sectorId !== req.user.sectorId) {
    return { error: notFound('Lancamento nao encontrado.') };
  }
  return { item };
}

router.get('/summary', requireAuth, requireRole('cco'), async (req, res, next) => {
  const { competencia } = req.query;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));
  const config = await configRepo.get(competencia);
  res.json(await payrollRepo.summary(competencia, config));
});

router.get('/export.csv', requireAuth, async (req, res, next) => {
  const { competencia } = req.query;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));
  const config = await configRepo.get(competencia);

  let itens;
  let comSetor = false;
  if (req.user.role === 'gestor') {
    itens = await payrollRepo.listBySector(req.user.sectorId, competencia);
  } else if (req.query.sectorId) {
    const sectorId = Number(req.query.sectorId);
    if (!(await sectorsRepo.getById(sectorId))) return next(badRequest('Setor informado nao existe.'));
    itens = await payrollRepo.listBySector(sectorId, competencia);
  } else {
    comSetor = true;
    const s = await payrollRepo.summary(competencia, config);
    itens = s.sectors.flatMap((sec) => sec.itens.map((it) => ({ ...it, sectorName: sec.sectorName })));
  }

  const body = csv.withBom(csv.buildFolhaCsv(itens, config, { comSetor }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="folha-${competencia}.csv"`);
  res.send(body);
});

router.get('/export-wise.csv', requireAuth, async (req, res, next) => {
  const { competencia } = req.query;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));
  const config = await configRepo.get(competencia);

  let itens;
  if (req.user.role === 'gestor') {
    itens = (await payrollRepo.listBySector(req.user.sectorId, competencia)).map((it) => ({ ...it, sectorName: '' }));
  } else if (req.query.sectorId) {
    const sectorId = Number(req.query.sectorId);
    const sector = await sectorsRepo.getById(sectorId);
    if (!sector) return next(badRequest('Setor informado nao existe.'));
    itens = (await payrollRepo.listBySector(sectorId, competencia)).map((it) => ({ ...it, sectorName: sector.name }));
  } else {
    const s = await payrollRepo.summary(competencia, config);
    itens = s.sectors.flatMap((sec) => sec.itens.map((it) => ({ ...it, sectorName: sec.sectorName })));
  }

  const body = csv.withBom(csv.buildWiseCsv(itens, config));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pagamento-usd-${competencia}.csv"`);
  res.send(body);
});

router.post('/import', requireAuth, async (req, res, next) => {
  const { competencia } = req.query;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));

  const sectorId = sectorIdFor(req, req.query.sectorId);
  if (!sectorId) return next(badRequest('Informe sectorId.'));
  if (!(await sectorsRepo.getById(sectorId))) return next(badRequest('Setor informado nao existe.'));

  const texto = typeof req.body === 'string' ? req.body : '';
  if (!texto.trim()) return next(badRequest('Envie o CSV como corpo da requisicao (text/csv).'));

  const linhas = Calc.parseCSV(texto).filter((l) => l.some((c) => String(c).trim() !== ''));
  if (!linhas.length) return next(badRequest('Arquivo vazio.'));

  let idxCab = -1;
  let mapa = null;
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const m = {};
    let achou = false;
    linhas[i].forEach((col, j) => {
      const campo = Calc.MAPA_COLUNAS[Calc.normalizarCabecalho(col)];
      if (campo) { m[j] = campo; if (campo === 'nome') achou = true; }
    });
    if (achou) { idxCab = i; mapa = m; break; }
  }
  if (idxCab === -1) return next(badRequest('Nao encontrei a coluna "Nome" no arquivo.'));

  if (req.query.replace === '1') {
    const atuais = await payrollRepo.listBySector(sectorId, competencia);
    for (const it of atuais) await payrollRepo.remove(it.id);
  }

  let importados = 0;
  for (let r = idxCab + 1; r < linhas.length; r++) {
    const linha = linhas[r];
    const item = { nome: '', salarioBase: 0, comissao: 0, aluguel: 0, bonificacao: 0, cidade: '', cargo: '', data: '', obs: '', wiseLink: '' };
    let temDado = false;
    for (const j in mapa) {
      const campo = mapa[j];
      const bruto = (linha[j] || '').trim();
      if (!bruto) continue;
      if (campo === 'nome' && /^total$/i.test(bruto)) { temDado = false; break; }
      const destino = campo === 'wise' ? 'wiseLink' : campo;
      item[destino] = Calc.NUMERICOS[campo] ? Calc.parseNum(bruto) : bruto;
      if (campo === 'data') item.data = Calc.normalizarData(bruto);
      temDado = true;
    }
    if (temDado && item.nome) {
      await payrollRepo.create({ sectorId, competencia, ...item, createdBy: req.user.id });
      importados += 1;
    }
  }

  res.json({ imported: importados });
});

router.post('/copy-previous', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const { competencia } = body;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));

  const sectorId = sectorIdFor(req, body.sectorId);
  if (!sectorId) return next(badRequest('Informe sectorId.'));
  if (!(await sectorsRepo.getById(sectorId))) return next(badRequest('Setor informado nao existe.'));

  const result = await payrollRepo.copyPrevious({ sectorId, competencia, replace: !!body.replace, createdBy: req.user.id });
  if (!result.copied && result.existing) {
    return res.status(409).json({ error: 'Ja existem lancamentos nesta competencia.', existing: result.existing });
  }
  res.json(result);
});

router.get('/', requireAuth, async (req, res, next) => {
  const { competencia } = req.query;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));

  const sectorId = sectorIdFor(req, req.query.sectorId);
  if (!sectorId) return next(badRequest('Informe sectorId.'));
  const sector = await sectorsRepo.getById(sectorId);
  if (!sector) return next(notFound('Setor nao encontrado.'));

  const config = await configRepo.get(competencia);
  const itens = (await payrollRepo.listBySector(sectorId, competencia)).map((it) => withCalc(it, config));
  const totals = Calc.calcTotais(itens, config);

  res.json({ competencia, sector, config, itens, totals });
});

router.post('/', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const { competencia } = body;
  if (!COMPETENCIA_RE.test(competencia || '')) return next(badRequest('Competencia invalida (use AAAA-MM).'));

  if (req.user.role === 'gestor' && body.sectorId != null && Number(body.sectorId) !== req.user.sectorId) {
    return next(badRequest('sectorId nao corresponde ao seu setor.'));
  }
  const sectorId = sectorIdFor(req, body.sectorId);
  if (!sectorId) return next(badRequest('Informe sectorId.'));
  if (!(await sectorsRepo.getById(sectorId))) return next(badRequest('Setor informado nao existe.'));

  // nome pode ficar vazio na criacao -- interacao e estilo planilha: "+ Colaborador"
  // cria a linha na hora e o usuario preenche o nome depois.
  const nome = String(body.nome || '').trim();

  const created = await payrollRepo.create({
    sectorId, competencia, nome,
    salarioBase: body.salarioBase, comissao: body.comissao, aluguel: body.aluguel, bonificacao: body.bonificacao,
    cidade: body.cidade, cargo: body.cargo, data: body.data, obs: body.obs, wiseLink: body.wiseLink,
    createdBy: req.user.id
  });
  const config = await configRepo.get(competencia);
  res.status(201).json(withCalc(created, config));
});

router.patch('/:id/pago', requireAuth, requireRole('cco'), async (req, res, next) => {
  const id = Number(req.params.id);
  const item = await payrollRepo.getById(id);
  if (!item) return next(notFound('Lancamento nao encontrado.'));

  const pago = !!(req.body && req.body.pago);
  const updated = await payrollRepo.setPago(id, pago);
  const config = await configRepo.get(item.competencia);
  res.json(withCalc(updated, config));
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  const { item, error } = await loadOwnedItem(req);
  if (error) return next(error);
  if (req.user.role === 'gestor' && item.pago) {
    return next(forbidden('Este lancamento ja foi pago e nao pode ser editado.'));
  }

  const body = req.body || {};
  const updated = await payrollRepo.update(item.id, {
    nome: body.nome, salarioBase: body.salarioBase, comissao: body.comissao, aluguel: body.aluguel,
    bonificacao: body.bonificacao, cidade: body.cidade, cargo: body.cargo, data: body.data,
    obs: body.obs, wiseLink: body.wiseLink
  });
  const config = await configRepo.get(item.competencia);
  res.json(withCalc(updated, config));
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  const { item, error } = await loadOwnedItem(req);
  if (error) return next(error);
  if (req.user.role === 'gestor' && item.pago) {
    return next(forbidden('Este lancamento ja foi pago e nao pode ser removido.'));
  }
  await payrollRepo.remove(item.id);
  res.status(204).end();
});

module.exports = router;
