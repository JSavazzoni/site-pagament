'use strict';
const express = require('express');
const repo = require('../repo/users.repo.js');
const sectorsRepo = require('../repo/sectors.repo.js');
const auth = require('../auth.js');
const { requireAuth, requireRole, badRequest, notFound, conflict } = require('../middleware.js');

const router = express.Router();
router.use(requireAuth, requireRole('cco'));

router.get('/', async (req, res) => {
  res.json(await repo.list());
});

router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const username = auth.normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role;
  const sectorId = body.sectorId != null ? Number(body.sectorId) : null;

  if (!name) return next(badRequest('Nome e obrigatorio.'));
  if (!auth.isValidUsername(username)) {
    return next(badRequest('Username invalido: use apenas letras minusculas, numeros, ponto, hifen ou underscore (3-32 caracteres).'));
  }
  if (!auth.isValidPassword(password)) {
    return next(badRequest('A senha precisa ter entre 8 e 200 caracteres.'));
  }
  if (role !== 'cco' && role !== 'gestor') {
    return next(badRequest('Papel invalido: use "cco" ou "gestor".'));
  }
  if (role === 'gestor') {
    if (!sectorId) return next(badRequest('Gestor precisa de um setor.'));
    const sector = await sectorsRepo.getById(sectorId);
    if (!sector) return next(badRequest('Setor informado nao existe.'));
  }
  if (await repo.usernameTaken(username)) return next(conflict('Ja existe um usuario com esse username.'));

  res.status(201).json(await repo.create({ name, username, password, role, sectorId }));
});

router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const existing = await repo.getById(id);
  if (!existing) return next(notFound('Usuario nao encontrado.'));

  const body = req.body || {};
  if (existing.role === 'gestor' && body.sectorId != null) {
    const sector = await sectorsRepo.getById(Number(body.sectorId));
    if (!sector) return next(badRequest('Setor informado nao existe.'));
  }
  if (id === req.user.id && body.active === false) {
    return next(badRequest('Voce nao pode desativar a propria conta.'));
  }

  res.json(await repo.update(id, {
    name: body.name,
    sectorId: body.sectorId != null ? Number(body.sectorId) : undefined,
    active: body.active
  }));
});

router.post('/:id/reset-password', async (req, res, next) => {
  const id = Number(req.params.id);
  const existing = await repo.getById(id);
  if (!existing) return next(notFound('Usuario nao encontrado.'));

  const password = (req.body && req.body.password) || '';
  if (!auth.isValidPassword(password)) {
    return next(badRequest('A senha precisa ter entre 8 e 200 caracteres.'));
  }
  res.json(await repo.resetPassword(id, password));
});

module.exports = router;
