'use strict';
(function () {
  var state = { sectors: [], users: [], resetTargetId: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  function init() {
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'cco') { location.replace('/setor.html'); return; }
      App.$('#user-name').textContent = data.user.name;
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

  /* ---------------- setores ---------------- */

  function renderSetores() {
    var tb = App.$('#tbody-setores');
    App.$('#empty-setores').hidden = state.sectors.length > 0;
    tb.innerHTML = state.sectors.map(function (s) {
      return '<tr data-id="' + s.id + '">' +
        '<td><input class="cell nome" data-f-setor="name" value="' + esc(s.name) + '"></td>' +
        '<td>' + (s.active ? '<span class="badge badge-accent">Ativo</span>' : '<span class="badge badge-neutral">Inativo</span>') + '</td>' +
        '<td class="num">' + s.gestorCount + '</td>' +
        '<td>' + fmtData(s.createdAt) + '</td>' +
        '<td class="acao"><button class="btn btn-sm ' + (s.active ? 'btn-danger' : '') + '" data-toggle-setor type="button">' + (s.active ? 'Desativar' : 'Ativar') + '</button></td>' +
        '</tr>';
    }).join('');
  }

  function bindSetores() {
    var tb = App.$('#tbody-setores');

    tb.addEventListener('focusout', function (e) {
      var inp = e.target.closest('[data-f-setor="name"]');
      if (!inp) return;
      var id = Number(inp.closest('tr').dataset.id);
      var nome = inp.value.trim();
      var atual = state.sectors.find(function (s) { return s.id === id; });
      if (!nome || (atual && nome === atual.name)) { if (atual) inp.value = atual.name; return; }
      App.patch('/api/sectors/' + id, { name: nome }).then(function (updated) {
        var idx = state.sectors.findIndex(function (s) { return s.id === id; });
        state.sectors[idx] = updated;
        App.toast('Setor renomeado.', 'ok');
        preencherSelectSetor();
      }).catch(function (e2) {
        App.toast(e2.message, 'err');
        if (atual) inp.value = atual.name;
      });
    });

    tb.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toggle-setor]');
      if (!btn) return;
      var id = Number(btn.closest('tr').dataset.id);
      var s = state.sectors.find(function (x) { return x.id === id; });
      if (!s) return;
      var novo = !s.active;
      if (novo === false && !confirm('Desativar o setor "' + s.name + '"? Gestores desse setor nao poderao mais editar a folha.')) return;
      App.patch('/api/sectors/' + id, { active: novo }).then(function (updated) {
        var idx = state.sectors.findIndex(function (x) { return x.id === id; });
        state.sectors[idx] = updated;
        renderSetores();
        preencherSelectSetor();
        App.toast('Setor ' + (novo ? 'ativado' : 'desativado') + '.', 'ok');
      }).catch(function (e2) { App.toast(e2.message, 'err'); });
    });
  }

  function preencherSelectSetor() {
    var sel = App.$('#usuario-setor');
    var ativos = state.sectors.filter(function (s) { return s.active; });
    sel.innerHTML = ativos.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
  }

  /* ---------------- usuarios ---------------- */

  function renderUsuarios() {
    var tb = App.$('#tbody-usuarios');
    App.$('#empty-usuarios').hidden = state.users.length > 0;
    tb.innerHTML = state.users.map(function (u) {
      var papelBadge = u.role === 'cco' ? '<span class="badge badge-blue">CCO</span>' : '<span class="badge badge-neutral">Gestor</span>';
      var setorCell = u.role === 'gestor' ? setorSelectHtml(u) : '<span class="hint">—</span>';
      return '<tr data-id="' + u.id + '">' +
        '<td class="ro-left" style="font-weight:600;padding:9px 10px;">' + esc(u.name) + '</td>' +
        '<td><code style="font-size:12px;color:var(--ink-2)">' + esc(u.username) + '</code></td>' +
        '<td>' + papelBadge + '</td>' +
        '<td>' + setorCell + '</td>' +
        '<td>' + (u.active ? '<span class="badge badge-accent">Ativo</span>' : '<span class="badge badge-neutral">Inativo</span>') + '</td>' +
        '<td class="acao" style="white-space:nowrap;">' +
          '<button class="btn btn-sm btn-ghost" data-reset-senha type="button">Senha</button> ' +
          '<button class="btn btn-sm ' + (u.active ? 'btn-danger' : '') + '" data-toggle-usuario type="button">' + (u.active ? 'Desativar' : 'Ativar') + '</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function setorSelectHtml(u) {
    var opts = state.sectors.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === u.sectorId ? ' selected' : '') + (s.active ? '' : ' disabled') + '>' + esc(s.name) + (s.active ? '' : ' (inativo)') + '</option>';
    }).join('');
    return '<select class="input" data-mudar-setor style="padding:5px 8px;font-size:12.5px;">' + opts + '</select>';
  }

  function bindUsuarios() {
    var tb = App.$('#tbody-usuarios');

    tb.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-mudar-setor]');
      if (!sel) return;
      var id = Number(sel.closest('tr').dataset.id);
      App.patch('/api/users/' + id, { sectorId: Number(sel.value) }).then(function (updated) {
        var idx = state.users.findIndex(function (u) { return u.id === id; });
        state.users[idx] = updated;
        App.toast('Setor do gestor atualizado.', 'ok');
      }).catch(function (e2) { App.toast(e2.message, 'err'); renderUsuarios(); });
    });

    tb.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-usuario]');
      if (toggle) {
        var id = Number(toggle.closest('tr').dataset.id);
        var u = state.users.find(function (x) { return x.id === id; });
        if (!u) return;
        var novo = !u.active;
        if (!novo && !confirm('Desativar o acesso de "' + u.name + '"? As sessoes abertas dessa pessoa serao encerradas.')) return;
        App.patch('/api/users/' + id, { active: novo }).then(function (updated) {
          var idx = state.users.findIndex(function (x) { return x.id === id; });
          state.users[idx] = updated;
          renderUsuarios();
          App.toast('Usuário ' + (novo ? 'ativado' : 'desativado') + '.', 'ok');
        }).catch(function (e2) { App.toast(e2.message, 'err'); });
        return;
      }

      var reset = e.target.closest('[data-reset-senha]');
      if (reset) {
        var idR = Number(reset.closest('tr').dataset.id);
        var uR = state.users.find(function (x) { return x.id === idR; });
        if (!uR) return;
        state.resetTargetId = idR;
        App.$('#reset-usuario-label').textContent = 'Definir uma nova senha para "' + uR.name + '" (' + uR.username + ').';
        App.$('#reset-error').textContent = '';
        App.$('#reset-senha').value = '';
        App.openModal('modal-reset');
      }
    });
  }

  /* ---------------- formularios de criacao ---------------- */

  function bindFormularios() {
    App.$('#btn-novo-setor').addEventListener('click', function () {
      App.$('#form-setor').hidden = !App.$('#form-setor').hidden;
      if (!App.$('#form-setor').hidden) App.$('#setor-nome').focus();
    });
    App.$('#btn-cancelar-setor').addEventListener('click', function () {
      App.$('#form-setor').hidden = true;
      App.$('#form-setor').reset();
    });
    App.$('#form-setor').addEventListener('submit', function (e) {
      e.preventDefault();
      var nome = App.$('#setor-nome').value.trim();
      if (!nome) return;
      App.post('/api/sectors', { name: nome }).then(function () {
        App.$('#form-setor').reset();
        App.$('#form-setor').hidden = true;
        App.toast('Setor criado.', 'ok');
        return carregarTudo();
      }).catch(function (e2) { App.toast(e2.message, 'err'); });
    });

    App.$('#usuario-papel').addEventListener('change', function (e) {
      App.$('#campo-setor-usuario').hidden = e.target.value !== 'gestor';
    });

    App.$('#btn-novo-usuario').addEventListener('click', function () {
      var f = App.$('#form-usuario');
      f.hidden = !f.hidden;
      App.$('#campo-setor-usuario').hidden = App.$('#usuario-papel').value !== 'gestor';
      if (!f.hidden) App.$('#usuario-nome').focus();
    });
    App.$('#btn-cancelar-usuario').addEventListener('click', function () {
      App.$('#form-usuario').hidden = true;
      App.$('#form-usuario').reset();
      App.$('#usuario-error').textContent = '';
    });
    App.$('#form-usuario').addEventListener('submit', function (e) {
      e.preventDefault();
      App.$('#usuario-error').textContent = '';
      var papel = App.$('#usuario-papel').value;
      var body = {
        name: App.$('#usuario-nome').value.trim(),
        username: App.$('#usuario-username').value.trim(),
        password: App.$('#usuario-senha').value,
        role: papel,
        sectorId: papel === 'gestor' ? Number(App.$('#usuario-setor').value) : null
      };
      App.post('/api/users', body).then(function () {
        App.$('#form-usuario').reset();
        App.$('#form-usuario').hidden = true;
        App.toast('Usuário criado.', 'ok');
        return carregarTudo();
      }).catch(function (e2) { App.$('#usuario-error').textContent = e2.message; });
    });
  }

  function bindResetModal() {
    App.$('#btn-reset-cancelar').addEventListener('click', function () { App.closeModal('modal-reset'); });
    App.$('#form-reset').addEventListener('submit', function (e) {
      e.preventDefault();
      var senha = App.$('#reset-senha').value;
      App.$('#reset-error').textContent = '';
      App.post('/api/users/' + state.resetTargetId + '/reset-password', { password: senha }).then(function () {
        App.closeModal('modal-reset');
        App.toast('Senha redefinida.', 'ok');
      }).catch(function (e2) { App.$('#reset-error').textContent = e2.message; });
    });
  }

  function bindEventos() {
    bindSetores();
    bindUsuarios();
    bindFormularios();
    bindResetModal();

    App.$('#btn-logout').addEventListener('click', function () {
      App.post('/api/auth/logout').then(function () { location.href = '/login.html'; })
        .catch(function () { location.href = '/login.html'; });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
