'use strict';
/**
 * Entrada serverless do Vercel: exporta o app Express como handler.
 * O vercel.json reescreve todas as rotas nao-estaticas para ca.
 */
module.exports = require('../server/app.js');
