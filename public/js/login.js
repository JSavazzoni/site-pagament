'use strict';
(function () {
  var form = App.$('#form-login');
  var err = App.$('#login-error');
  var btn = App.$('#btn-entrar');

  // ja logado? pula direto pro dashboard certo
  App.get('/api/auth/me').then(function (data) {
    location.replace(data.user.role === 'cco' ? '/painel.html' : '/setor.html');
  }).catch(function () { /* sem sessao -- fica na tela de login */ });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;

    var username = App.$('#username').value.trim();
    var password = App.$('#password').value;

    App.post('/api/auth/login', { username: username, password: password })
      .then(function (data) {
        location.href = data.user.role === 'cco' ? '/painel.html' : '/setor.html';
      })
      .catch(function (e) {
        err.textContent = e.message || 'Nao foi possivel entrar.';
        btn.disabled = false;
        App.$('#password').select();
      });
  });
})();
