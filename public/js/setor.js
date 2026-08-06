'use strict';
(function () {
  var Calc = window.Calc;
  var esc = App.esc;

  var state = {
    competencia: '', config: null, sector: null, itens: [], user: null,
    busca: '', abertos: {}
  };
  var TB = null;
  var monthNav = null;
  var saveTimers = {};
  var pendingPatches = {};

  // colunas da linha principal (colspan do painel de detalhes)
  var COLUNAS = 13;

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
      App.pintarIcones();

      App.$('#titulo-setor').textContent = data.user.sectorName || 'Meu Setor';

      state.competencia = App.mesAtualInput();
      monthNav = App.montarMonthNav('#month-nav', state.competencia, function (comp) {
        state.competencia = comp;
        state.abertos = {};
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
    var vivo = c.taxaConversaoAuto ? ' (ao vivo)' : '';
    App.$('#chip-taxa').textContent = 'R$ ' + Calc.num(c.taxaConversao) + ' / US$ 1' + vivo;
    App.$('#chip-taxa-eur').textContent = 'R$ ' + Calc.num(c.taxaConversaoEur) + ' / € 1' + vivo;
    App.$('#chip-taxa-gbp').textContent = 'R$ ' + Calc.num(c.taxaConversaoGbp) + ' / £ 1' + vivo;
    App.$('#chip-dias').textContent = c.diasUteis + ' dias';
    App.$('#chip-wise').textContent = Calc.num(c.taxaWisePct) + '%';
  }

  /* ============================================================
     Render
     ============================================================ */

  function linhas(it, i) {
    var aberta = !!state.abertos[it.id];
    return linhaPrincipal(it, i, aberta) + linhaDetalhe(it, aberta);
  }

  function linhaPrincipal(it, i, aberta) {
    var t = it.pago;
    var d = t ? ' disabled' : '';
    return '<tr data-id="' + it.id + '"' +
        ' class="' + (t ? 'is-pago ' : '') + (aberta ? 'aberta' : '') + '"' +
        ' data-busca="' + esc([it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase()) + '">' +
      '<td class="exp stick"><button class="btn-exp" data-exp type="button" aria-label="Ver detalhes">' + App.ico('seta', 13) + '</button></td>' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td><input class="cell nome" data-f="nome" placeholder="Nome do colaborador" value="' + esc(it.nome) + '"' + d + '></td>' +
      money('salarioBase', it.salarioBase, t, 'sep-l') +
      money('comissao', it.comissao, t, '') +
      money('aluguel', it.aluguel, t, '') +
      money('bonificacao', it.bonificacao, t, '') +
      '<td class="calc calc-total sep-l" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario" data-c="diario">R$ 0,00</td>' +
      '<td class="moeda sep-l"><span class="moeda-tag m-' + Calc.moedaDe(it) + '">' +
        Calc.moedaDe(it) + '</span></td>' +
      '<td class="enviar" data-c-enviar>' +
        '<div class="enviar-val m-' + Calc.moedaDe(it) + '">&mdash;</div>' +
        '<div class="enviar-brl">&mdash;</div>' +
      '</td>' +
      '<td class="sep-l">' + (t
        ? '<span class="badge badge-accent">' + App.ico('check', 12) + ' Pago</span>'
        : '<span class="badge badge-neutral">Pendente</span>') + '</td>' +
      '<td class="acao">' + (t ? '' :
        '<button class="btn-icon danger" data-del type="button" title="Remover" aria-label="Remover">' + App.ico('lixo', 15) + '</button>') + '</td>' +
      '</tr>';
  }

  /**
   * Cidade, cargo, data, OBS e o link do Wise saem da grade e vem para ca, em
   * campos rotulados de tamanho normal: sao dados de cadastro (preenchidos uma
   * vez e copiados de mes em mes), nao valem espremer a digitacao dos valores.
   */
  function linhaDetalhe(it, aberta) {
    var d = it.pago ? ' disabled' : '';
    var href = Calc.wiseHref(it.wiseLink);
    return '<tr class="det-row' + (aberta ? '' : ' escondida') + '" data-det="' + it.id + '">' +
      '<td colspan="' + COLUNAS + '"><div class="det-panel">' +
        '<div class="det-titulo">Dados do colaborador</div>' +
        '<div class="det-grid">' +
          campoTexto('cargo', 'Cargo', it.cargo, d, 'Ex.: Analista de Suporte') +
          campoTexto('cidade', 'Cidade', it.cidade, d, 'Ex.: São Paulo') +
          '<div class="det-field"><span>Data</span>' +
            '<input class="input" type="date" data-f="data" value="' + esc(it.data) + '"' + d + '></div>' +
          '<div class="det-field" style="grid-column:span 2;"><span>Link do Wise</span><div class="det-wise">' +
            '<input class="input" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + d + '>' +
            '<a class="btn btn-sm" data-wise-abrir target="_blank" rel="noopener"' +
              (href ? ' href="' + esc(href) + '"' : ' hidden') + '>' + App.ico('abrir', 13) + ' Abrir</a>' +
          '</div></div>' +
          campoTexto('obs', 'Observações', it.obs, d, 'Anotação livre') +
        '</div>' +
        '<div class="det-titulo" style="margin-top:18px;">Convertido</div>' +
        '<div class="det-grid compacta">' +
          '<div class="det-field"><span>Em dólar</span><div class="valor usd" data-c="dolar2">$0.00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (dólar)</span><div class="valor" data-c="fee">$0.00</div></div>' +
          '<div class="det-field"><span>Total com taxa (US$)</span><div class="valor usd" data-c="totalUsd">$0.00</div></div>' +
          '<div class="det-field"><span>Em euro</span><div class="valor m-EUR" data-c="euro2">&euro;0,00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (euro)</span><div class="valor" data-c="feeEur">&euro;0,00</div></div>' +
          '<div class="det-field"><span>Total com taxa (€)</span><div class="valor m-EUR" data-c="totalEur">&euro;0,00</div></div>' +
          '<div class="det-field"><span>Em libra</span><div class="valor m-GBP" data-c="libra2">&pound;0.00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (libra)</span><div class="valor" data-c="feeGbp">&pound;0.00</div></div>' +
          '<div class="det-field"><span>Total com taxa (£)</span><div class="valor gbp" data-c="totalGbp">&pound;0.00</div></div>' +
        '</div>' +
      '</div></td></tr>';
  }

  function campoTexto(campo, rotulo, valor, disabled, placeholder) {
    return '<label class="det-field"><span>' + rotulo + '</span>' +
      '<input class="input" data-f="' + campo + '" placeholder="' + esc(placeholder || '') +
      '" value="' + esc(valor) + '"' + disabled + '></label>';
  }

  function money(field, val, travado, extra) {
    var v = Calc.parseNum(val);
    return '<td class="' + extra + '"><input class="cell money" data-f="' + field +
      '" inputmode="decimal" placeholder="0,00" value="' + (v ? Calc.num(v) : '') + '"' +
      (travado ? ' disabled' : '') + '></td>';
  }

  function renderTabela() {
    TB.innerHTML = state.itens.map(linhas).join('');
    var vazio = state.itens.length === 0;
    App.$('#empty-folha').hidden = !vazio;
    App.$('.table-scroll', App.$('#card-folha')).hidden = vazio;
    recalc();
    aplicarBusca();
  }

  function recalc() {
    var map = {};
    state.itens.forEach(function (it) { map[it.id] = it; });

    App.$all('tr[data-id]', TB).forEach(function (tr) {
      var it = map[Number(tr.dataset.id)];
      if (!it) return;
      var r = Calc.calcItem(it, state.config);
      escreve(tr, 'total', Calc.brl(r.total));
      escreve(tr, 'diario', Calc.brl(r.diario));
      // o que o gestor ve: o valor na moeda em que a pessoa recebe, e o custo em real
      var cel = tr.querySelector('[data-c-enviar]');
      if (cel) {
        var val = cel.querySelector('.enviar-val');
        val.className = 'enviar-val m-' + r.moeda;
        val.textContent = Calc.fmtMoeda(r.moeda, r.aEnviar);
        cel.querySelector('.enviar-brl').textContent = '= ' + Calc.brl(r.equivaleBrl);
      }
      var tag = tr.querySelector('.moeda-tag');
      if (tag) { tag.className = 'moeda-tag m-' + r.moeda; tag.textContent = r.moeda; }

      var det = TB.querySelector('tr[data-det="' + it.id + '"]');
      if (det) {
        escreve(det, 'dolar2', Calc.usd(r.dolar));
        escreve(det, 'fee', Calc.usd(r.fee));
        escreve(det, 'totalUsd', Calc.usd(r.totalUsd));
        escreve(det, 'euro2', Calc.eur(r.euro));
        escreve(det, 'feeEur', Calc.eur(r.feeEur));
        escreve(det, 'totalEur', Calc.eur(r.totalEur));
        escreve(det, 'libra2', Calc.gbp(r.libra));
        escreve(det, 'feeGbp', Calc.gbp(r.feeGbp));
        escreve(det, 'totalGbp', Calc.gbp(r.totalGbp));
        var link = det.querySelector('[data-wise-abrir]');
        var href = Calc.wiseHref(it.wiseLink);
        if (link) { link.hidden = !href; if (href) link.href = href; }
      }
    });

    var totais = Calc.calcTotais(state.itens, state.config);
    App.$('#t-salario').textContent = Calc.brl(totais.salarioBase);
    App.$('#t-comissao').textContent = Calc.brl(totais.comissao);
    App.$('#t-aluguel').textContent = Calc.brl(totais.aluguel);
    App.$('#t-bonificacao').textContent = Calc.brl(totais.bonificacao);
    App.$('#t-total').textContent = Calc.brl(totais.total);
    App.$('#t-diario').textContent = Calc.brl(totais.diario);
    App.$('#t-enviar').innerHTML = resumoMoedas(totais);

    App.$('#kpi-qtd').textContent = state.itens.length;
    App.$('#kpi-media').textContent = 'Média: ' + Calc.brl(state.itens.length ? totais.total / state.itens.length : 0);
    App.$('#kpi-total-brl').textContent = Calc.brl(totais.total);
    App.$('#kpi-custo-diario').textContent = 'Custo diário: ' + Calc.brl(totais.diario) + ' (' + state.config.diasUteis + ' dias)';
    App.$('#kpi-enviar').innerHTML = resumoMoedas(totais);
    var emUso = Calc.moedasEmUso(totais);
    App.$('#kpi-enviar-foot').textContent = emUso.length
      ? emUso.length + ' moeda' + (emUso.length === 1 ? '' : 's') + ' neste setor'
      : 'Nenhum colaborador ainda';
    App.$('#kpi-custo-total').textContent = Calc.brl(totais.equivaleBrl);
    App.$('#kpi-custo-total-foot').textContent = 'Folha + taxa Wise (' + Calc.num(state.config.taxaWisePct) + '%)';

    var pagos = state.itens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + state.itens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total) + ' enviados';
    App.$('#kpi-progress').style.width = (state.itens.length ? (pagos.length / state.itens.length) * 100 : 0) + '%';
  }

  /** "$1.234,56 · €890,00" -- so as moedas que o setor usa. */
  function resumoMoedas(t) {
    var moedas = Calc.moedasEmUso(t);
    if (!moedas.length) return '&mdash;';
    return moedas.map(function (m) {
      return '<span class="m-' + m + '">' + Calc.fmtMoeda(m, t.porMoeda[m].aEnviar) + '</span>';
    }).join('<span style="color:var(--ink-4)"> · </span>');
  }

  function escreve(raiz, chave, texto) {
    var el = raiz.querySelector('[data-c="' + chave + '"]');
    if (el) el.textContent = texto;
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
      }).catch(function (e) { App.toast(e.message, 'err'); });
    }, 500);
  }

  function idDoCampo(inp) {
    var tr = inp.closest('tr');
    if (!tr) return null;
    return Number(tr.dataset.id || tr.dataset.det);
  }

  function acharItem(id) {
    return state.itens.filter(function (x) { return x.id === id; })[0];
  }

  function bindTabela() {
    TB.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell, .det-field .input');
      if (!inp || !inp.dataset.f) return;
      var id = idDoCampo(inp);
      var it = acharItem(id);
      if (!it) return;
      var f = inp.dataset.f;
      it[f] = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      atualizarBuscaDaLinha(it);
      recalc();
      salvarItem(id, f, it[f]);
    });

    TB.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.money');
      if (!inp || !inp.dataset.f) return;
      var it = acharItem(idDoCampo(inp));
      if (!it) return;
      var v = Calc.parseNum(it[inp.dataset.f]);
      inp.value = v ? String(v).replace('.', ',') : '';
      inp.select();
    });

    TB.addEventListener('focusout', function (e) {
      var inp = e.target.closest('.money');
      if (!inp || !inp.dataset.f) return;
      var v = Calc.parseNum(inp.value);
      inp.value = v ? Calc.num(v) : '';
    });

    TB.addEventListener('click', function (e) {
      var exp = e.target.closest('[data-exp]');
      if (exp) { alternarDetalhe(exp.closest('tr')); return; }

      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      var id = Number(btn.closest('tr').dataset.id);
      var it = acharItem(id);
      if (!it) return;

      App.confirmar({
        titulo: 'Remover da folha?',
        texto: (it.nome || 'Este colaborador') + ' será removido de ' +
          App.labelMes(state.competencia) + '. Os outros meses não são afetados.',
        ok: 'Remover', perigo: true
      }).then(function (sim) {
        if (!sim) return;
        App.del('/api/payroll/' + id).then(function () {
          state.itens = state.itens.filter(function (x) { return x.id !== id; });
          delete state.abertos[id];
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
      var proxima = proximaLinhaPrincipal(inp.closest('tr'));
      if (proxima) {
        var alvo = proxima.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) { alvo.focus(); return; }
      }
      addColaborador();
    });
  }

  function proximaLinhaPrincipal(tr) {
    var n = tr.nextElementSibling;
    while (n && (n.classList.contains('det-row') || n.classList.contains('filtered-out'))) {
      n = n.nextElementSibling;
    }
    return n;
  }

  function atualizarBuscaDaLinha(it) {
    var tr = TB.querySelector('tr[data-id="' + it.id + '"]');
    if (tr) tr.dataset.busca = [it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase();
  }

  function alternarDetalhe(tr) {
    var id = Number(tr.dataset.id);
    var det = TB.querySelector('tr[data-det="' + id + '"]');
    if (!det) return;
    var abrindo = det.classList.contains('escondida');
    det.classList.toggle('escondida', !abrindo);
    tr.classList.toggle('aberta', abrindo);
    if (abrindo) state.abertos[id] = true; else delete state.abertos[id];
  }

  function addColaborador() {
    App.post('/api/payroll', { competencia: state.competencia, nome: '' }).then(function (criado) {
      state.itens.push(criado);
      renderTabela();
      var ultima = App.$all('tr[data-id]', TB).pop();
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
          App.toast('Nenhum lançamento encontrado em ' + anterior + '.', 'err');
        }
      });
    }

    executar(false).catch(function (e) {
      if (e.status !== 409) { App.toast(e.message, 'err'); return; }
      App.confirmar({
        titulo: 'Substituir o que já existe?',
        texto: 'Este mês já tem colaboradores lançados. Eles serão apagados e substituídos pelos de ' + anterior + '.',
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

  function aplicarBusca() {
    var termo = state.busca.trim().toLowerCase();
    var visiveis = 0;
    App.$all('tr[data-id]', TB).forEach(function (tr) {
      var bate = !termo || (tr.dataset.busca || '').indexOf(termo) !== -1;
      tr.classList.toggle('filtered-out', !bate);
      var det = TB.querySelector('tr[data-det="' + tr.dataset.id + '"]');
      if (det) det.classList.toggle('filtered-out', !bate);
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

    App.$('#btn-expandir').addEventListener('click', function () {
      var btn = App.$('#btn-expandir');
      var abrindo = App.$all('tr.det-row.escondida', TB).length > 0;
      App.$all('tr[data-id]', TB).forEach(function (tr) {
        var id = Number(tr.dataset.id);
        var det = TB.querySelector('tr[data-det="' + id + '"]');
        if (!det) return;
        det.classList.toggle('escondida', !abrindo);
        tr.classList.toggle('aberta', abrindo);
        if (abrindo) state.abertos[id] = true; else delete state.abertos[id];
      });
      btn.textContent = abrindo ? 'Recolher tudo' : 'Expandir tudo';
    });

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
