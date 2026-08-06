'use strict';
(function () {
  var Calc = window.Calc;
  var esc = App.esc;

  var state = {
    competencia: '',
    config: null,
    summary: null,
    quote: null,
    fechados: {},     // setores recolhidos pelo usuario
    abertos: {},      // linhas com o painel de detalhes aberto
    busca: '',
    carregando: false
  };
  var monthNav = null;
  var saveTimers = {};
  var pendingPatches = {};

  // colunas visiveis na linha principal (usado no colspan do painel de detalhes)
  var COLUNAS = 12;

  /* ============================================================
     Inicializacao
     ============================================================ */

  function init() {
    App.get('/api/auth/me').then(function (data) {
      if (data.user.role !== 'cco') { location.replace('/setor'); return; }
      App.montarUserMenu(data.user);
      App.ligarPwToggles();
      App.pintarIcones();

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
      setInterval(carregarQuote, 5 * 60 * 1000);
    }).catch(function () { location.replace('/login'); });
  }

  function atualizarBotaoHoje() {
    App.$('#btn-hoje').hidden = state.competencia === App.mesAtualInput();
  }

  function carregarTudo() {
    App.$('#brand-sub').textContent = App.labelMes(state.competencia);
    var box = App.$('#setores-container');
    box.classList.add('is-busy');
    state.carregando = true;

    // A cotacao e informativa (o chip e o KPI de custo real): pedir junto, mas
    // NAO esperar por ela para pintar a folha -- ela vinha de uma API externa e
    // segurava a tela inteira quando estava lenta.
    carregarQuote().then(function () {
      if (state.summary) renderKpis();
    });

    return Promise.all([
      App.get('/api/config/' + state.competencia),
      App.get('/api/payroll/summary?competencia=' + state.competencia)
    ]).then(function (r) {
      state.config = r[0];
      state.summary = r[1];
      renderConfig();
      renderSetores();
      // renderSetores() so escreve os totais que ja vieram do servidor; as celulas
      // calculadas de CADA LINHA ficam no placeholder do template ate esta chamada.
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
      App.$('#cotacao-usd').textContent = '—';
      App.$('#cotacao-eur').textContent = '—';
      App.$('#cotacao-gbp').textContent = '—';
      App.$('#cotacao-time').textContent = 'indisponível';
    });
  }

  function renderQuote() {
    var q = state.quote;
    if (!q) return;
    App.$('#quote-chip').classList.remove('is-off');
    App.$('#cotacao-usd').textContent = Calc.brl(q.usd);
    App.$('#cotacao-eur').textContent = q.eur ? Calc.brl(q.eur) : '—';
    App.$('#cotacao-gbp').textContent = q.gbp ? Calc.brl(q.gbp) : '—';
    App.$('#cotacao-time').textContent = App.tempoRelativo(q.at);
  }

  /* ============================================================
     Parametros do mes
     ============================================================ */

  function renderConfig() {
    var c = state.config;
    App.$('#taxa-conversao').value = Calc.num(c.taxaConversao);
    App.$('#taxa-conversao-eur').value = Calc.num(c.taxaConversaoEur);
    App.$('#taxa-conversao-gbp').value = Calc.num(c.taxaConversaoGbp);
    App.$('#dias-uteis').value = c.diasUteis;
    App.$('#taxa-wise').value = Calc.num(c.taxaWisePct);
    App.$('#auto-cotacao').checked = c.taxaConversaoAuto;
    App.$('#taxa-conversao').disabled = c.taxaConversaoAuto;
    App.$('#taxa-conversao-eur').disabled = c.taxaConversaoAuto;
    App.$('#taxa-conversao-gbp').disabled = c.taxaConversaoAuto;
    App.$('#btn-usar-cotacao').disabled = c.taxaConversaoAuto;

    var auto = c.taxaConversaoAuto ? ' (auto)' : '';
    App.$('#sum-taxa').textContent = 'R$ ' + Calc.num(c.taxaConversao) + auto;
    App.$('#sum-taxa-eur').textContent = 'R$ ' + Calc.num(c.taxaConversaoEur) + auto;
    App.$('#sum-taxa-gbp').textContent = 'R$ ' + Calc.num(c.taxaConversaoGbp) + auto;
    App.$('#sum-dias').textContent = c.diasUteis;
    App.$('#sum-wise').textContent = Calc.num(c.taxaWisePct) + '%';
  }

  function salvarConfig(patch) {
    var body = Object.assign({
      diasUteis: state.config.diasUteis,
      taxaWisePct: state.config.taxaWisePct,
      taxaConversao: state.config.taxaConversao,
      taxaConversaoEur: state.config.taxaConversaoEur,
      taxaConversaoGbp: state.config.taxaConversaoGbp,
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

  /**
   * Um cartao por moeda EM USO: o valor a enviar naquela moeda e, logo abaixo,
   * quanto isso custa em real. Moeda sem ninguem nao vira cartao vazio.
   */
  function renderKpisMoeda() {
    var box = App.$('#kpis-moeda');
    var t = state.summary.geral;
    var moedas = Calc.moedasEmUso(t);

    box.innerHTML = moedas.map(function (m) {
      var d = t.porMoeda[m];
      var nome = Calc.MOEDAS[m].nome;
      return '<div class="kpi kpi-moeda m-' + m + '">' +
        '<span class="kpi-label">A enviar em ' + esc(nome.toLowerCase()) + '</span>' +
        '<strong class="kpi-value m-' + m + '">' + Calc.fmtMoeda(m, d.aEnviar) + '</strong>' +
        '<span class="kpi-foot">= ' + Calc.brl(d.equivaleBrl) + ' &middot; ' +
          d.qtd + ' pessoa' + (d.qtd === 1 ? '' : 's') + '</span>' +
        '</div>';
    }).join('');

    box.hidden = moedas.length === 0;
  }

  function renderKpis() {
    var s = state.summary;
    var itens = todosItens();

    App.$('#kpi-qtd').textContent = itens.length;
    App.$('#kpi-setores').textContent = s.sectors.length + ' setor' + (s.sectors.length === 1 ? '' : 'es');
    App.$('#kpi-total-brl').textContent = Calc.brl(s.geral.total);
    App.$('#kpi-custo-diario').textContent = 'Custo diário: ' + Calc.brl(s.geral.diario);
    App.$('#kpi-custo-total').textContent = Calc.brl(s.geral.equivaleBrl);
    App.$('#kpi-custo-total-foot').textContent =
      'Folha + taxa Wise (' + Calc.num(state.config.taxaWisePct) + '%)';
    renderKpisMoeda();

    var pagos = itens.filter(function (it) { return it.pago; });
    App.$('#kpi-pago').textContent = pagos.length + ' de ' + itens.length;
    App.$('#kpi-pago-valor').textContent = Calc.brl(Calc.calcTotais(pagos, state.config).total) + ' enviados';
    App.$('#kpi-progress').style.width = (itens.length ? (pagos.length / itens.length) * 100 : 0) + '%';

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
              // o detalhamento por moeda fica no rodape da tabela, onde cabe com folga
              '<span class="sector-stat"><span class="k">Folha</span><span class="v" data-sub="total">' + Calc.brl(sec.totals.total) + '</span></span>' +
              '<span class="sector-stat"><span class="k">Custo c/ taxas</span><span class="v" data-sub="custo">' + Calc.brl(sec.totals.equivaleBrl) + '</span></span>' +
            '</div>' +
            '<div class="sector-actions">' +
              (sec.itens.length
                ? '<button class="btn btn-sm" data-pagar-setor type="button">' +
                    (todosPagos ? 'Desmarcar setor' : App.ico('check', 14) + ' Pagar setor inteiro') + '</button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div class="sector-body">' +
            '<div class="table-scroll"><table class="grid" data-tabela-setor="' + sec.sectorId + '">' +
              cabecalho() +
              '<tbody>' + sec.itens.map(linhas).join('') + '</tbody>' +
              rodape(sec.totals) +
            '</table></div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function statusSetor(pagos, total) {
    if (!total) return ' <span class="badge badge-neutral">vazio</span>';
    if (pagos === total) return ' <span class="badge badge-accent">' + App.ico('check', 12) + ' pago</span>';
    if (pagos > 0) return ' <span class="badge badge-amber">' + pagos + '/' + total + ' pago</span>';
    return ' <span class="badge badge-neutral">' + total + ' colaborador' + (total === 1 ? '' : 'es') + '</span>';
  }

  function cabecalho() {
    return '<thead><tr>' +
      '<th class="col-exp stick"><span class="sr-only">Detalhes</span></th>' +
      '<th class="col-idx">#</th>' +
      '<th class="col-nome col-flex">Nome</th>' +
      '<th class="col-cargo">Cargo</th>' +
      '<th class="num col-calc sep-l">Total R$</th>' +
      '<th class="num col-calc">Custo di&aacute;rio</th>' +
      '<th class="col-moeda sep-l">Paga em</th>' +
      '<th class="num col-enviar">A enviar</th>' +
      '<th class="col-status sep-l">Status</th>' +
      '<th class="col-acao"><span class="sr-only">A&ccedil;&otilde;es</span></th>' +
      '</tr></thead>';
  }

  /** Rodape: uma linha por moeda usada no setor, cada uma com o total em real. */
  function rodape(t) {
    var moedas = Calc.moedasEmUso(t);
    var linhas = moedas.map(function (m) {
      var d = t.porMoeda[m];
      return '<tr data-tf-moeda="' + m + '">' +
        '<td colspan="4" class="total-label stick">A enviar em ' + Calc.MOEDAS[m].nome.toLowerCase() +
          ' <span class="badge badge-neutral">' + d.qtd + '</span></td>' +
        '<td class="num" colspan="2">' + Calc.brl(d.equivaleBrl) + '</td>' +
        '<td class="moeda"><span class="moeda-tag m-' + m + '">' + m + '</span></td>' +
        '<td class="num m-' + m + '" style="font-weight:700;">' + Calc.fmtMoeda(m, d.aEnviar) + '</td>' +
        '<td colspan="2"></td>' +
        '</tr>';
    }).join('');

    return '<tfoot>' + linhas +
      '<tr>' +
        '<td colspan="4" class="total-label stick">Total do setor</td>' +
        '<td class="num" data-tf="total">' + Calc.brl(t.total) + '</td>' +
        '<td class="num" data-tf="diario">' + Calc.brl(t.diario) + '</td>' +
        '<td colspan="2" class="num" data-tf="equivaleBrl">' + Calc.brl(t.equivaleBrl) + ' com taxas</td>' +
        '<td colspan="2"></td>' +
      '</tr></tfoot>';
  }

  /** Devolve as DUAS linhas de um item: a principal e o painel de detalhes. */
  function linhas(it, i) {
    var aberta = !!state.abertos[it.id];
    return linhaPrincipal(it, i, aberta) + linhaDetalhe(it, aberta);
  }

  function linhaPrincipal(it, i, aberta) {
    return '<tr data-id="' + it.id + '"' +
        ' class="' + (it.pago ? 'is-pago ' : '') + (aberta ? 'aberta' : '') + '"' +
        ' data-busca="' + esc([it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase()) + '">' +
      '<td class="exp stick"><button class="btn-exp" data-exp type="button" aria-label="Ver detalhes">' + App.ico('seta', 13) + '</button></td>' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td><input class="cell nome" data-f="nome" placeholder="Nome" value="' + esc(it.nome) + '"' +
        (it.pago ? ' disabled' : '') + '></td>' +
      '<td><input class="cell" data-f="cargo" placeholder="—" value="' + esc(it.cargo) + '"' +
        (it.pago ? ' disabled' : '') + '></td>' +
      '<td class="calc calc-total sep-l" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario" data-c="diario">R$ 0,00</td>' +
      '<td class="moeda sep-l">' + seletorMoeda(it) + '</td>' +
      '<td class="enviar" data-c-enviar>' +
        '<div class="enviar-val m-' + Calc.moedaDe(it) + '">&mdash;</div>' +
        '<div class="enviar-brl">&mdash;</div>' +
        '<div class="enviar-alt" data-c-enviar-alt></div>' +
      '</td>' +
      '<td class="sep-l"><div class="status-acoes">' +
        '<button class="pago-toggle' + (it.pago ? ' on' : '') + '" data-toggle-pago type="button">' +
          (it.pago ? App.ico('check', 13) + ' Pago' : 'Marcar pago') + '</button>' +
        '<a class="btn-wise" data-wise-pagar href="https://wise.com" target="_blank" rel="noopener" title="Pagar com Wise em nova aba">' +
          App.ico('abrir', 12) + ' Wise</a>' +
      '</div></td>' +
      '<td class="acao"><button class="btn-icon danger" data-del type="button" title="Remover" aria-label="Remover">&times;</button></td>' +
      '</tr>';
  }

  /**
   * Painel de detalhes: tudo o que nao cabe com folga na linha principal.
   * Campos rotulados e de tamanho normal -- nada truncado.
   */
  function linhaDetalhe(it, aberta) {
    var d = it.pago ? ' disabled' : '';
    var href = Calc.wiseHref(it.wiseLink);
    return '<tr class="det-row' + (aberta ? '' : ' escondida') + '" data-det="' + it.id + '">' +
      '<td colspan="' + COLUNAS + '"><div class="det-panel">' +

        '<div class="det-titulo">Composição do salário</div>' +
        '<div class="det-grid compacta">' +
          campoDinheiro('salarioBase', 'Salário base', it.salarioBase, d) +
          campoDinheiro('comissao', 'Comissão', it.comissao, d) +
          campoDinheiro('aluguel', 'Aluguel / Outros', it.aluguel, d) +
          campoDinheiro('bonificacao', 'Bonificação', it.bonificacao, d) +
        '</div>' +

        '<div class="det-titulo" style="margin-top:18px;">Quanto daria em cada moeda ' +
          '<span class="det-nota">(a pessoa recebe na moeda marcada acima)</span></div>' +
        '<div class="det-grid compacta">' +
          '<div class="det-field"><span>D&oacute;lar com taxa</span><div class="valor m-USD" data-c="emUsd">$0.00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (US$)</span><div class="valor" data-c="fee">$0.00</div></div>' +
          '<div class="det-field"><span>Euro com taxa</span><div class="valor m-EUR" data-c="emEur">&euro;0,00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (&euro;)</span><div class="valor" data-c="feeEur">&euro;0,00</div></div>' +
          '<div class="det-field"><span>Libra com taxa</span><div class="valor m-GBP" data-c="emGbp">&pound;0.00</div></div>' +
          '<div class="det-field"><span>Taxa Wise (&pound;)</span><div class="valor" data-c="feeGbp">&pound;0.00</div></div>' +
        '</div>' +

        '<div class="det-titulo" style="margin-top:18px;">Dados do colaborador</div>' +
        '<div class="det-grid">' +
          campoTexto('cidade', 'Cidade', it.cidade, d, 'Ex.: São Paulo') +
          '<div class="det-field"><span>Data</span>' +
            '<input class="input" type="date" data-f="data" value="' + esc(it.data) + '"' + d + '></div>' +
          '<div class="det-field" style="grid-column:span 2;"><span>Link do Wise</span><div class="det-wise">' +
            '<input class="input" data-f="wiseLink" placeholder="wise.com/pay/me/..." value="' + esc(it.wiseLink) + '"' + d + '>' +
            '<a class="btn-wise" data-wise-abrir target="_blank" rel="noopener"' +
              (href ? ' href="' + esc(href) + '"' : ' hidden') + '>' + App.ico('abrir', 12) + ' Abrir</a>' +
          '</div></div>' +
          campoTexto('obs', 'Observações', it.obs, d, 'Anotação livre') +
        '</div>' +

      '</div></td></tr>';
  }

  /** Escolha da moeda em que a pessoa recebe -- e daqui que sai o "a enviar". */
  function seletorMoeda(it) {
    var atual = Calc.moedaDe(it);
    var opcoes = Calc.CODIGOS_MOEDA.map(function (m) {
      return '<option value="' + m + '"' + (m === atual ? ' selected' : '') + '>' +
        Calc.MOEDAS[m].simbolo + ' ' + m + '</option>';
    }).join('');
    return '<select class="moeda-sel m-' + atual + '" data-f="moedaPagamento" ' +
      'aria-label="Moeda do pagamento"' + (it.pago ? ' disabled' : '') + '>' + opcoes + '</select>';
  }

  function campoDinheiro(campo, rotulo, valor, disabled) {
    var v = Calc.parseNum(valor);
    return '<label class="det-field"><span>' + rotulo + '</span>' +
      '<input class="input money" data-f="' + campo + '" inputmode="decimal" placeholder="0,00" value="' +
      (v ? Calc.num(v) : '') + '"' + disabled + '></label>';
  }

  function campoTexto(campo, rotulo, valor, disabled, placeholder) {
    return '<label class="det-field"><span>' + rotulo + '</span>' +
      '<input class="input" data-f="' + campo + '" placeholder="' + esc(placeholder || '') +
      '" value="' + esc(valor) + '"' + disabled + '></label>';
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
      escreve(tr, 'total', Calc.brl(r.total));
      escreve(tr, 'diario', Calc.brl(r.diario));

      // o que a CCO manda, na moeda escolhida, e quanto isso custa em real
      var cel = tr.querySelector('[data-c-enviar]');
      if (cel) {
        var val = cel.querySelector('.enviar-val');
        val.className = 'enviar-val m-' + r.moeda;
        val.textContent = Calc.fmtMoeda(r.moeda, r.aEnviar);
        cel.querySelector('.enviar-brl').textContent = '= ' + Calc.brl(r.equivaleBrl);
        var alt = cel.querySelector('[data-c-enviar-alt]');
        if (alt) {
          alt.textContent = r.moeda === 'USD' ? Calc.gbp(r.libra) : '';
          alt.style.display = r.moeda === 'USD' ? 'block' : 'none';
        }
      }
      var sel = tr.querySelector('[data-f="moedaPagamento"]');
      if (sel) sel.className = 'moeda-sel m-' + r.moeda;

      var det = tabela.querySelector('tr[data-det="' + it.id + '"]');
      if (det) {
        escreve(det, 'fee', Calc.usd(r.fee));
        escreve(det, 'feeEur', Calc.eur(r.feeEur));
        escreve(det, 'feeGbp', Calc.gbp(r.feeGbp));
        escreve(det, 'emUsd', Calc.usd(r.totalUsd));
        escreve(det, 'emEur', Calc.eur(r.totalEur));
        escreve(det, 'emGbp', Calc.gbp(r.totalGbp));
        var link = det.querySelector('[data-wise-abrir]');
        var href = Calc.wiseHref(it.wiseLink);
        if (link) { link.hidden = !href; if (href) link.href = href; }
      }
    });

    var t = sec.totals;
    escreveTf(tabela, 'total', Calc.brl(t.total));
    escreveTf(tabela, 'diario', Calc.brl(t.diario));
    escreveTf(tabela, 'equivaleBrl', Calc.brl(t.equivaleBrl) + ' com taxas');

    // as linhas do rodape por moeda mudam de conjunto quando alguem troca de
    // moeda -- redesenha o tfoot inteiro em vez de tentar remendar celula a celula
    var tfoot = tabela.querySelector('tfoot');
    if (tfoot) {
      var novo = rodape(t);
      var atual = tfoot.outerHTML;
      if (atual !== novo) tfoot.outerHTML = novo;
    }

    var head = document.querySelector('.sector-block[data-sector="' + sec.sectorId + '"] .sector-head');
    if (head) {
      var alvo = head.querySelector('[data-sub="total"]');
      if (alvo) alvo.textContent = Calc.brl(t.total);
      var env = head.querySelector('[data-sub="enviar"]');
      if (env) env.innerHTML = resumoMoedas(t);
      var custo = head.querySelector('[data-sub="custo"]');
      if (custo) custo.textContent = Calc.brl(t.equivaleBrl);
    }
  }

  /** "$1.234,56 · €890,00" -- so as moedas que o setor realmente usa. */
  function resumoMoedas(t) {
    var moedas = Calc.moedasEmUso(t);
    if (!moedas.length) return '<span class="v">&mdash;</span>';
    return moedas.map(function (m) {
      return '<span class="v m-' + m + '">' + Calc.fmtMoeda(m, t.porMoeda[m].aEnviar) + '</span>';
    }).join('<span class="sep-moeda"> · </span>');
  }

  function escreve(raiz, chave, texto) {
    var el = raiz.querySelector('[data-c="' + chave + '"]');
    if (el) el.textContent = texto;
  }
  function escreveTf(tabela, chave, texto) {
    var el = tabela.querySelector('[data-tf="' + chave + '"]');
    if (el) el.textContent = texto;
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

  /** Sobe do campo editado (na linha ou no painel de detalhes) ate o id do item. */
  function idDoCampo(inp) {
    var tr = inp.closest('tr');
    if (!tr) return null;
    return Number(tr.dataset.id || tr.dataset.det);
  }

  function bindTabela() {
    var box = App.$('#setores-container');

    // `.moeda-sel` precisa entrar aqui: e um <select>, nao casava com .cell e a
    // troca de moeda nao chegava a ser salva.
    box.addEventListener('input', function (e) {
      var inp = e.target.closest('.cell, .det-field .input, .moeda-sel');
      if (!inp || !inp.dataset.f) return;
      var id = idDoCampo(inp);
      var found = acharItem(id);
      if (!found) return;
      var f = inp.dataset.f;
      found.item[f] = inp.classList.contains('money') ? Calc.parseNum(inp.value) : inp.value;
      atualizarBuscaDaLinha(found.item);
      recalcTudoLocal();
      salvarItem(id, f, found.item[f]);
    });

    box.addEventListener('focusin', function (e) {
      var inp = e.target.closest('.money');
      if (!inp || !inp.dataset.f) return;
      var found = acharItem(idDoCampo(inp));
      if (!found) return;
      var v = Calc.parseNum(found.item[inp.dataset.f]);
      inp.value = v ? String(v).replace('.', ',') : '';
      inp.select();
    });

    box.addEventListener('focusout', function (e) {
      var inp = e.target.closest('.money');
      if (!inp || !inp.dataset.f) return;
      var v = Calc.parseNum(inp.value);
      inp.value = v ? Calc.num(v) : '';
    });

    // Enter desce para a mesma coluna da linha seguinte (so na grade principal)
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest('.cell');
      if (!inp) return;
      e.preventDefault();
      var proxima = proximaLinhaPrincipal(inp.closest('tr'));
      if (proxima) {
        var alvo = proxima.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) { alvo.focus(); return; }
      }
      inp.blur();
    });

    box.addEventListener('click', function (e) {
      if (e.target.closest('.menu')) return;

      var exp = e.target.closest('[data-exp]');
      if (exp) { alternarDetalhe(exp.closest('tr')); return; }

      var cab = e.target.closest('[data-toggle-sector]');
      if (cab && !e.target.closest('input, button, a')) {
        var bloco = cab.closest('.sector-block');
        var aberto = bloco.classList.toggle('open');
        state.fechados[bloco.dataset.sector] = !aberto;
        return;
      }

      var pagarSetor = e.target.closest('[data-pagar-setor]');
      if (pagarSetor) { marcarSetor(pagarSetor); return; }

      var toggle = e.target.closest('[data-toggle-pago]');
      if (toggle) { alternarPago(toggle); return; }

      var del = e.target.closest('[data-del]');
      if (del) { removerItem(del); }
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
    var tr = document.querySelector('tr[data-id="' + it.id + '"]');
    if (tr) tr.dataset.busca = [it.nome, it.cargo, it.cidade, it.obs].join(' ').toLowerCase();
  }

  function alternarDetalhe(tr) {
    var id = Number(tr.dataset.id);
    var det = document.querySelector('tr[data-det="' + id + '"]');
    if (!det) return;
    var abrindo = det.classList.contains('escondida');
    det.classList.toggle('escondida', !abrindo);
    tr.classList.toggle('aberta', abrindo);
    if (abrindo) state.abertos[id] = true; else delete state.abertos[id];
  }

  function alternarPago(btn) {
    var tr = btn.closest('tr');
    var id = Number(tr.dataset.id);
    var found = acharItem(id);
    if (!found) return;

    var container = btn.closest('.status-acoes');
    if (container) container.classList.add('is-loading');
    btn.disabled = true;

    App.patch('/api/payroll/' + id + '/pago', { pago: !found.item.pago }).then(function (upd) {
      found.item.pago = upd.pago;
      found.item.pagoEm = upd.pagoEm;
      renderSetores();
      recalcTudoLocal();
      aplicarBusca();
      App.toast(upd.pago ? 'Pagamento confirmado.' : 'Pagamento desmarcado.', 'ok');
    }).catch(function (e) {
      if (container) container.classList.remove('is-loading');
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
        ? alvos.length + ' colaborador(es) de "' + sec.sectorName + '" ficarão marcados como pagos e travados para o gestor.'
        : alvos.length + ' colaborador(es) de "' + sec.sectorName + '" voltarão a ficar pendentes.',
      ok: marcar ? 'Marcar todos' : 'Desmarcar todos',
      perigo: !marcar
    }).then(function (sim) {
      if (!sim) return;
      btn.disabled = true;
      btn.classList.add('is-loading');
      var textoOriginal = btn.textContent;
      btn.textContent = 'Salvando...';

      // uma requisicao so para o setor inteiro (era um PATCH por colaborador,
      // em serie -- 12 pessoas eram 12 idas ao servidor)
      App.patch('/api/payroll/pago-lote', {
        ids: alvos.map(function (it) { return it.id; }),
        pago: marcar
      }).then(function (r) {
        var porId = {};
        r.itens.forEach(function (it) { porId[it.id] = it; });
        alvos.forEach(function (it) {
          var upd = porId[it.id];
          if (upd) { it.pago = upd.pago; it.pagoEm = upd.pagoEm; }
        });
        renderSetores();
        recalcTudoLocal();
        aplicarBusca();
        App.toast(r.atualizados + ' lançamento(s) atualizados.', 'ok');
      }).catch(function (e) {
        App.toast(e.message, 'err');
        carregarTudo();
      }).then(function () {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = textoOriginal;
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
      texto: (found.item.nome || 'Este colaborador') + ' será removido de ' +
        App.labelMes(state.competencia) + '. Os outros meses não são afetados.',
      ok: 'Remover', perigo: true
    }).then(function (sim) {
      if (!sim) return;
      App.del('/api/payroll/' + id).then(function () {
        found.sector.itens = found.sector.itens.filter(function (x) { return x.id !== id; });
        found.sector.itensCount = found.sector.itens.length;
        delete state.abertos[id];
        renderSetores();
        recalcTudoLocal();
        aplicarBusca();
        App.toast('Colaborador removido.', 'ok');
      }).catch(function (e) { App.toast(e.message, 'err'); });
    });
  }

  /* ============================================================
     Busca
     ============================================================ */

  function aplicarBusca() {
    var termo = state.busca.trim().toLowerCase();
    var visiveis = 0;
    var temItens = todosItens().length > 0;

    App.$all('.sector-block').forEach(function (bloco) {
      var achouNoBloco = 0;
      App.$all('tbody tr[data-id]', bloco).forEach(function (tr) {
        var bate = !termo || (tr.dataset.busca || '').indexOf(termo) !== -1;
        tr.classList.toggle('filtered-out', !bate);
        // o painel de detalhes acompanha a linha dona dele
        var det = bloco.querySelector('tr[data-det="' + tr.dataset.id + '"]');
        if (det) det.classList.toggle('filtered-out', !bate);
        if (bate) achouNoBloco++;
      });
      visiveis += achouNoBloco;
      bloco.hidden = !!termo && achouNoBloco === 0;
      if (termo && achouNoBloco) bloco.classList.add('open');
    });

    App.$('#empty-busca').hidden = !termo || visiveis > 0;
    App.$('#empty-geral').hidden = !!termo || temItens;
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
     * do mes que saiu e gravaria esse numero no mes novo. Em duvida, renderConfig()
     * repoe o valor verdadeiro na tela.
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
      if (v <= 0) { App.toast('A taxa do dólar precisa ser maior que zero.', 'err'); renderConfig(); return; }
      salvarConfig({ taxaConversao: v });
    }));
    App.$('#taxa-conversao-eur').addEventListener('change', mudouConfig(function (e) {
      var v = Calc.parseNum(e.target.value);
      if (v <= 0) { App.toast('A taxa do euro precisa ser maior que zero.', 'err'); renderConfig(); return; }
      salvarConfig({ taxaConversaoEur: v });
    }));
    App.$('#taxa-conversao-gbp').addEventListener('change', mudouConfig(function (e) {
      var v = Calc.parseNum(e.target.value);
      if (v <= 0) { App.toast('A taxa da libra precisa ser maior que zero.', 'err'); renderConfig(); return; }
      salvarConfig({ taxaConversaoGbp: v });
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
      if (e.target.checked && state.quote) {
        if (state.quote.usd > 0) patch.taxaConversao = state.quote.usd;
        if (state.quote.eur > 0) patch.taxaConversaoEur = state.quote.eur;
        if (state.quote.gbp > 0) patch.taxaConversaoGbp = state.quote.gbp;
      }
      salvarConfig(patch);
    }));
    App.$('#btn-usar-cotacao').addEventListener('click', function () {
      if (!state.quote) { App.toast('Cotação indisponível no momento.', 'err'); return; }
      var patch = {};
      if (state.quote.usd > 0) patch.taxaConversao = state.quote.usd;
      if (state.quote.eur > 0) patch.taxaConversaoEur = state.quote.eur;
      if (state.quote.gbp > 0) patch.taxaConversaoGbp = state.quote.gbp;
      salvarConfig(patch).then(function () {
        App.toast('Taxas do mês atualizadas pela cotação de agora.', 'ok');
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
        if (state.config.taxaConversaoAuto) {
          var patch = {};
          if (q.usd > 0) patch.taxaConversao = q.usd;
          if (q.eur > 0) patch.taxaConversaoEur = q.eur;
          if (q.gbp > 0) patch.taxaConversaoGbp = q.gbp;
          salvarConfig(patch);
        }
        App.toast('Cotação atualizada: US$ 1 = ' + Calc.brl(q.usd) +
          (q.gbp ? ' · £ 1 = ' + Calc.brl(q.gbp) : ''), 'ok');
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


    App.$('#btn-expandir').addEventListener('click', function () {
      var algumFechado = App.$all('.sector-block:not(.open)').length > 0;
      App.$all('.sector-block').forEach(function (b) {
        b.classList.toggle('open', algumFechado);
        state.fechados[b.dataset.sector] = !algumFechado;
      });
      App.$('#btn-expandir').textContent = algumFechado ? 'Recolher tudo' : 'Expandir tudo';
    });

    App.$('#btn-ir-admin').addEventListener('click', function () { location.href = '/admin'; });

    // "/" foca a busca
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
