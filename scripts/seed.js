'use strict';
/**
 * Cria o schema (via require de server/db.js) e a primeira conta CCO.
 * Idempotente: recusa criar uma 2a conta CCO se ja existir uma, pra nao
 * gerar confusao sobre qual senha esta valendo.
 *
 * Uso:
 *   node scripts/seed.js
 *   SEED_CCO_USERNAME=cco SEED_CCO_PASSWORD=minhasenha node scripts/seed.js
 *
 * Sem SEED_CCO_PASSWORD, gera uma senha aleatoria forte e imprime UMA
 * UNICA VEZ -- nunca fica gravada em lugar nenhum alem do hash no banco.
 */
const crypto = require('node:crypto');
const db = require('../server/db.js');
const auth = require('../server/auth.js');

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function main() {
  const existente = db.prepare("SELECT id, username FROM users WHERE role = 'cco' LIMIT 1").get();
  if (existente) {
    console.log(`Ja existe uma conta CCO ("${existente.username}"). Nada foi criado.`);
    console.log('Para redefinir a senha de um usuario existente, use: npm run reset-password -- <username>');
    process.exit(1);
  }

  const username = auth.normalizeUsername(process.env.SEED_CCO_USERNAME || 'cco');
  const gerouSenha = !process.env.SEED_CCO_PASSWORD;
  const password = process.env.SEED_CCO_PASSWORD || randomPassword();

  if (!auth.isValidUsername(username)) {
    console.error(`Username invalido: "${username}". Use apenas letras minusculas, numeros, ponto, hifen ou underscore (3-32 caracteres).`);
    process.exit(1);
  }
  if (!auth.isValidPassword(password)) {
    console.error('SEED_CCO_PASSWORD precisa ter entre 8 e 200 caracteres.');
    process.exit(1);
  }

  const { hash, salt } = auth.hashPassword(password);
  db.prepare(
    'INSERT INTO users (name, username, password_hash, password_salt, role, sector_id) VALUES (?, ?, ?, ?, ?, NULL)'
  ).run('CCO', username, hash, salt, 'cco');

  console.log('Conta CCO criada com sucesso.');
  console.log('----------------------------------------');
  console.log(`  usuario: ${username}`);
  if (gerouSenha) {
    console.log(`  senha:   ${password}`);
    console.log('');
    console.log('  Essa senha so aparece agora -- guarde em lugar seguro.');
    console.log('  Troque-a assim que fizer o primeiro login.');
  } else {
    console.log('  senha:   (a que voce definiu em SEED_CCO_PASSWORD)');
  }
  console.log('----------------------------------------');
}

main();
