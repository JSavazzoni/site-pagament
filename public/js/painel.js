'use strict';
(function () {
  var Calc = window.Calc;
  var esc = App.esc;

  var state = {
    competencia: '',
    config: null,
    summary: null,
    quote: null,
    fechados: {},          // setores explicitamente recolhidos pelo usuario
    modo: 'pagamento',     // 'pagamento' | 'completo'
    busca: ''
  };
  var monthNav = null;
  var saveTimers = {};
  var pendingPatches = {};

  var MODO_KEY = 'folha:modo-painel';

  /* ============================================================
     Inicializacao
     ============================================================ */

  function init() {
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'cco') { location.replace('/setor.html'); return; }
      App.montarUserMenu(data.user);
      App.ligarPwToggles();

      try { state.modo = localStorage.getItem(MODO_KEY) || 'pagamento'; } catch (e) { /* modo privado */ }
      aplicarModoNosBotoes();

      state.competencia = App.mesAtualInput();
      monthNav = App.montarMonthNav('#month-nav', state.competencia, function (comp) {
        state.competencia = comp;
        atualizarBotaoHoje();
        carregarTudo();
      });

      bindEventos();
      atualizarBotaoHoje();
      carregarTudo();
      setInterval(carregarQuote, 5 * 60 * 1000);
    }).catch(function () { location.replace('/login.html'); });
  }

  function atualizarBotaoHoje() {
    App.$('#btn-hoje').hidden = state.competencia === App.mesAtualInput();
  }

  function carregarTudo() {
    App.$('#brand-sub').textContent = App.labelMes(state.competencia);
    var box = App.$('#setores-container');
    box.classList.add('is-busy');
    state.carregando = true;

    return Promise.all([
      App.get('/api/config/' + state.competencia),
      App.get('/api/payroll/summary?competencia=' + state.competencia),
      carregarQuote()
    ]).then(function (r) {
      state.config = r[0];
      state.summary = r[1];
      renderConfig();
      renderSetores();
      // renderSetores() so escreve os totais que ja vieram prontos do servidor; as
      // celulas calculadas de CADA LINHA ficam no placeholder do template ate esta
      // chamada -- sem ela a tela mostraria zeros ate alguem editar algum campo.
      recalcTudoLocal();
      aplicarBusca();
    }).catch(function (e) {
      App.toast(e.message, 'err');
    }).then(function () {
      box.classList.remove('is-busy');
      state.carregando = false;
    });
  }

  /* ============================================================
     Cotacao
     ============================================================ */

  function carregarQuote() {
    return App.get('/api/quote').then(function (q) {
      state.quote = q;
      renderQuote();
      return q;
    }).catch(function () {
      App.$('#quote-chip').classList.add('is-off');
      App.$('#cotacao-usd').textContent = 'indispon\u00edvel';
      App.$('#cotacao-time').textContent = '';
    });
  }

  function renderQuote() {
    var q = state.quote;
    if (!q) return;
    App.$('#quote-chip').classList.remove('is-off');
    App.$('#cotacao-usd').textContent = Calc.brl(q.usd);
    App.$('#cotacao-time').textContent = App.tempoRelativo(q.at);
  }

  /* ============================================================
     Parametros do mes
     ============================================================ */

  function renderConfig() {
    var c = state.config;
    App.$('#taxa-conversao').value = Calc.num(c.taxaConversao);
    App.$('#dias-uteis').value = c.diasUteis;
    App.$('#taxa-wise').value = Calc.num(c.taxaWisePct);
    App.$('#auto-cotacao').checked = c.taxaConversaoAuto;
    App.$('#taxa-conversao').disabled = c.taxaConversaoAuto;
    App.$('#btn-usar-cotacao').disabled = c.taxaConversaoAuto;

    App.$('#sum-taxa').textContent = 'R$ ' + Calc.num(c.taxaConversao) + (c.taxaConversaoAuto ? ' (auto)' : '');
    App.$('#sum-dias').textContent = c.diasUteis;
    App.$('#sum-wise').textContent = Calc.num(c.taxaWisePct) + '%';
  }

  function salvarConfig(patch) {
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
        if (!r.ok) throw new Error(d.error || 'Erro ao salvar configura\u00e7\u00e3o.');
        return d;
      });
    }).then(function (updated) {
      state.config = updated;
      renderConfig();
      recalcTudoLocal();
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  /* ============================================================
     KPIs
     ============================================================ */

  function todosItens() {
    return state.summary.sectors.reduce(function (a, s) { return a.concat(s.itens); }, []);
  }

  function renderKpis() {
    var s = state.summary;
    var itens = todosItens();

    App.$('#kpi-qtd').textContent = itens.length;
    App.$('#kpi-setores').textContent = s.sectors.length + ' setor' + (s.sectors.length === 1 ? '' : 'es');
    App.$('#kpi-total-brl').textContent = Calc.brl(s.geral.total);
    App.$('#kpi-custo-diario').textContent = 'Custo di\u00e1rio: ' + Calc.brl(s.geral.diario);
    App.$('#kpi-total-usd').textContent = Calc.usd(s.geral.dolar);
    App.$('#kpi-total-usd-taxas').textContent = 'c/ taxa Wise: ' + Calc.usd(s.geral.totalUsd);

    var pagos = itens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + itens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total) + ' enviados';
    App.$('#kpi-progress').style.width = (itens.length ? (pagos.length / itens.length) * 100 : 0) + '%';

    var el = App.$('#kpi-diferenca');
    if (!state.quote || !state.quote.usd) {
      App.$('#kpi-custo-real').textContent = '—';
      el.className = 'kpi-foot';
      el.textContent = 'Cota\u00e7\u00e3o indispon\u00edvel';
    } else if (!s.geral.total) {
      App.$('#kpi-custo-real').textContent = '—';
      el.className = 'kpi-foot';
      el.textContent = 'Sem colaboradores neste m\u00eas';
    } else {
      var custoReal = s.geral.totalUsd * state.quote.usd;
      App.$('#kpi-custo-real').textContent = Calc.brl(custoReal);
      var delta = custoReal - s.geral.total;
      var pct = (delta / s.geral.total) * 100;
      el.className = 'kpi-foot delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
      el.textContent = (delta >= 0 ? '+' : '−') + Calc.brl(Math.abs(delta)) +
        ' (' + (delta >= 0 ? '+' : '−') + Calc.num(Math.abs(pct)) + '%) vs. folha';
    }
  }

  /* ============================================================
     Render dos setores
     ============================================================ */

  function renderSetores() {
    var box = App.$('#setores-container');
    var sectors = state.summary.sectors;
    App.$('#empty-geral').hidden = sectors.length > 0;

    box.innerHTML = sectors.map(function (sec) {
      var aberto = !state.fechados[sec.sectorId];
      var pagos = sec.itens.filter(function (it) { return it.pago; }).length;
      var todosPagos = sec.itens.length > 0 && pagos === sec.itens.length;

      return '' +
        '<div class="sector-block' + (aberto ? ' open' : '') + '" data-sector="' + sec.sectorId + '">' +
          '<div class="sector-head" data-toggle-sector>' +
            '<span class="sector-caret">&#9654;</span>' +
            '<span class="sector-name">' + esc(sec.sectorName) +
              (sec.sectorActive ? '' : ' <span class="badge badge-neutral">inativo</span>') +
              statusSetor(pagos, sec.itens.length) +
            '</span>' +
            '<div class="sector-stats">' +
              '<span class="sector-stat"><span class="k">Total</span><span class="v" data-sub="total">' + Calc.brl(sec.totals.total) + '</span></span>' +
              '<span class="sector-stat"><span class="k">Em dolar</span><span class="v usd" data-sub="dolar">' + Calc.usd(sec.totals.dolar) + '</span></span>' +
              '<span class="sector-stat"><span class="k">C/ taxas</span><span class="v usd" data-sub="totalUsd">' + Calc.usd(sec.totals.totalUsd) + '</span></span>' +
            '</div>' +
            '<div class="sector-actions">' +
              (sec.itens.length
                ? '<button class="btn btn-sm" data-pagar-setor type="button">' +
                    (todosPagos ? 'Desmarcar setor' : '&#10003; Pagar setor inteiro') + '</button>'
                : '') +
              '<div class="menu">' +
                '<button class="btn btn-sm" type="button" data-menu-trigger aria-label="Acoes do setor">&#8943;</button>' +
                '<div class="menu-panel" role="menu">' +
                  '<button class="menu-item" data-export-setor type="button" role="menuitem"><span class="mi-ico">&#128184;</span> Lista Wise deste setor</button>' +
                  '<button class="menu-item" data-csv-setor type="button" role="menuitem"><span class="mi-ico">&#128202;</span> CSV deste setor</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sector-body">' +
            '<div class="table-scroll"><table class="grid modo-' + state.modo + '" data-tabela-setor="' + sec.sectorId + '">' +
              cabecalho() +
              '<tbody>' + sec.itens.map(linha).join('') + '</tbody>' +
              rodape(sec.totals) +
            '</table></div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function statusSetor(pagos, total) {
    if (!total) return ' <span class="badge badge-neutral">vazio</span>';
    if (pagos === total) return ' <span class="badge badge-accent">&#10003; pago</span>';
    if (pagos > 0) return ' <span class="badge badge-amber">' + pagos + '/' + total + ' pago</span>';
    return ' <span class="badge badge-neutral">' + total + ' colaborador' + (total === 1 ? '' : 'es') + '</span>';
  }

  function cabecalho() {
    return '<thead><tr>' +
      '<th class="col-idx stick">#</th>' +
      '<th class="col-nome col-flex stick-2">Nome</th>' +
      '<th class="num col-money det sep-l">Sal&aacute;rio base</th>' +
      '<th class="num col-money det">Comiss&atilde;o</th>' +
      '<th class="num col-money det">Aluguel/Outros</th>' +
      '<th class="num col-money det">Bonifica&ccedil;&atilde;o</th>' +
      '<th class="num col-calc sep-l">Total R$</th>' +
      '<th class="num col-calc det">Custo di&aacute;rio</th>' +
      '<th class="num col-calc sep-l">D&oacute;lar</th>' +
      '<th class="num col-calc">Taxa Wise</th>' +
      '<th class="num col-calc">Total US$</th>' +
      '<th class="col-txt det sep-l">Cidade</th>' +
      '<th class="col-txt det">Cargo</th>' +
      '<th class="col-data det">Data</th>' +
      '<th class="col-obs det">OBS</th>' +
      '<th class="col-wise sep-l">Link Wise</th>' +
      '<th class="col-status">Status</th>' +
      '<th class="col-acao"><span class="sr-only">A&ccedil;&otilde;es</span></th>' +
      '</tr></thead>';
  }

  function rodape(t) {
    return '<tfoot><tr>' +
      '<td colspan="2" class="total-label stick">Total do setor</td>' +
      '<td class="num det" data-tf="salarioBase">' + Calc.brl(t.salarioBase) + '</td>' +
      '<td class="num det" data-tf="comissao">' + Calc.brl(t.comissao) + '</td>' +
      '<td class="num det" data-tf="aluguel">' + Calc.brl(t.aluguel) + '</td>' +
      '<td class="num det" data-tf="bonificacao">' + Calc.brl(t.bonificacao) + '</td>' +
      '<td class="num" data-tf="total">' + Calc.brl(t.total) + '</td>' +
      '<td class="num det" data-tf="diario">' + Calc.brl(t.diario) + '</td>' +
      '<td class="num calc-usd" data-tf="dolar">' + Calc.usd(t.dolar) + '</td>' +
      '<td class="num" data-tf="fee">' + Calc.usd(t.fee) + '</td>' +
      '<td class="num calc-usd" data-tf="totalUsd">' + Calc.usd(t.totalUsd) + '</td>' +
      '<td class="det" colspan="4"></td>' +
      '<td colspan="3"></td>' +
      '</tr></tfoot>';
  }

  function linha(it, i) {
    var t = it.pago;
    var d = t ? ' disabled' : '';
    return '<tr data-id="' + it.id + '"' + (t ? ' class="is-pago"' : '') +
        ' data-busca="' + esc([it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase()) + '">' +
      '<td class="idx stick">' + (i + 1) + '</td>' +
      '<td class="stick-2"><input class="cell nome" data-f="nome" placeholder="Nome" value="' + esc(it.nome) + '"' + d + '></td>' +
      money('salarioBase', it.salarioBase, t, ' det sep-l') +
      money('comissao', it.comissao, t, ' det') +
      money('aluguel', it.aluguel, t, ' det') +
      money('bonificacao', it.bonificacao, t, ' det') +
      '<td class="calc calc-total sep-l" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario det" data-c="diario">R$ 0,00</td>' +
      '<td class="calc calc-usd sep-l" data-c="dolar">$0.00</td>' +
      '<td class="calc calc-muted" data-c="fee">$0.00</td>' +
      '<td class="calc calc-usd" data-c="totalUsd">$0.00</td>' +
      '<td class="det sep-l"><input class="cell" data-f="cidade" placeholder="&mdash;" value="' + esc(it.cidade) + '"' + d + '></td>' +
      '<td class="det"><input class="cell" data-f="cargo" placeholder="&mdash;" value="' + esc(it.cargo) + '"' + d + '></td>' +
      '<td class="det"><input class="cell" type="date" data-f="data" value="' + esc(it.data) + '"' + d + '></td>' +
      '<td class="det"><input class="cell" data-f="obs" placeholder="&mdash;" value="' + esc(it.obs) + '"' + d + '></td>' +
      '<td class="sep-l"><div class="wise-cell">' +
        '<input class="cell" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + d + '>' +
        '<a class="wise-link" target="_blank" rel="noopener" title="Abrir link Wise" hidden>&#8599;</a>' +
      '</div></td>' +
      '<td><button class="pago-toggle' + (it.pago ? ' on' : '') + '" data-toggle-pago type="button">' +
        (it.pago ? '&#10003; Pago' : 'Marcar pago') + '</button></td>' +
      '<td class="acao"><button class="btn-icon danger" data-del type="button" title="Remover" aria-label="Remover">&times;</button></td>' +
      '</tr>';
  }

  function money(field, val, travado, extraTd) {
    var v = Calc.parseNum(val);
    return '<td class="' + (extraTd || '').trim() + '"><input class="cell money" data-f="' + field +
      '" inputmode="decimal" placeholder="0,00" value="' + (v ? Calc.num(v) : '') + '"' +
      (travado ? ' disabled' : '') + '></td>';
  }

  /* ============================================================
     Recalculo local (sem re-render do DOM inteiro)
     ============================================================ */

  function acharItem(id) {
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
      atualizarLinhas(sec);
    });
    state.summary.geral = Calc.calcTotais(todosItens(), state.config);
    renderKpis();
  }

  function atualizarLinhas(sec) {
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

      var link = tr.querySelector('.wise-link');
      var href = Calc.wiseHref(it.wiseLink);
      link.hidden = !href;
      if (href) { link.href = href; link.classList.add('on'); }
    });

    var t = sec.totals;
    ['salarioBase', 'comissao', 'aluguel', 'bonificacao', 'total', 'diario'].forEach(function (f) {
      var c = tabela.querySelector('[data-tf="' + f + '"]');
      if (c) c.textContent = Calc.brl(t[f]);
    });
    ['dolar', 'fee', 'totalUsd'].forEach(function (f) {
      var c = tabela.querySelector('[data-tf="' + f + '"]');
      if (c) c.textContent = Calc.usd(t[f]);
    });

    var head = document.querySelector('.sector-block[data-sector="' + sec.sectorId + '"] .sector-head');
    if (head) {
      head.querySelector('[data-sub="total"]').textContent = Calc.brl(t.total);
      head.querySelector('[data-sub="dolar"]').textContent = Calc.usd(t.dolar);
      head.querySelector('[data-sub="totalUsd"]').textContent = Calc.usd(t.totalUsd);
    }
  }

  /* ============================================================
     Edicao
     ============================================================ */

  /** Patch ACUMULA entre chamadas: editar 2 campos dentro dos 500ms nao perde o 1o. */
  function salvarItem(id, campo, valor) {
    var patch = pendingPatches[id] || (pendingPatches[id] = {});
    patch[campo] = valor;
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(function () {
      var envio = pendingPatches[id];
      delete pendingPatches[id];
      App.patch('/api/payroll/' + id, envio).catch(function (e) { App.toast(e.message, 'err'); });
    }, 500);
  }

  function bindTabela() {
    var box = App.$('#setores-container');

    box.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell');
      if (!inp) return;
      var id = Number(inp.closest('tr').dataset.id);
      var found = acharItem(id);
      if (!found) return;
      var f = inp.dataset.f;
      found.item[f] = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      recalcTudoLocal();
      salvarItem(id, f, found.item[f]);
    });

    box.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var found = acharItem(Number(inp.closest('tr').dataset.id));
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

    // Enter desce para a mesma coluna da linha seguinte -- digitacao continua em coluna.
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest('.cell');
      if (!inp) return;
      e.preventDefault();
      var proxima = inp.closest('tr').nextElementSibling;
      if (proxima) {
        var alvo = proxima.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) { alvo.focus(); return; }
      }
      inp.blur();
    });

    box.addEventListener('click', function (e) {
      if (e.target.closest('.menu')) return;

      var cab = e.target.closest('[data-toggle-sector]');
      if (cab && !e.target.closest('input, button, a')) {
        var bloco = cab.closest('.sector-block');
        var aberto = bloco.classList.toggle('open');
        state.fechados[bloco.dataset.sector] = !aberto;
        return;
      }

      var pagarSetor = e.target.closest('[data-pagar-setor]');
      if (pagarSetor) { marcarSetor(pagarSetor); return; }

      var expWise = e.target.closest('[data-export-setor]');
      if (expWise) {
        baixar('/api/payroll/export-wise.csv?competencia=' + enc(state.competencia) +
          '&sectorId=' + expWise.closest('.sector-block').dataset.sector);
        return;
      }
      var expCsv = e.target.closest('[data-csv-setor]');
      if (expCsv) {
        baixar('/api/payroll/export.csv?competencia=' + enc(state.competencia) +
          '&sectorId=' + expCsv.closest('.sector-block').dataset.sector);
        return;
      }

      var toggle = e.target.closest('[data-toggle-pago]');
      if (toggle) { alternarPago(toggle); return; }

      var del = e.target.closest('[data-del]');
      if (del) { removerItem(del); }
    });
  }

  function alternarPago(btn) {
    var tr = btn.closest('tr');
    var id = Number(tr.dataset.id);
    var found = acharItem(id);
    if (!found) return;

    var novo = !found.item.pago;
    btn.disabled = true;
    App.patch('/api/payroll/' + id + '/pago', { pago: novo }).then(function (upd) {
      found.item.pago = upd.pago;
      found.item.pagoEm = upd.pagoEm;
      renderSetores();
      recalcTudoLocal();
      aplicarBusca();
    }).catch(function (e) {
      btn.disabled = false;
      App.toast(e.message, 'err');
    });
  }

  /** Marca (ou desmarca) o setor inteiro de uma vez -- evita 30 cliques no fim do mes. */
  function marcarSetor(btn) {
    var bloco = btn.closest('.sector-block');
    var sec = state.summary.sectors.filter(function (s) {
      return String(s.sectorId) === bloco.dataset.sector;
    })[0];
    if (!sec || !sec.itens.length) return;

    var pagos = sec.itens.filter(function (it) { return it.pago; }).length;
    var marcar = pagos < sec.itens.length;
    var alvos = sec.itens.filter(function (it) { return it.pago !== marcar; });

    App.confirmar({
      titulo: marcar ? 'Marcar setor como pago?' : 'Desmarcar pagamentos?',
      texto: marcar
        ? alvos.length + ' colaborador(es) de "' + sec.sectorName + '" ficar\u00e3o marcados como pagos e travados para o gestor.'
        : alvos.length + ' colaborador(es) de "' + sec.sectorName + '" voltar\u00e3o a ficar pendentes.',
      ok: marcar ? 'Marcar todos' : 'Desmarcar todos',
      perigo: !marcar
    }).then(function (sim) {
      if (!sim) return;
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      var fila = alvos.reduce(function (p, it) {
        return p.then(function () {
          return App.patch('/api/payroll/' + it.id + '/pago', { pago: marcar }).then(function (upd) {
            it.pago = upd.pago;
            it.pagoEm = upd.pagoEm;
          });
        });
      }, Promise.resolve());

      fila.then(function () {
        renderSetores();
        recalcTudoLocal();
        aplicarBusca();
        App.toast(alvos.length + ' lan\u00e7amento(s) atualizados.', 'ok');
      }).catch(function (e) {
        App.toast(e.message, 'err');
        carregarTudo();
      });
    });
  }

  function removerItem(btn) {
    var tr = btn.closest('tr');
    var id = Number(tr.dataset.id);
    var found = acharItem(id);
    if (!found) return;

    App.confirmar({
      titulo: 'Remover da folha?',
      texto: (found.item.nome || 'Este colaborador') + ' ser\u00e1 removido de ' +
        App.labelMes(state.competencia) + '. Os outros meses n\u00e3o s\u00e3o afetados.',
      ok: 'Remover', perigo: true
    }).then(function (sim) {
      if (!sim) return;
      App.del('/api/payroll/' + id).then(function () {
        found.sector.itens = found.sector.itens.filter(function (x) { return x.id !== id; });
        found.sector.itensCount = found.sector.itens.length;
        renderSetores();
        recalcTudoLocal();
        aplicarBusca();
        App.toast('Colaborador removido.', 'ok');
      }).catch(function (e) { App.toast(e.message, 'err'); });
    });
  }

  /* ============================================================
     Busca e modo de exibicao
     ============================================================ */

  function aplicarBusca() {
    var termo = state.busca.trim().toLowerCase();
    var visiveis = 0;
    var temItens = todosItens().length > 0;

    App.$all('.sector-block').forEach(function (bloco) {
      var achouNoBloco = 0;
      App.$all('tbody tr', bloco).forEach(function (tr) {
        var bate = !termo || (tr.dataset.busca || '').indexOf(termo) !== -1;
        tr.classList.toggle('filtered-out', !bate);
        if (bate) achouNoBloco++;
      });
      visiveis += achouNoBloco;
      bloco.hidden = !!termo && achouNoBloco === 0;
      if (termo && achouNoBloco) bloco.classList.add('open');
    });

    App.$('#empty-busca').hidden = !termo || visiveis > 0;
    App.$('#empty-geral').hidden = !!termo || temItens;
  }

  function aplicarModoNosBotoes() {
    App.$all('[data-modo]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.modo === state.modo);
    });
    App.$all('.grid[data-tabela-setor]').forEach(function (t) {
      t.classList.remove('modo-pagamento', 'modo-completo');
      t.classList.add('modo-' + state.modo);
    });
  }

  /* ============================================================
     Eventos gerais
     ============================================================ */

  function enc(s) { return encodeURIComponent(s); }
  function baixar(url) { location.href = url; }

  function bindEventos() {
    bindTabela();

    App.$('#btn-hoje').addEventListener('click', function () {
      monthNav.set(App.mesAtualInput());
      state.competencia = App.mesAtualInput();
      atualizarBotaoHoje();
      carregarTudo();
    });

    // parametros do mes (recolhivel)
    var params = App.$('#params');
    function alternarParams() {
      var aberto = params.classList.toggle('open');
      App.$('#params-head').setAttribute('aria-expanded', String(aberto));
    }
    App.$('#params-head').addEventListener('click', alternarParams);
    App.$('#params-head').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarParams(); }
    });

    /**
     * O change dos campos de configuracao so vale quando NAO ha carregamento em
     * curso: trocar de competencia com o campo focado dispara o change com o valor
     * do mes que saiu e gravaria essa numero no mes novo (ja zerou a taxa Wise uma
     * vez em teste). Em duvida, renderConfig() repoe o valor verdadeiro na tela.
     */
    function mudouConfig(fn) {
      return function (e) {
        if (state.carregando || !state.config) { renderConfig(); return; }
        var bruto = String(e.target.value).trim();
        if (!bruto && e.target.type !== 'checkbox') { renderConfig(); return; }
        fn(e, bruto);
      };
    }

    App.$('#taxa-conversao').addEventListener('change', mudouConfig(function (e) {
      var v = Calc.parseNum(e.target.value);
      if (v <= 0) { App.toast('A taxa precisa ser maior que zero.', 'err'); renderConfig(); return; }
      salvarConfig({ taxaConversao: v });
    }));
    App.$('#dias-uteis').addEventListener('change', mudouConfig(function (e) {
      var v = Math.round(Calc.parseNum(e.target.value));
      if (!v) { renderConfig(); return; }
      salvarConfig({ diasUteis: Math.min(31, Math.max(1, v)) });
    }));
    App.$('#taxa-wise').addEventListener('change', mudouConfig(function (e) {
      salvarConfig({ taxaWisePct: Math.max(0, Calc.parseNum(e.target.value)) });
    }));
    App.$('#auto-cotacao').addEventListener('change', mudouConfig(function (e) {
      var patch = { taxaConversaoAuto: e.target.checked };
      if (e.target.checked && state.quote) patch.taxaConversao = state.quote.usd;
      salvarConfig(patch);
    }));
    App.$('#btn-usar-cotacao').addEventListener('click', function () {
      if (!state.quote) { App.toast('Cota\u00e7\u00e3o indispon\u00edvel no momento.', 'err'); return; }
      salvarConfig({ taxaConversao: state.quote.usd }).then(function () {
        App.toast('Taxa do m\u00eas: ' + Calc.brl(state.config.taxaConversao) + ' por US$ 1.', 'ok');
      });
    });

    App.$('#btn-refresh').addEventListener('click', function (e) {
      e.stopPropagation();
      var chip = App.$('#quote-chip');
      chip.classList.add('is-loading');
      App.get('/api/quote?force=1').then(function (q) {
        state.quote = q;
        renderQuote();
        renderKpis();
        if (state.config.taxaConversaoAuto) salvarConfig({ taxaConversao: q.usd });
        App.toast('Cota\u00e7\u00e3o atualizada: US$ 1 = ' + Calc.brl(q.usd), 'ok');
      }).catch(function (er) { App.toast(er.message, 'err'); })
        .then(function () { chip.classList.remove('is-loading'); });
    });

    // busca
    var busca = App.$('#busca');
    busca.addEventListener('input', App.debounce(function () {
      state.busca = busca.value;
      aplicarBusca();
    }, 120));
    App.$('#busca-clear').addEventListener('click', function () {
      busca.value = ''; state.busca = ''; aplicarBusca(); busca.focus();
    });

    // modo de exibicao
    App.$all('[data-modo]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.modo = b.dataset.modo;
        try { localStorage.setItem(MODO_KEY, state.modo); } catch (e) { /* modo privado */ }
        aplicarModoNosBotoes();
      });
    });

    // menu de acoes
    App.$('#mi-export-csv').addEventListener('click', function () {
      baixar('/api/payroll/export.csv?competencia=' + enc(state.competencia));
    });
    App.$('#mi-export-wise').addEventListener('click', function () {
      baixar('/api/payroll/export-wise.csv?competencia=' + enc(state.competencia));
    });
    App.$('#mi-print').addEventListener('click', function () { window.print(); });
    App.$('#mi-expandir').addEventListener('click', function () {
      var algumFechado = App.$all('.sector-block:not(.open)').length > 0;
      App.$all('.sector-block').forEach(function (b) {
        b.classList.toggle('open', algumFechado);
        state.fechados[b.dataset.sector] = !algumFechado;
      });
    });

    App.$('#btn-ir-admin').addEventListener('click', function () { location.href = '/admin.html'; });

    // "/" foca a busca, como nas ferramentas que a equipe ja usa
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.preventDefault();
      busca.focus();
      busca.select();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
