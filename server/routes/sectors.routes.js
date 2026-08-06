'use strict';
const express = require('express');
const repo = require('../repo/sectors.repo.js');
const { requireAuth, requireRole, badRequest, notFound, conflict } = require('../middleware.js');

const router = express.Router();
router.use(requireAuth, requireRole('cco'));

router.get('/', (req, res) => {
  res.json(repo.list());
});

router.post('/', (req, res, next) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return next(badRequest('Nome do setor e obrigatorio.'));
  if (name.length > 80) return next(badRequest('Nome do setor muito longo (maximo 80 caracteres).'));
  if (repo.nameTaken(name)) return next(conflict('Ja existe um setor com esse nome.'));
  res.status(201).json(repo.create(name));
});

router.patch('/:id', (req, res, next) => {
  const id = Number(req.params.id);
  const existing = repo.getById(id);
  if (!existing) return next(notFound('Setor nao encontrado.'));

  const body = req.body || {};
  let result = existing;

  if (typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim();
    if (name.length > 80) return next(badRequest('Nome do setor muito longo (maximo 80 caracteres).'));
    if (repo.nameTaken(name, id)) return next(conflict('Ja existe um setor com esse nome.'));
    result = repo.rename(id, name);
  }
  if (typeof body.active === 'boolean') {
    result = repo.setActive(id, body.active);
  }
  res.json(result);
});

module.exports = router;
