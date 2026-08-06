'use strict';
/**
 * Porta de entrada: manda cada um para a sua tela.
 * Ficava embutido no index.html; virou arquivo para a CSP poder proibir
 * script inline (script-src 'self'), que e o que fecha a porta para XSS.
 */
fetch('/api/auth/me', { credentials: 'include' }).then(function (r) {
  if (!r.ok) { location.replace('/login.html'); return null; }
  return r.json();
}).then(function (data) {
  if (!data) return;
  location.replace(data.user.role === 'cco' ? '/painel.html' : '/setor.html');
}).catch(function () { location.replace('/login.html'); });
