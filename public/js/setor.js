'use strict';
(function () {
  var Calc = window.Calc;
  var esc = App.esc;

  var state = { competencia: '', config: null, sector: null, itens: [], user: null, busca: '', modo: 'completo' };
  var TB = null;
  var monthNav = null;
  var saveTimers = {};
  var pendingPatches = {};

  var MODO_KEY = 'folha:modo-setor';

  /* ============================================================
     Inicializacao
     ============================================================ */

  function init() {
    TB = App.$('#tbody-folha');

    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'gestor') { location.replace('/painel.html'); return; }
      state.user = data.user;
      App.montarUserMenu(data.user);
      App.ligarPwToggles();

      App.$('#titulo-setor').textContent = data.user.sectorName || 'Meu Setor';

      try { state.modo = localStorage.getItem(MODO_KEY) || 'completo'; } catch (e) { /* modo privado */ }
      aplicarModo();

      state.competencia = App.mesAtualInput();
      monthNav = App.montarMonthNav('#month-nav', state.competencia, function (comp) {
        state.competencia = comp;
        atualizarBotaoHoje();
        carregarTudo();
      });

      bindEventos();
      atualizarBotaoHoje();
      carregarTudo();
    }).catch(function () { location.replace('/login.html'); });
  }

  function atualizarBotaoHoje() {
    App.$('#btn-hoje').hidden = state.competencia === App.mesAtualInput();
  }

  function carregarTudo() {
    App.$('#brand-sub').textContent = App.labelMes(state.competencia);
    App.$('#empty-mes').textContent = App.labelMes(state.competencia);
    var card = App.$('#card-folha');
    card.classList.add('is-busy');

    return Promise.all([
      App.get('/api/config/' + state.competencia),
      App.get('/api/payroll?competencia=' + state.competencia)
    ]).then(function (r) {
      state.config = r[0];
      state.sector = r[1].sector;
      state.itens = r[1].itens;
      renderChips();
      renderTabela();
    }).catch(function (e) {
      App.toast(e.message, 'err');
    }).then(function () {
      card.classList.remove('is-busy');
    });
  }

  function renderChips() {
    var c = state.config;
    App.$('#chip-taxa').textContent = 'R$ ' + Calc.num(c.taxaConversao) + ' / US$ 1' + (c.taxaConversaoAuto ? ' (ao vivo)' : '');
    App.$('#chip-dias').textContent = c.diasUteis + ' dias';
    App.$('#chip-wise').textContent = Calc.num(c.taxaWisePct) + '%';
  }

  /* ============================================================
     Render
     ============================================================ */

  function linha(it, i) {
    var t = it.pago;
    var d = t ? ' disabled' : '';
    return '<tr data-id="' + it.id + '"' + (t ? ' class="is-pago"' : '') +
        ' data-busca="' + esc([it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase()) + '">' +
      '<td class="idx stick">' + (i + 1) + '</td>' +
      '<td class="stick-2"><input class="cell nome" data-f="nome" placeholder="Nome do colaborador" value="' + esc(it.nome) + '"' + d + '></td>' +
      money('salarioBase', it.salarioBase, t, 'sep-l') +
      money('comissao', it.comissao, t, '') +
      money('aluguel', it.aluguel, t, '') +
      money('bonificacao', it.bonificacao, t, '') +
      '<td class="calc calc-total sep-l" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario" data-c="diario">R$ 0,00</td>' +
      '<td class="calc calc-usd" data-c="dolar">$0.00</td>' +
      '<td class="cad sep-l"><input class="cell" data-f="cidade" placeholder="&mdash;" value="' + esc(it.cidade) + '"' + d + '></td>' +
      '<td class="cad"><input class="cell" data-f="cargo" placeholder="&mdash;" value="' + esc(it.cargo) + '"' + d + '></td>' +
      '<td class="cad"><input class="cell" type="date" data-f="data" value="' + esc(it.data) + '"' + d + '></td>' +
      '<td class="cad"><input class="cell" data-f="obs" placeholder="&mdash;" value="' + esc(it.obs) + '"' + d + '></td>' +
      '<td class="cad sep-l"><div class="wise-cell">' +
        '<input class="cell" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + d + '>' +
        '<a class="wise-link" target="_blank" rel="noopener" title="Abrir link Wise" hidden>&#8599;</a>' +
      '</div></td>' +
      '<td>' + (it.pago
        ? '<span class="badge badge-accent">&#10003; Pago</span>'
        : '<span class="badge badge-neutral">Pendente</span>') + '</td>' +
      '<td class="acao">' + (t ? '' :
        '<button class="btn-icon danger" data-del type="button" title="Remover" aria-label="Remover">&times;</button>') + '</td>' +
      '</tr>';
  }

  function money(field, val, travado, extra) {
    var v = Calc.parseNum(val);
    return '<td class="' + extra + '"><input class="cell money" data-f="' + field +
      '" inputmode="decimal" placeholder="0,00" value="' + (v ? Calc.num(v) : '') + '"' +
      (travado ? ' disabled' : '') + '></td>';
  }

  function renderTabela() {
    TB.innerHTML = state.itens.map(linha).join('');
    var vazio = state.itens.length === 0;
    App.$('#empty-folha').hidden = !vazio;
    App.$('.table-scroll', App.$('#card-folha')).hidden = vazio;
    recalc();
    aplicarBusca();
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
      tr.querySelector('[data-c="dolar"]').textContent = Calc.usd(r.dolar);

      var link = tr.querySelector('.wise-link');
      var href = Calc.wiseHref(it.wiseLink);
      link.hidden = !href;
      if (href) { link.href = href; link.classList.add('on'); }
    });

    var totais = Calc.calcTotais(state.itens, state.config);
    App.$('#t-salario').textContent = Calc.brl(totais.salarioBase);
    App.$('#t-comissao').textContent = Calc.brl(totais.comissao);
    App.$('#t-aluguel').textContent = Calc.brl(totais.aluguel);
    App.$('#t-bonificacao').textContent = Calc.brl(totais.bonificacao);
    App.$('#t-total').textContent = Calc.brl(totais.total);
    App.$('#t-diario').textContent = Calc.brl(totais.diario);
    App.$('#t-dolar').textContent = Calc.usd(totais.dolar);

    App.$('#kpi-qtd').textContent = state.itens.length;
    App.$('#kpi-media').textContent = 'M\u00e9dia: ' + Calc.brl(state.itens.length ? totais.total / state.itens.length : 0);
    App.$('#kpi-total-brl').textContent = Calc.brl(totais.total);
    App.$('#kpi-custo-diario').textContent = 'Custo di\u00e1rio: ' + Calc.brl(totais.diario) + ' (' + state.config.diasUteis + ' dias)';
    App.$('#kpi-total-usd').textContent = Calc.usd(totais.dolar);
    App.$('#kpi-taxa-usada').textContent = 'a R$ ' + Calc.num(state.config.taxaConversao) + ' por US$ 1';

    var pagos = state.itens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + state.itens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total) + ' enviados';
    App.$('#kpi-progress').style.width = (state.itens.length ? (pagos.length / state.itens.length) * 100 : 0) + '%';
  }

  /* ============================================================
     Edicao
     ============================================================ */

  /**
   * Debounce por item, mas o patch ACUMULA entre chamadas (nao substitui) --
   * senao editar 2 campos rapido (ex.: salario e depois comissao dentro dos
   * mesmos 500ms) cancela o timer do 1o campo e so o ultimo e salvo.
   */
  function salvarItem(id, campo, valor) {
    var patch = pendingPatches[id] || (pendingPatches[id] = {});
    patch[campo] = valor;
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(function () {
      var envio = pendingPatches[id];
      delete pendingPatches[id];
      App.patch('/api/payroll/' + id, envio).then(function (upd) {
        var idx = state.itens.findIndex(function (it) { return it.id === id; });
        if (idx > -1) state.itens[idx] = upd;
        recalc();
        atualizarBusca(id);
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }, 500);
  }

  function atualizarBusca(id) {
    var tr = TB.querySelector('tr[data-id="' + id + '"]');
    var it = state.itens.filter(function (x) { return x.id === id; })[0];
    if (tr && it) tr.dataset.busca = [it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase();
  }

  function bindTabela() {
    TB.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell');
      if (!inp) return;
      var id = Number(inp.closest('tr').dataset.id);
      var it = state.itens.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var f = inp.dataset.f;
      it[f] = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      recalc();
      salvarItem(id, f, it[f]);
    });

    TB.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.cell.money');
      if (!inp) return;
      var it = state.itens.filter(function (x) { return x.id === Number(inp.closest('tr').dataset.id); })[0];
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
      var id = Number(btn.closest('tr').dataset.id);
      var it = state.itens.filter(function (x) { return x.id === id; })[0];
      if (!it) return;

      App.confirmar({
        titulo: 'Remover da folha?',
        texto: (it.nome || 'Este colaborador') + ' ser\u00e1 removido de ' +
          App.labelMes(state.competencia) + '. Os outros meses n\u00e3o s\u00e3o afetados.',
        ok: 'Remover', perigo: true
      }).then(function (sim) {
        if (!sim) return;
        App.del('/api/payroll/' + id).then(function () {
          state.itens = state.itens.filter(function (x) { return x.id !== id; });
          renderTabela();
          App.toast('Colaborador removido.', 'ok');
        }).catch(function (e2) { App.toast(e2.message, 'err'); });
      });
    });

    // Enter desce uma linha na mesma coluna; na ultima linha, cria a proxima.
    TB.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest('.cell');
      if (!inp) return;
      e.preventDefault();
      var proxima = proximaLinhaVisivel(inp.closest('tr'));
      if (proxima) {
        var alvo = proxima.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) { alvo.focus(); return; }
      }
      addColaborador();
    });
  }

  function proximaLinhaVisivel(tr) {
    var n = tr.nextElementSibling;
    while (n && n.classList.contains('filtered-out')) n = n.nextElementSibling;
    return n;
  }

  function addColaborador() {
    App.post('/api/payroll', { competencia: state.competencia, nome: '' }).then(function (criado) {
      state.itens.push(criado);
      renderTabela();
      var ultima = TB.rows[TB.rows.length - 1];
      if (ultima) {
        var campo = ultima.querySelector('[data-f="nome"]');
        if (campo) { campo.focus(); campo.scrollIntoView({ block: 'nearest' }); }
      }
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }

  function copiarMesAnterior() {
    var anterior = App.labelMes(App.somaMes(state.competencia, -1));

    function executar(substituir) {
      return App.post('/api/payroll/copy-previous', {
        competencia: state.competencia, replace: !!substituir
      }).then(function (r) {
        if (r.copied) {
          App.toast(r.copied + ' colaborador(es) copiados de ' + anterior + '.', 'ok');
          carregarTudo();
        } else {
          App.toast('Nenhum lan\u00e7amento encontrado em ' + anterior + '.', 'err');
        }
      });
    }

    executar(false).catch(function (e) {
      if (e.status !== 409) { App.toast(e.message, 'err'); return; }
      App.confirmar({
        titulo: 'Substituir o que j\u00e1 existe?',
        texto: 'Este m\u00eas j\u00e1 tem colaboradores lan\u00e7ados. Eles ser\u00e3o apagados e substitu\u00eddos pelos de ' + anterior + '.',
        ok: 'Substituir tudo', perigo: true
      }).then(function (sim) {
        if (!sim) return;
        executar(true).catch(function (e2) { App.toast(e2.message, 'err'); });
      });
    });
  }

  /* ============================================================
     Busca
     ============================================================ */

  function aplicarModo() {
    App.$all('[data-modo]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.modo === state.modo);
    });
    var tabela = App.$('#tabela-folha');
    tabela.classList.remove('modo-completo', 'modo-valores');
    tabela.classList.add('modo-' + state.modo);
  }

  function aplicarBusca() {
    var termo = state.busca.trim().toLowerCase();
    var visiveis = 0;
    Array.prototype.forEach.call(TB.rows, function (tr) {
      var bate = !termo || (tr.dataset.busca || '').indexOf(termo) !== -1;
      tr.classList.toggle('filtered-out', !bate);
      if (bate) visiveis++;
    });
    App.$('#empty-busca').hidden = !termo || visiveis > 0 || state.itens.length === 0;
  }

  /* ============================================================
     Eventos gerais
     ============================================================ */

  function bindEventos() {
    bindTabela();

    App.$('#btn-hoje').addEventListener('click', function () {
      state.competencia = App.mesAtualInput();
      monthNav.set(state.competencia);
      atualizarBotaoHoje();
      carregarTudo();
    });

    App.$('#btn-add').addEventListener('click', addColaborador);
    App.$('#btn-add-vazio').addEventListener('click', addColaborador);
    App.$('#mi-copiar').addEventListener('click', copiarMesAnterior);
    App.$('#btn-copiar-vazio').addEventListener('click', copiarMesAnterior);

    App.$('#mi-export').addEventListener('click', function () {
      location.href = '/api/payroll/export.csv?competencia=' + encodeURIComponent(state.competencia);
    });
    App.$('#mi-print').addEventListener('click', function () { window.print(); });

    App.$('#mi-import').addEventListener('click', function () { App.$('#file-csv').click(); });
    App.$('#file-csv').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        fetch('/api/payroll/import?competencia=' + encodeURIComponent(state.competencia), {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'text/csv' },
          body: String(reader.result)
        }).then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        }).then(function (res) {
          if (!res.ok) { App.toast(res.d.error || 'Erro ao importar.', 'err'); return; }
          App.toast(res.d.imported + ' colaborador(es) importados.', 'ok');
          carregarTudo();
        }).catch(function () { App.toast('Erro ao importar CSV.', 'err'); });
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });

    App.$all('[data-modo]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.modo = b.dataset.modo;
        try { localStorage.setItem(MODO_KEY, state.modo); } catch (e) { /* modo privado */ }
        aplicarModo();
      });
    });

    var busca = App.$('#busca');
    busca.addEventListener('input', App.debounce(function () {
      state.busca = busca.value;
      aplicarBusca();
    }, 120));
    App.$('#busca-clear').addEventListener('click', function () {
      busca.value = ''; state.busca = ''; aplicarBusca(); busca.focus();
    });

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
