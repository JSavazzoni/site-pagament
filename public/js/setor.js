'use strict';
(function () {
  var Calc = window.Calc;
  var state = { competencia: '', config: null, sector: null, itens: [], user: null };
  var TB = null;
  var saveTimers = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- carregamento ---------------- */

  function init() {
    TB = App.$('#tbody-folha');
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'gestor') { location.replace('/painel.html'); return; }
      state.user = data.user;
      App.$('#user-name').textContent = data.user.name;
      App.$('#user-role').textContent = 'Gestor · ' + (data.user.sectorName || '');
      App.$('#brand-sub').textContent = data.user.sectorName || '';

      state.competencia = App.mesAtualInput();
      App.$('#competencia').value = state.competencia;
      bindEventos();
      carregarTudo();
    }).catch(function () { location.replace('/login.html'); });
  }

  function carregarTudo() {
    Promise.all([
      App.get('/api/config/' + state.competencia),
      App.get('/api/payroll?competencia=' + state.competencia)
    ]).then(function (results) {
      state.config = results[0];
      state.sector = results[1].sector;
      state.itens = results[1].itens;
      renderConfig();
      renderTabela();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  function renderConfig() {
    var c = state.config;
    App.$('#taxa-conversao').value = 'R$ ' + Calc.num(c.taxaConversao) + ' por US$ 1' + (c.taxaConversaoAuto ? ' (ao vivo)' : '');
    App.$('#dias-uteis').value = c.diasUteis + ' dias';
    App.$('#taxa-wise').value = Calc.num(c.taxaWisePct) + '%';
  }

  /* ---------------- render ---------------- */

  function linhaFolha(it, i) {
    var travado = it.pago;
    return '<tr data-id="' + it.id + '"' + (travado ? ' class="is-pago"' : '') + '>' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td><input class="cell nome" data-f="nome" placeholder="Nome" value="' + esc(it.nome) + '"' + (travado ? ' disabled' : '') + '></td>' +
      moneyTd('salarioBase', it.salarioBase, travado) +
      moneyTd('comissao', it.comissao, travado) +
      moneyTd('aluguel', it.aluguel, travado) +
      moneyTd('bonificacao', it.bonificacao, travado) +
      '<td class="calc calc-total" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario" data-c="diario">R$ 0,00</td>' +
      '<td><input class="cell" data-f="cidade" placeholder="—" value="' + esc(it.cidade) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" data-f="cargo" placeholder="—" value="' + esc(it.cargo) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" type="date" data-f="data" value="' + esc(it.data) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" data-f="obs" placeholder="—" value="' + esc(it.obs) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><div class="wise-cell">' +
        '<input class="cell" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + (travado ? ' disabled' : '') + '>' +
        '<a class="wise-link" target="_blank" rel="noopener" title="Abrir link Wise">↗</a>' +
      '</div></td>' +
      '<td>' + statusBadge(it) + '</td>' +
      '<td class="acao">' + (travado ? '' : '<button class="btn-icon" data-del type="button" title="Remover" aria-label="Remover">×</button>') + '</td>' +
      '</tr>';
  }

  function moneyTd(field, val, travado) {
    var v = Calc.parseNum(val);
    return '<td><input class="cell money" data-f="' + field + '" inputmode="decimal" placeholder="0,00" value="' +
      (v ? Calc.num(v) : '') + '"' + (travado ? ' disabled' : '') + '></td>';
  }

  function statusBadge(it) {
    return it.pago
      ? '<span class="badge badge-accent">Pago</span>'
      : '<span class="badge badge-neutral">Pendente</span>';
  }

  function renderTabela() {
    TB.innerHTML = state.itens.map(linhaFolha).join('');
    App.$('#empty-folha').hidden = state.itens.length > 0;
    recalc();
  }

  function recalc() {
    var map = {};
    state.itens.forEach(function (it) { map[it.id] = it; });

    Array.prototype.forEach.call(TB.rows, function (tr) {
      var it = map[Number(tr.dataset.id)];
      if (!it) return;
      var r = Calc.calcItem(it, state.config);
      tr.querySelector('[data-c="total"]').textContent = Calc.brl(r.total);
      tr.querySelector('[data-c="diario"]').textContent = Calc.brl(r.diario);
      var link = tr.querySelector('.wise-link');
      var href = Calc.wiseHref(it.wiseLink);
      link.hidden = !href;
      if (href) { link.href = href; link.classList.add('on'); }
    });

    var totals = Calc.calcTotais(state.itens, state.config);
    App.$('#t-salario').textContent = Calc.brl(sum(state.itens, 'salarioBase'));
    App.$('#t-comissao').textContent = Calc.brl(sum(state.itens, 'comissao'));
    App.$('#t-aluguel').textContent = Calc.brl(sum(state.itens, 'aluguel'));
    App.$('#t-bonificacao').textContent = Calc.brl(sum(state.itens, 'bonificacao'));
    App.$('#t-total').textContent = Calc.brl(totals.total);
    App.$('#t-diario').textContent = Calc.brl(totals.diario);

    App.$('#kpi-qtd').textContent = state.itens.length;
    App.$('#kpi-total-brl').textContent = Calc.brl(totals.total);
    App.$('#kpi-custo-diario').textContent = 'Custo diário: ' + Calc.brl(totals.diario) + ' · ' + state.config.diasUteis + ' dias';
    App.$('#kpi-total-usd').textContent = Calc.usd(totals.dolar);
    App.$('#kpi-taxa-usada').textContent = 'à taxa de ' + Calc.brl(state.config.taxaConversao) + ' / US$';

    var pagos = state.itens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + state.itens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total);
  }

  function sum(itens, field) {
    return itens.reduce(function (acc, it) { return acc + Calc.parseNum(it[field]); }, 0);
  }

  /* ---------------- edicao ---------------- */

  function salvarItem(id, patch) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(function () {
      App.patch('/api/payroll/' + id, patch).then(function (updated) {
        var idx = state.itens.findIndex(function (it) { return it.id === id; });
        if (idx > -1) state.itens[idx] = updated;
        recalc();
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }, 500);
  }

  function bindTabela() {
    TB.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell');
      if (!inp) return;
      var id = Number(inp.closest('tr').dataset.id);
      var it = state.itens.find(function (x) { return x.id === id; });
      if (!it) return;
      var f = inp.dataset.f;
      var val = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      it[f] = val;
      recalc();
      salvarItem(id, mkPatch(f, val));
    });

    TB.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var it = state.itens.find(function (x) { return x.id === Number(inp.closest('tr').dataset.id); });
      if (!it) return;
      var v = Calc.parseNum(it[inp.dataset.f]);
      inp.value = v ? String(v).replace('.', ',') : '';
      inp.select();
    });

    TB.addEventListener('focusout', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var v = Calc.parseNum(inp.value);
      inp.value = v ? Calc.num(v) : '';
    });

    TB.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      var tr = btn.closest('tr');
      var id = Number(tr.dataset.id);
      var it = state.itens.find(function (x) { return x.id === id; });
      if (!it) return;
      if (!confirm('Remover ' + (it.nome || 'este colaborador') + ' da folha?')) return;
      App.del('/api/payroll/' + id).then(function () {
        state.itens = state.itens.filter(function (x) { return x.id !== id; });
        renderTabela();
      }).catch(function (e2) { App.toast(e2.message, 'err'); });
    });

    TB.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest('.cell');
      if (!inp) return;
      e.preventDefault();
      var tr = inp.closest('tr');
      var next = tr.nextElementSibling;
      if (next) {
        var alvo = next.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) alvo.focus();
      } else {
        addColaborador();
      }
    });
  }

  function mkPatch(field, val) {
    var p = {};
    p[field] = val;
    return p;
  }

  function addColaborador() {
    App.post('/api/payroll', { competencia: state.competencia, nome: '' }).then(function (created) {
      state.itens.push(created);
      renderTabela();
      var last = TB.rows[TB.rows.length - 1];
      if (last) last.querySelector('[data-f="nome"]').focus();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  /* ---------------- eventos gerais ---------------- */

  function bindEventos() {
    bindTabela();

    App.$('#competencia').addEventListener('change', function (e) {
      state.competencia = e.target.value || App.mesAtualInput();
      carregarTudo();
    });

    App.$('#btn-copiar-mes').addEventListener('click', function () {
      App.post('/api/payroll/copy-previous', { competencia: state.competencia }).then(function (r) {
        if (r.copied) { App.toast(r.copied + ' colaboradores copiados.', 'ok'); carregarTudo(); }
        else App.toast('Nenhum mês anterior encontrado para copiar.', 'err');
      }).catch(function (e) {
        if (e.status === 409) {
          if (confirm('Já existem colaboradores nesta competência. Substituir pelos do mês anterior?')) {
            App.post('/api/payroll/copy-previous', { competencia: state.competencia, replace: true }).then(function (r) {
              App.toast(r.copied + ' colaboradores copiados.', 'ok');
              carregarTudo();
            }).catch(function (e2) { App.toast(e2.message, 'err'); });
          }
        } else App.toast(e.message, 'err');
      });
    });

    App.$('#btn-add').addEventListener('click', addColaborador);

    App.$('#btn-export-csv').addEventListener('click', function () {
      location.href = '/api/payroll/export.csv?competencia=' + encodeURIComponent(state.competencia);
    });

    App.$('#btn-import-csv').addEventListener('click', function () { App.$('#file-csv').click(); });
    App.$('#file-csv').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        fetch('/api/payroll/import?competencia=' + encodeURIComponent(state.competencia), {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'text/csv' },
          body: String(reader.result)
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) { App.toast(res.d.error || 'Erro ao importar.', 'err'); return; }
            App.toast(res.d.imported + ' colaboradores importados.', 'ok');
            carregarTudo();
          })
          .catch(function () { App.toast('Erro ao importar CSV.', 'err'); });
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });

    App.$('#btn-print').addEventListener('click', function () { window.print(); });

    App.$('#btn-logout').addEventListener('click', function () {
      App.post('/api/auth/logout').then(function () { location.href = '/login.html'; })
        .catch(function () { location.href = '/login.html'; });
    });

    App.$('#btn-senha').addEventListener('click', function () { App.openModal('modal-senha'); });
    App.$('#btn-senha-cancelar').addEventListener('click', function () { App.closeModal('modal-senha'); });
    App.$('#form-senha').addEventListener('submit', function (e) {
      e.preventDefault();
      var atual = App.$('#senha-atual').value;
      var nova = App.$('#senha-nova').value;
      App.$('#senha-error').textContent = '';
      App.post('/api/auth/change-password', { currentPassword: atual, newPassword: nova }).then(function () {
        App.closeModal('modal-senha');
        App.$('#form-senha').reset();
        App.toast('Senha alterada com sucesso.', 'ok');
      }).catch(function (e) { App.$('#senha-error').textContent = e.message; });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
