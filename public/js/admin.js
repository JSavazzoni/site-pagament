'use strict';
(function () {
  var esc = App.esc;
  var state = { sectors: [], users: [], resetTargetId: null, eu: null };

  function fmtData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ============================================================
     Inicializacao
     ============================================================ */

  function init() {
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'cco') { location.replace('/setor.html'); return; }
      state.eu = data.user;
      App.montarUserMenu(data.user);
      App.ligarPwToggles();
      bindEventos();
      carregarTudo();
    }).catch(function () { location.replace('/login.html'); });
  }

  function carregarTudo() {
    return Promise.all([App.get('/api/sectors'), App.get('/api/users')]).then(function (r) {
      state.sectors = r[0];
      state.users = r[1];
      renderSetores();
      renderUsuarios();
      preencherSelectSetor();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  /* ============================================================
     Setores
     ============================================================ */

  function renderSetores() {
    var box = App.$('#lista-setores');
    App.$('#cont-setores').textContent = state.sectors.length;
    App.$('#empty-setores').hidden = state.sectors.length > 0;

    box.innerHTML = state.sectors.map(function (s) {
      return '<div class="list-row' + (s.active ? '' : ' is-off') + '" data-id="' + s.id + '">' +
        '<div class="list-main">' +
          '<div class="list-title">' +
            '<input class="name-edit" data-nome-setor value="' + esc(s.name) + '" aria-label="Nome do setor" maxlength="60">' +
            (s.active ? '' : '<span class="badge badge-neutral">inativo</span>') +
          '</div>' +
          '<div class="list-sub">' +
            '<span>' + s.gestorCount + ' gestor' + (s.gestorCount === 1 ? '' : 'es') + ' ativo' + (s.gestorCount === 1 ? '' : 's') + '</span>' +
            '<span>&middot;</span>' +
            '<span>criado em ' + fmtData(s.createdAt) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="list-actions">' +
          '<button class="btn btn-sm" data-toggle-setor type="button">' +
            (s.active ? 'Desativar' : 'Ativar') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function bindSetores() {
    var box = App.$('#lista-setores');

    box.addEventListener('focusout', function (e) {
      var inp = e.target.closest('[data-nome-setor]');
      if (!inp) return;
      var id = Number(inp.closest('.list-row').dataset.id);
      var atual = state.sectors.filter(function (s) { return s.id === id; })[0];
      var nome = inp.value.trim();
      if (!nome || !atual || nome === atual.name) { if (atual) inp.value = atual.name; return; }

      App.patch('/api/sectors/' + id, { name: nome }).then(function (upd) {
        var i = state.sectors.findIndex(function (s) { return s.id === id; });
        state.sectors[i] = upd;
        preencherSelectSetor();
        renderUsuarios();
        App.toast('Setor renomeado.', 'ok');
      }).catch(function (e2) {
        App.toast(e2.message, 'err');
        inp.value = atual.name;
      });
    });

    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest('[data-nome-setor]')) { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape' && e.target.closest('[data-nome-setor]')) {
        var id = Number(e.target.closest('.list-row').dataset.id);
        var s = state.sectors.filter(function (x) { return x.id === id; })[0];
        if (s) e.target.value = s.name;
        e.target.blur();
      }
    });

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toggle-setor]');
      if (!btn) return;
      var id = Number(btn.closest('.list-row').dataset.id);
      var s = state.sectors.filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      var novo = !s.active;

      var acao = function () {
        App.patch('/api/sectors/' + id, { active: novo }).then(function (upd) {
          var i = state.sectors.findIndex(function (x) { return x.id === id; });
          state.sectors[i] = upd;
          renderSetores();
          preencherSelectSetor();
          App.toast('Setor ' + (novo ? 'ativado' : 'desativado') + '.', 'ok');
        }).catch(function (e2) { App.toast(e2.message, 'err'); });
      };

      if (novo) { acao(); return; }
      App.confirmar({
        titulo: 'Desativar "' + s.name + '"?',
        texto: 'Os gestores deste setor deixam de lan\u00e7ar a folha. O hist\u00f3rico dos meses anteriores continua no painel.',
        ok: 'Desativar', perigo: true
      }).then(function (sim) { if (sim) acao(); });
    });
  }

  function preencherSelectSetor() {
    var sel = App.$('#usuario-setor');
    var ativos = state.sectors.filter(function (s) { return s.active; });
    sel.innerHTML = ativos.length
      ? ativos.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('')
      : '<option value="">Crie um setor primeiro</option>';
  }

  /* ============================================================
     Usuarios
     ============================================================ */

  function renderUsuarios() {
    var box = App.$('#lista-usuarios');
    App.$('#cont-usuarios').textContent = state.users.length;
    App.$('#empty-usuarios').hidden = state.users.length > 0;

    box.innerHTML = state.users.map(function (u) {
      var souEu = state.eu && u.id === state.eu.id;
      return '<div class="list-row' + (u.active ? '' : ' is-off') + '" data-id="' + u.id + '">' +
        '<span class="avatar' + (u.role === 'cco' ? ' is-cco' : '') + '">' + esc(App.iniciais(u.name)) + '</span>' +
        '<div class="list-main">' +
          '<div class="list-title">' + esc(u.name) +
            (u.role === 'cco' ? ' <span class="badge badge-blue">CCO</span>' : '') +
            (souEu ? ' <span class="badge badge-neutral">voc&ecirc;</span>' : '') +
            (u.active ? '' : ' <span class="badge badge-neutral">inativo</span>') +
          '</div>' +
          '<div class="list-sub">' +
            '<code>' + esc(u.username) + '</code>' +
            (u.role === 'gestor' ? selectSetor(u) : '<span>acesso total a todos os setores</span>') +
          '</div>' +
        '</div>' +
        '<div class="list-actions">' +
          '<button class="btn btn-sm" data-reset type="button" title="Definir nova senha">Senha</button>' +
          (souEu ? '' :
            '<button class="btn btn-sm" data-toggle-usuario type="button">' +
              (u.active ? 'Desativar' : 'Ativar') + '</button>') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function selectSetor(u) {
    var opts = state.sectors.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === u.sectorId ? ' selected' : '') +
        (s.active ? '' : ' disabled') + '>' + esc(s.name) + (s.active ? '' : ' (inativo)') + '</option>';
    }).join('');
    return '<select class="select-inline" data-mudar-setor aria-label="Setor do gestor">' + opts + '</select>';
  }

  function bindUsuarios() {
    var box = App.$('#lista-usuarios');

    box.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-mudar-setor]');
      if (!sel) return;
      var id = Number(sel.closest('.list-row').dataset.id);
      App.patch('/api/users/' + id, { sectorId: Number(sel.value) }).then(function (upd) {
        var i = state.users.findIndex(function (u) { return u.id === id; });
        state.users[i] = upd;
        App.toast('Setor do gestor atualizado.', 'ok');
      }).catch(function (e2) { App.toast(e2.message, 'err'); renderUsuarios(); });
    });

    box.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-usuario]');
      if (toggle) {
        var id = Number(toggle.closest('.list-row').dataset.id);
        var u = state.users.filter(function (x) { return x.id === id; })[0];
        if (!u) return;
        var novo = !u.active;

        var acao = function () {
          App.patch('/api/users/' + id, { active: novo }).then(function (upd) {
            var i = state.users.findIndex(function (x) { return x.id === id; });
            state.users[i] = upd;
            renderUsuarios();
            App.toast('Acesso ' + (novo ? 'reativado' : 'revogado') + '.', 'ok');
          }).catch(function (e2) { App.toast(e2.message, 'err'); });
        };

        if (novo) { acao(); return; }
        App.confirmar({
          titulo: 'Revogar o acesso de ' + u.name + '?',
          texto: 'A pessoa \u00e9 desconectada na hora e n\u00e3o consegue mais entrar. Os lan\u00e7amentos que ela fez continuam na folha.',
          ok: 'Revogar acesso', perigo: true
        }).then(function (sim) { if (sim) acao(); });
        return;
      }

      var reset = e.target.closest('[data-reset]');
      if (reset) {
        var idR = Number(reset.closest('.list-row').dataset.id);
        var uR = state.users.filter(function (x) { return x.id === idR; })[0];
        if (!uR) return;
        state.resetTargetId = idR;
        App.$('#reset-usuario-label').textContent = 'Nova senha para ' + uR.name + ' (' + uR.username + ').';
        App.$('#reset-error').textContent = '';
        App.$('#reset-senha').value = App.gerarSenha();
        App.openModal('modal-reset');
      }
    });
  }

  /* ============================================================
     Criacao
     ============================================================ */

  /** Sugere o login a partir do nome, enquanto a CCO ainda nao digitou um. */
  function sugerirUsername(nome) {
    return String(nome || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  }

  function bindFormularios() {
    // ---- setor
    function abrirSetor() {
      App.$('#form-setor').reset();
      App.$('#setor-error').textContent = '';
      App.openModal('modal-setor');
    }
    App.$('#btn-novo-setor').addEventListener('click', abrirSetor);
    App.$('#btn-primeiro-setor').addEventListener('click', abrirSetor);

    App.$('#form-setor').addEventListener('submit', function (e) {
      e.preventDefault();
      var nome = App.$('#setor-nome').value.trim();
      if (!nome) return;
      App.$('#setor-error').textContent = '';
      App.post('/api/sectors', { name: nome }).then(function () {
        App.closeModal('modal-setor');
        App.toast('Setor "' + nome + '" criado.', 'ok');
        return carregarTudo();
      }).catch(function (e2) { App.$('#setor-error').textContent = e2.message; });
    });

    // ---- usuario
    var campoUser = App.$('#usuario-username');
    var campoNome = App.$('#usuario-nome');
    var userEditado = false;
    campoUser.addEventListener('input', function () { userEditado = true; });
    campoNome.addEventListener('input', function () {
      if (!userEditado) campoUser.value = sugerirUsername(campoNome.value);
    });

    App.$('#usuario-papel').addEventListener('change', function (e) {
      App.$('#campo-setor-usuario').hidden = e.target.value !== 'gestor';
    });

    App.$('#btn-novo-usuario').addEventListener('click', function () {
      if (!state.sectors.filter(function (s) { return s.active; }).length) {
        App.toast('Crie um setor ativo antes de cadastrar um gestor.', 'err');
      }
      App.$('#form-usuario').reset();
      App.$('#usuario-error').textContent = '';
      App.$('#usuario-senha').value = App.gerarSenha();
      App.$('#campo-setor-usuario').hidden = false;
      userEditado = false;
      App.openModal('modal-usuario');
    });

    App.$('#btn-gerar-senha').addEventListener('click', function () {
      App.$('#usuario-senha').value = App.gerarSenha();
      App.$('#usuario-senha').type = 'text';
    });

    App.$('#form-usuario').addEventListener('submit', function (e) {
      e.preventDefault();
      App.$('#usuario-error').textContent = '';
      var papel = App.$('#usuario-papel').value;
      var setorId = Number(App.$('#usuario-setor').value);

      if (papel === 'gestor' && !setorId) {
        App.$('#usuario-error').textContent = 'Crie um setor ativo antes de cadastrar um gestor.';
        return;
      }

      var body = {
        name: campoNome.value.trim(),
        username: campoUser.value.trim(),
        password: App.$('#usuario-senha').value,
        role: papel,
        sectorId: papel === 'gestor' ? setorId : null
      };

      App.post('/api/users', body).then(function () {
        App.closeModal('modal-usuario');
        mostrarCredenciais(body.name, body.username, body.password);
        return carregarTudo();
      }).catch(function (e2) { App.$('#usuario-error').textContent = e2.message; });
    });

    // ---- reset de senha
    App.$('#btn-gerar-reset').addEventListener('click', function () {
      App.$('#reset-senha').value = App.gerarSenha();
      App.$('#reset-senha').type = 'text';
    });

    App.$('#form-reset').addEventListener('submit', function (e) {
      e.preventDefault();
      var senha = App.$('#reset-senha').value;
      var alvo = state.users.filter(function (u) { return u.id === state.resetTargetId; })[0];
      App.$('#reset-error').textContent = '';
      App.post('/api/users/' + state.resetTargetId + '/reset-password', { password: senha }).then(function () {
        App.closeModal('modal-reset');
        if (alvo) mostrarCredenciais(alvo.name, alvo.username, senha);
        else App.toast('Senha redefinida.', 'ok');
      }).catch(function (e2) { App.$('#reset-error').textContent = e2.message; });
    });

    // ---- credenciais
    App.$('#btn-copiar-cred').addEventListener('click', function () {
      var btn = App.$('#btn-copiar-cred');
      App.copiar(App.$('#cred-texto').textContent).then(function (ok) {
        btn.textContent = ok ? 'Copiado!' : 'Copie manualmente';
        setTimeout(function () { btn.textContent = 'Copiar'; }, 2000);
      });
    });

    // botoes "Cancelar"/"Pronto" de qualquer modal
    App.$all('[data-fechar]').forEach(function (b) {
      b.addEventListener('click', function () { App.closeModal(b.getAttribute('data-fechar')); });
    });
  }

  function mostrarCredenciais(nome, username, senha) {
    App.$('#cred-texto').textContent = 'Usu\u00e1rio: ' + username + '  |  Senha: ' + senha;
    App.$('#t-cred').textContent = 'Credenciais de ' + nome;
    App.openModal('modal-credenciais');
  }

  function bindEventos() {
    bindSetores();
    bindUsuarios();
    bindFormularios();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
