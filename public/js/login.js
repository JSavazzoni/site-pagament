'use strict';
(function () {
  var form = App.$('#form-login');
  var err = App.$('#login-error');
  var btn = App.$('#btn-entrar');
  var senha = App.$('#password');
  var caps = App.$('#caps-warn');

  App.ligarPwToggles();

  // ja logado? pula direto pro dashboard certo
  App.get('/api/auth/me').then(function (data) {
    location.replace(data.user.role === 'cco' ? '/painel.html' : '/setor.html');
  }).catch(function () { /* sem sessao -- fica na tela de login */ });

  // Caps Lock ligado e a causa mais comum de "minha senha nao funciona".
  function checarCaps(e) {
    if (typeof e.getModifierState !== 'function') return;
    caps.classList.toggle('show', e.getModifierState('CapsLock'));
  }
  senha.addEventListener('keydown', checarCaps);
  senha.addEventListener('keyup', checarCaps);
  senha.addEventListener('blur', function () { caps.classList.remove('show'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Entrando...';

    App.post('/api/auth/login', {
      username: App.$('#username').value.trim(),
      password: senha.value
    }).then(function (data) {
      location.href = data.user.role === 'cco' ? '/painel.html' : '/setor.html';
    }).catch(function (e2) {
      err.textContent = e2.message || 'N\u00e3o foi poss\u00edvel entrar.';
      btn.disabled = false;
      btn.textContent = 'Entrar';
      senha.select();
    });
  });
})();
