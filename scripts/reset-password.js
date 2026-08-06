'use strict';

const crypto = require('node:crypto');
const db = require('../server/db.js');
const auth = require('../server/auth.js');

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function main() {
  const usernameArg = process.argv[2];
  const passwordArg = process.argv[3];

  if (!usernameArg) {
    console.error('Uso: node scripts/reset-password.js <username> [nova-senha]');
    process.exit(1);
  }

  await db.init();
  console.log(`Banco: ${db.backendName()}`);

  const username = auth.normalizeUsername(usernameArg);
  const user = await db.get('SELECT id, role FROM users WHERE username = ?', [username]);
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
  await db.run(
    "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    [hash, salt, user.id]
  );
  await auth.revokeAllSessionsForUser(user.id);

  console.log(`Senha redefinida para "${username}" (${user.role}). Sessoes ativas foram encerradas.`);
  if (gerouSenha) {
    console.log(`Nova senha: ${password}`);
    console.log('Essa senha so aparece agora -- guarde em lugar seguro.');
  }
}

main().catch((err) => {
  console.error('Falha ao redefinir senha:', err.message);
  process.exit(1);
});
