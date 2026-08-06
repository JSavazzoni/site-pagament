'use strict';
const express = require('express');
const repo = require('../repo/config.repo.js');
const quote = require('../quote.js');
const { requireAuth, requireRole, badRequest, HttpError } = require('../middleware.js');

const router = express.Router();
const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

router.get('/quote', requireAuth, async (req, res, next) => {
  try {
    const data = await quote.getQuote(req.query.force === '1');
    res.json(data);
  } catch {
    next(new HttpError(502, 'Nao foi possivel obter a cotacao no momento.'));
  }
});

router.get('/config/:competencia', requireAuth, async (req, res, next) => {
  const { competencia } = req.params;
  if (!COMPETENCIA_RE.test(competencia)) return next(badRequest('Competencia invalida (use AAAA-MM).'));
  res.json(await repo.get(competencia));
});

router.put('/config/:competencia', requireAuth, requireRole('cco'), async (req, res, next) => {
  const { competencia } = req.params;
  if (!COMPETENCIA_RE.test(competencia)) return next(badRequest('Competencia invalida (use AAAA-MM).'));
  const body = req.body || {};

  if (body.diasUteis != null && (body.diasUteis < 1 || body.diasUteis > 31)) {
    return next(badRequest('Dias uteis deve estar entre 1 e 31.'));
  }
  if (body.taxaWisePct != null && body.taxaWisePct < 0) {
    return next(badRequest('Taxa Wise nao pode ser negativa.'));
  }
  if (body.taxaConversao != null && body.taxaConversao <= 0) {
    return next(badRequest('Taxa de conversao precisa ser maior que zero.'));
  }

  res.json(await repo.update(competencia, body, req.user.id));
});

module.exports = router;
