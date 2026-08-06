'use strict';
/**
 * CLI de emergencia para redefinir a senha de qualquer usuario
 * (inclusive a propria CCO) sem passar pela UI -- nao ha recuperacao
 * de senha por e-mail neste sistema.
 *
 * Uso:
 *   node scripts/reset-password.js <username> [nova-senha]
 *
 * Sem [nova-senha], gera uma senha aleatoria forte e imprime uma vez.
 */
const crypto = require('node:crypto');
const db = require('../server/db.js');
const auth = require('../server/auth.js');

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function main() {
  const usernameArg = process.argv[2];
  const passwordArg = process.argv[3];

  if (!usernameArg) {
    console.error('Uso: node scripts/reset-password.js <username> [nova-senha]');
    process.exit(1);
  }

  const username = auth.normalizeUsername(usernameArg);
  const user = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error(`Nenhum usuario encontrado com username "${username}".`);
    process.exit(1);
  }

  const gerouSenha = !passwordArg;
  const password = passwordArg || randomPassword();
  if (!auth.isValidPassword(password)) {
    console.error('A senha precisa ter entre 8 e 200 caracteres.');
    process.exit(1);
  }

  const { hash, salt } = auth.hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(hash, salt, user.id);
  auth.revokeAllSessionsForUser(user.id);

  console.log(`Senha redefinida para "${username}" (${user.role}). Sessoes ativas foram encerradas.`);
  if (gerouSenha) {
    console.log(`Nova senha: ${password}`);
    console.log('Essa senha so aparece agora -- guarde em lugar seguro.');
  }
}

main();
