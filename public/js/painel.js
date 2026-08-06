'use strict';
(function () {
  var Calc = window.Calc;
  var state = { competencia: '', config: null, summary: null, quote: null, openSectors: {} };
  var saveTimers = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- carregamento ---------------- */

  function init() {
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'cco') { location.replace('/setor.html'); return; }
      App.$('#user-name').textContent = data.user.name;
      state.competencia = App.mesAtualInput();
      App.$('#competencia').value = state.competencia;
      bindEventos();
      carregarTudo();
      setInterval(carregarQuote, 5 * 60 * 1000);
    }).catch(function () { location.replace('/login.html'); });
  }

  function carregarTudo() {
    App.$('#brand-sub').textContent = 'Competência ' + Calc.labelCompetencia(state.competencia);
    return Promise.all([
      App.get('/api/config/' + state.competencia),
      App.get('/api/payroll/summary?competencia=' + state.competencia),
      carregarQuote()
    ]).then(function (results) {
      state.config = results[0];
      state.summary = results[1];
      renderConfigForm();
      renderSetores();
      renderKpis();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  function carregarQuote() {
    return App.get('/api/quote').then(function (q) {
      state.quote = q;
      renderQuote();
      return q;
    }).catch(function () {
      App.$('#cotacao-time').textContent = 'Cotação indisponível';
    });
  }

  function renderQuote() {
    var q = state.quote;
    if (!q) return;
    App.$('#cotacao-usd').textContent = 'US$ 1 = ' + Calc.brl(q.usd);
    var d = new Date(q.at);
    App.$('#cotacao-time').textContent = 'Atualizado ' + d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + (q.source ? ' · ' + q.source : '');
  }

  function renderConfigForm() {
    var c = state.config;
    App.$('#taxa-conversao').value = Calc.rate(c.taxaConversao);
    App.$('#dias-uteis').value = c.diasUteis;
    App.$('#taxa-wise').value = Calc.num(c.taxaWisePct);
    App.$('#auto-cotacao').checked = c.taxaConversaoAuto;
    App.$('#taxa-conversao').disabled = c.taxaConversaoAuto;
    App.$('#btn-usar-cotacao').disabled = c.taxaConversaoAuto;
  }

  function saveConfigField(patch) {
    var body = Object.assign({
      diasUteis: state.config.diasUteis,
      taxaWisePct: state.config.taxaWisePct,
      taxaConversao: state.config.taxaConversao,
      taxaConversaoAuto: state.config.taxaConversaoAuto
    }, patch);
    return fetch('/api/config/' + state.competencia, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Erro ao salvar configuração.');
        return d;
      });
    }).then(function (updated) {
      state.config = updated;
      renderConfigForm();
      recalcTudoLocal();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  /* ---------------- KPIs ---------------- */

  function renderKpis() {
    var s = state.summary;
    var totalItens = s.sectors.reduce(function (a, sec) { return a + sec.itensCount; }, 0);
    App.$('#kpi-qtd').textContent = totalItens;
    App.$('#kpi-setores').textContent = s.sectors.length + ' setor' + (s.sectors.length === 1 ? '' : 'es');
    App.$('#kpi-total-brl').textContent = Calc.brl(s.geral.total);
    App.$('#kpi-custo-diario').textContent = 'Custo diário: ' + Calc.brl(s.geral.diario);
    App.$('#kpi-total-usd').textContent = Calc.usd(s.geral.dolar);
    App.$('#kpi-total-usd-taxas').textContent = 'c/ taxas: ' + Calc.usd(s.geral.totalUsd);

    var todosItens = s.sectors.reduce(function (a, sec) { return a.concat(sec.itens); }, []);
    var pagos = todosItens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + todosItens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total);

    var el = App.$('#kpi-diferenca');
    if (!state.quote || !state.quote.usd) {
      App.$('#kpi-custo-real').textContent = '—';
      el.className = 'kpi-foot';
      el.textContent = 'Cotação indisponível';
    } else if (!s.geral.total) {
      App.$('#kpi-custo-real').textContent = '—';
      el.className = 'kpi-foot';
      el.textContent = 'Sem colaboradores nesta competência';
    } else {
      var custoReal = s.geral.totalUsd * state.quote.usd;
      App.$('#kpi-custo-real').textContent = Calc.brl(custoReal);
      var delta = custoReal - s.geral.total;
      var pct = (delta / s.geral.total) * 100;
      el.className = 'kpi-foot delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
      el.textContent = (delta >= 0 ? '+' : '−') + Calc.brl(Math.abs(delta)) + ' (' + (delta >= 0 ? '+' : '−') + Calc.num(Math.abs(pct)) + '%) vs. folha';
    }
  }

  /* ---------------- setores ---------------- */

  function renderSetores() {
    var box = App.$('#setores-container');
    var sectors = state.summary.sectors;
    App.$('#empty-geral').hidden = sectors.length > 0;

    box.innerHTML = sectors.map(function (sec) {
      var aberto = state.openSectors[sec.sectorId] !== false; // aberto por padrao
      return '' +
        '<div class="sector-block' + (aberto ? ' open' : '') + '" data-sector="' + sec.sectorId + '">' +
          '<div class="sector-head" data-toggle-sector="' + sec.sectorId + '">' +
            '<div class="sector-head-left">' +
              '<span class="sector-caret">▶</span>' +
              '<span class="sector-name">' + esc(sec.sectorName) + (sec.sectorActive ? '' : ' <span class="badge badge-neutral">inativo</span>') + '</span>' +
              '<span class="badge badge-neutral">' + sec.itensCount + ' colaborador' + (sec.itensCount === 1 ? '' : 'es') + '</span>' +
            '</div>' +
            '<div class="sector-totals">' +
              '<span>Total: <strong data-sub="total">' + Calc.brl(sec.totals.total) + '</strong></span>' +
              '<span>Dólar: <strong data-sub="dolar">' + Calc.usd(sec.totals.dolar) + '</strong></span>' +
              '<span>c/ taxas: <strong data-sub="totalUsd">' + Calc.usd(sec.totals.totalUsd) + '</strong></span>' +
            '</div>' +
          '</div>' +
          '<div class="sector-body">' +
            '<div class="table-scroll"><table class="grid" data-tabela-setor="' + sec.sectorId + '">' +
              cabecalhoTabela() +
              '<tbody>' + sec.itens.map(function (it, i) { return linhaItem(it, i); }).join('') + '</tbody>' +
              rodapeTabela(sec.totals) +
            '</table></div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function cabecalhoTabela() {
    return '<thead><tr>' +
      '<th class="col-idx">#</th><th class="col-nome">Nome</th>' +
      '<th class="num">Salário base</th><th class="num">Comissão</th><th class="num">Aluguel/Outros</th><th class="num">Bonificação</th>' +
      '<th class="num calc">Total</th><th class="num calc">Custo diário</th>' +
      '<th class="num calc">Dólar</th><th class="num calc">Taxa Wise</th><th class="num calc">Total c/ taxas</th>' +
      '<th>Cidade</th><th>Cargo</th><th>Data</th><th class="col-obs">OBS</th><th>Wise</th><th>Pago</th>' +
      '<th class="col-acao"><span class="sr-only">Ações</span></th>' +
      '</tr></thead>';
  }

  function rodapeTabela(t) {
    return '<tfoot><tr>' +
      '<td colspan="2" class="total-label">Total</td>' +
      '<td class="num" data-tf="salarioBase">' + Calc.brl(t.salarioBase) + '</td>' +
      '<td class="num" data-tf="comissao">' + Calc.brl(t.comissao) + '</td>' +
      '<td class="num" data-tf="aluguel">' + Calc.brl(t.aluguel) + '</td>' +
      '<td class="num" data-tf="bonificacao">' + Calc.brl(t.bonificacao) + '</td>' +
      '<td class="num calc" data-tf="total">' + Calc.brl(t.total) + '</td>' +
      '<td class="num calc" data-tf="diario">' + Calc.brl(t.diario) + '</td>' +
      '<td class="num calc" data-tf="dolar">' + Calc.usd(t.dolar) + '</td>' +
      '<td class="num calc" data-tf="fee">' + Calc.usd(t.fee) + '</td>' +
      '<td class="num calc" data-tf="totalUsd">' + Calc.usd(t.totalUsd) + '</td>' +
      '<td colspan="6"></td>' +
      '</tr></tfoot>';
  }

  function linhaItem(it, i) {
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
      '<td class="calc calc-usd" data-c="dolar">$0.00</td>' +
      '<td class="calc" data-c="fee">$0.00</td>' +
      '<td class="calc calc-usd" data-c="totalUsd">$0.00</td>' +
      '<td><input class="cell" data-f="cidade" placeholder="—" value="' + esc(it.cidade) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" data-f="cargo" placeholder="—" value="' + esc(it.cargo) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" type="date" data-f="data" value="' + esc(it.data) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" data-f="obs" placeholder="—" value="' + esc(it.obs) + '"' + (travado ? ' disabled' : '') + '></td>' +
      '<td><div class="wise-cell">' +
        '<input class="cell" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + (travado ? ' disabled' : '') + '>' +
        '<a class="wise-link" target="_blank" rel="noopener" title="Abrir link Wise">↗</a>' +
      '</div></td>' +
      '<td><button class="pago-toggle' + (it.pago ? ' on' : '') + '" data-toggle-pago type="button">' + (it.pago ? '✓ Pago' : 'Marcar pago') + '</button></td>' +
      '<td class="acao"><button class="btn-icon" data-del type="button" title="Remover" aria-label="Remover">×</button></td>' +
      '</tr>';
  }

  function moneyTd(field, val, travado) {
    var v = Calc.parseNum(val);
    return '<td><input class="cell money" data-f="' + field + '" inputmode="decimal" placeholder="0,00" value="' +
      (v ? Calc.num(v) : '') + '"' + (travado ? ' disabled' : '') + '></td>';
  }

  /* ---------------- recalculo local (sem re-render do DOM inteiro) ---------------- */

  function findItemAndSector(id) {
    for (var i = 0; i < state.summary.sectors.length; i++) {
      var sec = state.summary.sectors[i];
      for (var j = 0; j < sec.itens.length; j++) {
        if (sec.itens[j].id === id) return { item: sec.itens[j], sector: sec };
      }
    }
    return null;
  }

  function recalcTudoLocal() {
    state.summary.sectors.forEach(function (sec) {
      sec.totals = Calc.calcTotais(sec.itens, state.config);
      atualizarLinhasDoSetor(sec);
    });
    var todos = state.summary.sectors.reduce(function (a, s) { return a.concat(s.itens); }, []);
    state.summary.geral = Calc.calcTotais(todos, state.config);
    renderKpis();
  }

  function atualizarLinhasDoSetor(sec) {
    var tabela = App.$('[data-tabela-setor="' + sec.sectorId + '"]');
    if (!tabela) return;
    sec.itens.forEach(function (it) {
      var tr = tabela.querySelector('tr[data-id="' + it.id + '"]');
      if (!tr) return;
      var r = Calc.calcItem(it, state.config);
      tr.querySelector('[data-c="total"]').textContent = Calc.brl(r.total);
      tr.querySelector('[data-c="diario"]').textContent = Calc.brl(r.diario);
      tr.querySelector('[data-c="dolar"]').textContent = Calc.usd(r.dolar);
      tr.querySelector('[data-c="fee"]').textContent = Calc.usd(r.fee);
      tr.querySelector('[data-c="totalUsd"]').textContent = Calc.usd(r.totalUsd);
    });
    var t = sec.totals;
    ['salarioBase', 'comissao', 'aluguel', 'bonificacao'].forEach(function (f) {
      var cell = tabela.querySelector('[data-tf="' + f + '"]');
      if (cell) cell.textContent = Calc.brl(t[f]);
    });
    var tfTotal = tabela.querySelector('[data-tf="total"]'); if (tfTotal) tfTotal.textContent = Calc.brl(t.total);
    var tfDiario = tabela.querySelector('[data-tf="diario"]'); if (tfDiario) tfDiario.textContent = Calc.brl(t.diario);
    var tfDolar = tabela.querySelector('[data-tf="dolar"]'); if (tfDolar) tfDolar.textContent = Calc.usd(t.dolar);
    var tfFee = tabela.querySelector('[data-tf="fee"]'); if (tfFee) tfFee.textContent = Calc.usd(t.fee);
    var tfTotalUsd = tabela.querySelector('[data-tf="totalUsd"]'); if (tfTotalUsd) tfTotalUsd.textContent = Calc.usd(t.totalUsd);

    var head = document.querySelector('.sector-block[data-sector="' + sec.sectorId + '"] .sector-head');
    if (head) {
      head.querySelector('[data-sub="total"]').textContent = Calc.brl(t.total);
      head.querySelector('[data-sub="dolar"]').textContent = Calc.usd(t.dolar);
      head.querySelector('[data-sub="totalUsd"]').textContent = Calc.usd(t.totalUsd);
    }
  }

  /* ---------------- edicao ---------------- */

  function salvarItem(id, patch) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(function () {
      App.patch('/api/payroll/' + id, patch).catch(function (e) { App.toast(e.message, 'err'); });
    }, 500);
  }

  function bindTabelaEventos() {
    var box = App.$('#setores-container');

    box.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell');
      if (!inp) return;
      var id = Number(inp.closest('tr').dataset.id);
      var found = findItemAndSector(id);
      if (!found) return;
      var f = inp.dataset.f;
      found.item[f] = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      recalcTudoLocal();
      salvarItem(id, mkPatch(f, found.item[f]));
    });

    box.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var found = findItemAndSector(Number(inp.closest('tr').dataset.id));
      if (!found) return;
      var v = Calc.parseNum(found.item[inp.dataset.f]);
      inp.value = v ? String(v).replace('.', ',') : '';
      inp.select();
    });

    box.addEventListener('focusout', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var v = Calc.parseNum(inp.value);
      inp.value = v ? Calc.num(v) : '';
    });

    box.addEventListener('click', function (e) {
      var toggleSector = e.target.closest('[data-toggle-sector]');
      if (toggleSector && !e.target.closest('input,button')) {
        var id = toggleSector.getAttribute('data-toggle-sector');
        var bloco = toggleSector.closest('.sector-block');
        var aberto = bloco.classList.toggle('open');
        state.openSectors[id] = aberto;
        return;
      }

      var togglePago = e.target.closest('[data-toggle-pago]');
      if (togglePago) {
        var tr = togglePago.closest('tr');
        var itemId = Number(tr.dataset.id);
        var found = findItemAndSector(itemId);
        if (!found) return;
        var novoPago = !found.item.pago;
        App.patch('/api/payroll/' + itemId + '/pago', { pago: novoPago }).then(function (updated) {
          found.item.pago = updated.pago;
          found.item.pagoEm = updated.pagoEm;
          carregarTudo(); // reconstroi: item pago trava os campos e some o botao de remover
        }).catch(function (e2) { App.toast(e2.message, 'err'); });
        return;
      }

      var del = e.target.closest('[data-del]');
      if (del) {
        var trDel = del.closest('tr');
        var delId = Number(trDel.dataset.id);
        var foundDel = findItemAndSector(delId);
        if (!foundDel) return;
        if (!confirm('Remover ' + (foundDel.item.nome || 'este colaborador') + ' da folha?')) return;
        App.del('/api/payroll/' + delId).then(function () {
          foundDel.sector.itens = foundDel.sector.itens.filter(function (x) { return x.id !== delId; });
          foundDel.sector.itensCount = foundDel.sector.itens.length;
          renderSetores();
          recalcTudoLocal();
        }).catch(function (e2) { App.toast(e2.message, 'err'); });
      }
    });
  }

  function mkPatch(field, val) {
    var p = {};
    p[field] = val;
    return p;
  }

  /* ---------------- eventos gerais ---------------- */

  function bindEventos() {
    bindTabelaEventos();

    App.$('#competencia').addEventListener('change', function (e) {
      state.competencia = e.target.value || App.mesAtualInput();
      carregarTudo();
    });

    App.$('#taxa-conversao').addEventListener('change', function (e) {
      var v = Calc.parseNum(e.target.value);
      if (v <= 0) { App.toast('A taxa precisa ser maior que zero.', 'err'); v = state.config.taxaConversao; }
      saveConfigField({ taxaConversao: v });
    });
    App.$('#dias-uteis').addEventListener('change', function (e) {
      var v = Math.min(31, Math.max(1, Math.round(Calc.parseNum(e.target.value)) || 26));
      saveConfigField({ diasUteis: v });
    });
    App.$('#taxa-wise').addEventListener('change', function (e) {
      var v = Math.max(0, Calc.parseNum(e.target.value));
      saveConfigField({ taxaWisePct: v });
    });
    App.$('#auto-cotacao').addEventListener('change', function (e) {
      var patch = { taxaConversaoAuto: e.target.checked };
      if (e.target.checked && state.quote) patch.taxaConversao = state.quote.usd;
      saveConfigField(patch);
    });
    App.$('#btn-usar-cotacao').addEventListener('click', function () {
      if (!state.quote) return;
      saveConfigField({ taxaConversao: state.quote.usd });
    });
    App.$('#btn-refresh').addEventListener('click', function () {
      App.$('#btn-refresh').classList.add('loading');
      App.get('/api/quote?force=1').then(function (q) {
        state.quote = q; renderQuote(); renderKpis();
        App.toast('Cotação atualizada: US$ 1 = ' + Calc.brl(q.usd), 'ok');
      }).catch(function (e) { App.toast(e.message, 'err'); })
        .then(function () { App.$('#btn-refresh').classList.remove('loading'); });
    });

    App.$('#btn-export-csv').addEventListener('click', function () {
      location.href = '/api/payroll/export.csv?competencia=' + encodeURIComponent(state.competencia);
    });
    App.$('#btn-export-wise').addEventListener('click', function () {
      location.href = '/api/payroll/export-wise.csv?competencia=' + encodeURIComponent(state.competencia);
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
