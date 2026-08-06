/* ============================================================
   Folha de Pagamento — BRL → USD
   Dados no localStorage. Cotação via AwesomeAPI (fallback: open.er-api).
   ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'folha-pagamento:v1';
  var RATE_KEY = 'folha-pagamento:cotacao';

  /* ---------------- formatação ---------------- */

  var nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfRate = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  function brl(n) { return nfBRL.format(isFinite(n) ? n : 0); }
  function usd(n) { return nfUSD.format(isFinite(n) ? n : 0); }
  function num(n) { return nfNum.format(isFinite(n) ? n : 0); }

  /** Aceita "4500", "4.500,00", "4,500.00", "R$ 4.500" */
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var s = String(v).trim().replace(/[R$\s\u00a0]/g, '');
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || s.charAt(0) === '-';
    s = s.replace(/[()\-]/g, '');
    var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c > -1 && d > -1) {
      s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (c > -1) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (d > -1) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function $(sel) { return document.querySelector(sel); }

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function labelCompetencia(key) {
    var p = String(key || '').split('-');
    var m = parseInt(p[1], 10);
    return (MESES[m - 1] || '?') + '/' + p[0];
  }

  function mesAtual() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function mesAnterior(key) {
    var p = String(key).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1;
    if (m < 1) { m = 12; y -= 1; }
    return y + '-' + String(m).padStart(2, '0');
  }

  /* ---------------- estado ---------------- */

  function configPadrao() {
    return { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5, autoCotacao: false };
  }

  function itemNovo(patch) {
    var it = {
      id: uid(), nome: '', salarioBase: 0, comissao: 0, aluguel: 0, bonificacao: 0,
      cidade: '', cargo: '', data: '', obs: '', wise: ''
    };
    if (patch) for (var k in patch) if (k in it && k !== 'id') it[k] = patch[k];
    return it;
  }

  var state = { competencia: mesAtual(), folhas: {} };
  var rates = { usd: 0, eur: 0, usdVar: 0, eurVar: 0, at: null, source: '' };

  function folhaAtual() {
    var k = state.competencia;
    if (!state.folhas[k]) state.folhas[k] = { config: configPadrao(), itens: [] };
    var f = state.folhas[k];
    if (!f.config) f.config = configPadrao();
    if (!Array.isArray(f.itens)) f.itens = [];
    return f;
  }

  function cfg() { return folhaAtual().config; }
  function itens() { return folhaAtual().itens; }

  function carregar() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.folhas) {
          state.folhas = s.folhas;
          state.competencia = s.competencia || mesAtual();
        }
      }
      var r = localStorage.getItem(RATE_KEY);
      if (r) {
        var c = JSON.parse(r);
        if (c && c.usd) { rates = c; rates.at = c.at ? new Date(c.at) : null; }
      }
    } catch (e) { /* storage indisponível — segue com estado vazio */ }
  }

  var saveTimer = null;
  function salvar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { toast('Não foi possível salvar neste navegador.', true); }
    }, 250);
  }

  /* ---------------- cálculos ---------------- */

  function calcItem(it) {
    var c = cfg();
    var total = parseNum(it.salarioBase) + parseNum(it.comissao) + parseNum(it.aluguel) + parseNum(it.bonificacao);
    var dias = Math.max(1, parseNum(c.diasUteis) || 26);
    var taxa = parseNum(c.taxaConversao);
    var dolar = taxa > 0 ? total / taxa : 0;
    var fee = dolar * (parseNum(c.taxaWisePct) / 100);
    return { total: total, diario: total / dias, dolar: dolar, fee: fee, totalUsd: dolar + fee };
  }

  function calcTotais() {
    var t = {
      salarioBase: 0, comissao: 0, aluguel: 0, bonificacao: 0,
      total: 0, diario: 0, dolar: 0, fee: 0, totalUsd: 0
    };
    itens().forEach(function (it) {
      var r = calcItem(it);
      t.salarioBase += parseNum(it.salarioBase);
      t.comissao += parseNum(it.comissao);
      t.aluguel += parseNum(it.aluguel);
      t.bonificacao += parseNum(it.bonificacao);
      t.total += r.total; t.diario += r.diario;
      t.dolar += r.dolar; t.fee += r.fee; t.totalUsd += r.totalUsd;
    });
    return t;
  }

  /* ---------------- cotação ---------------- */

  function fetchTimeout(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (e) { clearTimeout(t); throw e; });
  }

  function buscarCotacao(silencioso) {
    var btn = $('#btn-refresh');
    btn.classList.add('loading');
    btn.disabled = true;

    return fetchTimeout('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL')
      .then(function (d) {
        if (!d.USDBRL) throw new Error('resposta inesperada');
        return {
          usd: parseFloat(d.USDBRL.bid),
          eur: d.EURBRL ? parseFloat(d.EURBRL.bid) : 0,
          usdVar: parseFloat(d.USDBRL.pctChange) || 0,
          eurVar: d.EURBRL ? (parseFloat(d.EURBRL.pctChange) || 0) : 0,
          at: new Date(), source: 'AwesomeAPI'
        };
      })
      .catch(function () {
        return fetchTimeout('https://open.er-api.com/v6/latest/USD').then(function (d) {
          if (!d.rates || !d.rates.BRL) throw new Error('resposta inesperada');
          return {
            usd: d.rates.BRL,
            eur: d.rates.EUR ? d.rates.BRL / d.rates.EUR : 0,
            usdVar: 0, eurVar: 0,
            at: new Date(), source: 'exchangerate-api'
          };
        });
      })
      .then(function (r) {
        rates = r;
        try { localStorage.setItem(RATE_KEY, JSON.stringify(r)); } catch (e) {}
        if (cfg().autoCotacao) {
          cfg().taxaConversao = r.usd;
          $('#taxa-conversao').value = nfRate.format(r.usd);
          salvar();
        }
        renderCotacao();
        recalc();
        if (!silencioso) toast('Cotação atualizada: US$ 1 = ' + brl(r.usd));
      })
      .catch(function () {
        renderCotacao();
        if (!silencioso) toast('Não foi possível buscar a cotação. Verifique a conexão.', true);
        else $('#quote-time').textContent = 'Cotação indisponível';
      })
      .then(function () {
        btn.classList.remove('loading');
        btn.disabled = false;
      });
  }

  function renderCotacao() {
    function setQuote(valSel, varSel, val, pct) {
      $(valSel).textContent = val ? brl(val) : '—';
      var el = $(varSel);
      el.className = 'quote-var ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : '');
      el.textContent = pct ? (pct > 0 ? '▲ ' : '▼ ') + num(Math.abs(pct)) + '%' : '';
    }
    setQuote('[data-usd-value]', '[data-usd-var]', rates.usd, rates.usdVar);
    setQuote('[data-eur-value]', '[data-eur-var]', rates.eur, rates.eurVar);

    if (rates.at) {
      var d = new Date(rates.at);
      $('#quote-time').textContent = 'Atualizado ' + d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      }) + (rates.source ? ' · ' + rates.source : '');
    }
  }

  /* ---------------- render ---------------- */

  var TB_FOLHA = null, TB_USD = null;

  function linhaFolha(it, i) {
    return '<tr data-id="' + it.id + '">' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td><input class="cell nome" data-f="nome" placeholder="Nome" value="' + esc(it.nome) + '"></td>' +
      moneyTd('salarioBase', it.salarioBase) +
      moneyTd('comissao', it.comissao) +
      moneyTd('aluguel', it.aluguel) +
      moneyTd('bonificacao', it.bonificacao) +
      '<td class="calc calc-total" data-c="total">R$ 0,00</td>' +
      '<td class="calc calc-diario" data-c="diario">R$ 0,00</td>' +
      '<td><input class="cell" data-f="cidade" placeholder="—" value="' + esc(it.cidade) + '"></td>' +
      '<td><input class="cell" data-f="cargo" placeholder="—" value="' + esc(it.cargo) + '"></td>' +
      '<td><input class="cell" type="date" data-f="data" value="' + esc(it.data) + '"></td>' +
      '<td><input class="cell" data-f="obs" placeholder="—" value="' + esc(it.obs) + '"></td>' +
      '<td class="acao"><button class="btn-icon" data-del type="button" title="Remover colaborador" aria-label="Remover">×</button></td>' +
      '</tr>';
  }

  function moneyTd(field, val) {
    var v = parseNum(val);
    return '<td><input class="cell money" data-f="' + field + '" inputmode="decimal" placeholder="0,00" value="' +
      (v ? num(v) : '') + '"></td>';
  }

  function linhaUsd(it, i) {
    return '<tr data-id="' + it.id + '">' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td class="ro ro-left" data-c="nome">' + (esc(it.nome) || '<span style="color:#94a3b8">sem nome</span>') + '</td>' +
      '<td class="ro" data-c="brl">R$ 0,00</td>' +
      '<td class="calc calc-usd" data-c="dolar">$0.00</td>' +
      '<td class="calc" data-c="fee">$0.00</td>' +
      '<td class="calc calc-usd" data-c="totalUsd">$0.00</td>' +
      '<td><div class="wise-cell">' +
        '<input class="cell" data-f="wise" placeholder="wise.com/pay/me/..." value="' + esc(it.wise) + '">' +
        '<a class="wise-link" target="_blank" rel="noopener" title="Abrir link Wise">↗</a>' +
      '</div></td>' +
      '<td class="acao"><button class="btn-icon" data-del type="button" title="Remover colaborador" aria-label="Remover">×</button></td>' +
      '</tr>';
  }

  function renderTabelas() {
    var list = itens();
    TB_FOLHA.innerHTML = list.map(linhaFolha).join('');
    TB_USD.innerHTML = list.map(linhaUsd).join('');
    $('#empty-folha').hidden = list.length > 0;
    $('#empty-usd').hidden = list.length > 0;
    recalc();
  }

  /** Atualiza apenas células calculadas — não recria o DOM (mantém o foco). */
  function recalc() {
    var list = itens();
    var c = cfg();
    var map = {};
    list.forEach(function (it) { map[it.id] = it; });

    Array.prototype.forEach.call(TB_FOLHA.rows, function (tr) {
      var it = map[tr.dataset.id];
      if (!it) return;
      var r = calcItem(it);
      tr.querySelector('[data-c="total"]').textContent = brl(r.total);
      tr.querySelector('[data-c="diario"]').textContent = brl(r.diario);
    });

    Array.prototype.forEach.call(TB_USD.rows, function (tr) {
      var it = map[tr.dataset.id];
      if (!it) return;
      var r = calcItem(it);
      var nomeCell = tr.querySelector('[data-c="nome"]');
      if (document.activeElement !== nomeCell) {
        nomeCell.innerHTML = it.nome ? esc(it.nome) : '<span style="color:#94a3b8">sem nome</span>';
      }
      tr.querySelector('[data-c="brl"]').textContent = brl(r.total);
      tr.querySelector('[data-c="dolar"]').textContent = usd(r.dolar);
      tr.querySelector('[data-c="fee"]').textContent = usd(r.fee);
      tr.querySelector('[data-c="totalUsd"]').textContent = usd(r.totalUsd);

      var link = tr.querySelector('.wise-link');
      var href = wiseHref(it.wise);
      link.hidden = !href;
      if (href) { link.href = href; link.classList.add('on'); }
    });

    var t = calcTotais();

    $('#t-salario').textContent = brl(t.salarioBase);
    $('#t-comissao').textContent = brl(t.comissao);
    $('#t-aluguel').textContent = brl(t.aluguel);
    $('#t-bonificacao').textContent = brl(t.bonificacao);
    $('#t-total').textContent = brl(t.total);
    $('#t-diario').textContent = brl(t.diario);

    $('#u-brl').textContent = brl(t.total);
    $('#u-usd').textContent = usd(t.dolar);
    $('#u-taxa').textContent = usd(t.fee);
    $('#u-total').textContent = usd(t.totalUsd);

    $('#kpi-qtd').textContent = list.length;
    $('#kpi-total-brl').textContent = brl(t.total);
    $('#kpi-custo-diario').textContent = 'Custo diário: ' + brl(t.diario) + ' · ' + (parseNum(c.diasUteis) || 26) + ' dias';
    $('#kpi-total-usd').textContent = usd(t.dolar);
    $('#kpi-taxa-usada').textContent = 'à taxa de ' + brl(parseNum(c.taxaConversao)) + ' / US$';
    $('#kpi-total-usd-taxas').textContent = usd(t.totalUsd);
    $('#kpi-total-taxas').textContent = 'Taxas Wise: ' + usd(t.fee) + ' (' + num(parseNum(c.taxaWisePct)) + '%)';

    // Quanto custa, em reais, comprar esses dólares na cotação de hoje
    var custoReal = rates.usd ? t.totalUsd * rates.usd : 0;
    $('#kpi-custo-real').textContent = rates.usd ? brl(custoReal) : '—';
    var dif = $('#kpi-diferenca');
    if (!rates.usd || !t.total) {
      dif.className = 'kpi-foot';
      dif.textContent = rates.usd ? '—' : 'Cotação indisponível';
    } else {
      var delta = custoReal - t.total;
      var pct = (delta / t.total) * 100;
      dif.className = 'kpi-foot delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
      dif.textContent = (delta >= 0 ? '+' : '−') + brl(Math.abs(delta)).replace('R$', 'R$') +
        ' (' + (delta >= 0 ? '+' : '−') + num(Math.abs(pct)) + '%) vs. folha';
    }

    $('.brand-sub').textContent = 'Competência ' + labelCompetencia(state.competencia) +
      ' · US$ 1 = ' + brl(parseNum(c.taxaConversao));
  }

  function wiseHref(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/[./]/.test(v)) return 'https://' + v.replace(/^\/+/, '');
    return 'https://wise.com/pay/me/' + encodeURIComponent(v.replace(/^@/, ''));
  }

  /* ---------------- painel de parâmetros ---------------- */

  function renderPainel() {
    var c = cfg();
    $('#competencia').value = state.competencia;
    $('#taxa-conversao').value = nfRate.format(parseNum(c.taxaConversao));
    $('#dias-uteis').value = parseNum(c.diasUteis) || 26;
    $('#taxa-wise').value = num(parseNum(c.taxaWisePct));
    $('#auto-cotacao').checked = !!c.autoCotacao;
    $('#taxa-conversao').disabled = !!c.autoCotacao;
    $('#btn-usar-cotacao').disabled = !!c.autoCotacao;

    var meses = Object.keys(state.folhas).filter(function (k) {
      return state.folhas[k].itens && state.folhas[k].itens.length;
    }).sort();
    $('#hint-competencia').textContent = meses.length > 1
      ? meses.length + ' meses salvos: ' + meses.map(labelCompetencia).join(', ')
      : 'Cada mês guarda sua própria folha.';
  }

  /* ---------------- eventos ---------------- */

  function bindPainel() {
    $('#competencia').addEventListener('change', function (e) {
      state.competencia = e.target.value || mesAtual();
      folhaAtual();
      salvar();
      renderPainel();
      renderTabelas();
    });

    $('#btn-copiar-mes').addEventListener('click', function () {
      var anterior = state.folhas[mesAnterior(state.competencia)];
      if (!anterior || !anterior.itens.length) {
        // procura o mês salvo mais recente antes da competência atual
        var anteriores = Object.keys(state.folhas)
          .filter(function (k) { return k < state.competencia && state.folhas[k].itens.length; }).sort();
        anterior = anteriores.length ? state.folhas[anteriores[anteriores.length - 1]] : null;
      }
      if (!anterior) { toast('Nenhum mês anterior salvo para copiar.', true); return; }
      if (itens().length && !confirm('Isso substitui os colaboradores de ' + labelCompetencia(state.competencia) + '. Continuar?')) return;

      var f = folhaAtual();
      f.config = JSON.parse(JSON.stringify(anterior.config));
      f.itens = anterior.itens.map(function (it) {
        var copia = itemNovo(it);
        copia.data = '';
        return copia;
      });
      salvar(); renderPainel(); renderTabelas();
      toast(f.itens.length + ' colaboradores copiados.');
    });

    $('#taxa-conversao').addEventListener('change', function (e) {
      var v = parseNum(e.target.value);
      if (v <= 0) { toast('A taxa de conversão precisa ser maior que zero.', true); v = parseNum(cfg().taxaConversao) || 5; }
      cfg().taxaConversao = v;
      e.target.value = nfRate.format(v);
      salvar(); recalc();
    });

    $('#btn-usar-cotacao').addEventListener('click', function () {
      if (!rates.usd) { toast('Cotação ainda não carregada.', true); return; }
      cfg().taxaConversao = rates.usd;
      $('#taxa-conversao').value = nfRate.format(rates.usd);
      salvar(); recalc();
      toast('Taxa ajustada para a cotação atual: ' + brl(rates.usd));
    });

    $('#auto-cotacao').addEventListener('change', function (e) {
      cfg().autoCotacao = e.target.checked;
      if (e.target.checked && rates.usd) cfg().taxaConversao = rates.usd;
      salvar(); renderPainel(); recalc();
    });

    $('#dias-uteis').addEventListener('change', function (e) {
      var v = Math.min(31, Math.max(1, Math.round(parseNum(e.target.value)) || 26));
      cfg().diasUteis = v;
      e.target.value = v;
      salvar(); recalc();
    });

    $('#taxa-wise').addEventListener('change', function (e) {
      var v = Math.max(0, parseNum(e.target.value));
      cfg().taxaWisePct = v;
      e.target.value = num(v);
      salvar(); recalc();
    });

    $('#btn-refresh').addEventListener('click', function () { buscarCotacao(false); });
  }

  function bindTabelas() {
    [TB_FOLHA, TB_USD].forEach(function (tb) {

      tb.addEventListener('input', function (e) {
        var inp = e.target.closest('.cell');
        if (!inp) return;
        var tr = inp.closest('tr');
        var it = itens().find(function (x) { return x.id === tr.dataset.id; });
        if (!it) return;
        var f = inp.dataset.f;
        it[f] = inp.classList.contains('money') ? parseNum(inp.value) : inp.value;
        salvar();
        recalc();
      });

      // valores monetários: número cru ao focar, formatado ao sair
      tb.addEventListener('focusin', function (e) {
        var inp = e.target.closest('.cell.money');
        if (!inp) return;
        var tr = inp.closest('tr');
        var it = itens().find(function (x) { return x.id === tr.dataset.id; });
        if (!it) return;
        var v = parseNum(it[inp.dataset.f]);
        inp.value = v ? String(v).replace('.', ',') : '';
        inp.select();
      });

      tb.addEventListener('focusout', function (e) {
        var inp = e.target.closest('.cell.money');
        if (!inp) return;
        var v = parseNum(inp.value);
        inp.value = v ? num(v) : '';
      });

      tb.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-del]');
        if (!btn) return;
        var tr = btn.closest('tr');
        var it = itens().find(function (x) { return x.id === tr.dataset.id; });
        if (!it) return;
        if (!confirm('Remover ' + (it.nome || 'este colaborador') + ' da folha?')) return;
        folhaAtual().itens = itens().filter(function (x) { return x.id !== it.id; });
        salvar(); renderPainel(); renderTabelas();
      });

      // Enter navega para a linha de baixo (e cria linha no fim)
      tb.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var inp = e.target.closest('.cell');
        if (!inp) return;
        e.preventDefault();
        var tr = inp.closest('tr');
        var next = tr.nextElementSibling;
        if (!next) {
          addColaborador(true);
          next = tb.rows[tb.rows.length - 1];
        }
        var alvo = next && next.querySelector('[data-f="' + inp.dataset.f + '"]');
        if (alvo) alvo.focus();
      });
    });
  }

  function addColaborador(silencioso) {
    itens().push(itemNovo());
    salvar();
    renderPainel();
    renderTabelas();
    if (!silencioso) {
      var last = TB_FOLHA.rows[TB_FOLHA.rows.length - 1];
      if (last) last.querySelector('[data-f="nome"]').focus();
    }
  }

  /* ---------------- CSV ---------------- */

  var COLS = [
    ['Nome', function (it) { return it.nome; }],
    ['Salário Base', function (it, r) { return num(parseNum(it.salarioBase)); }],
    ['Comissão', function (it) { return num(parseNum(it.comissao)); }],
    ['Aluguel/Outros', function (it) { return num(parseNum(it.aluguel)); }],
    ['Bonificação', function (it) { return num(parseNum(it.bonificacao)); }],
    ['Total', function (it, r) { return num(r.total); }],
    ['Custo Diário', function (it, r) { return num(r.diario); }],
    ['Cidade', function (it) { return it.cidade; }],
    ['Cargo', function (it) { return it.cargo; }],
    ['Data', function (it) { return it.data; }],
    ['OBS', function (it) { return it.obs; }],
    ['Dólar', function (it, r) { return num(r.dolar); }],
    ['Taxa Wise', function (it, r) { return num(r.fee); }],
    ['Total c/ Taxas', function (it, r) { return num(r.totalUsd); }],
    ['Wise', function (it) { return it.wise; }]
  ];

  function csvCampo(v) {
    v = String(v == null ? '' : v);
    return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function baixar(nome, conteudo) {
    var blob = new Blob(['\ufeff' + conteudo], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportarCSV() {
    var list = itens();
    if (!list.length) { toast('Nada para exportar.', true); return; }
    var c = cfg();
    var linhas = [];

    linhas.push(['Folha de pagamento — ' + labelCompetencia(state.competencia)].map(csvCampo).join(';'));
    linhas.push(['Taxa de conversão (R$/US$)', num(parseNum(c.taxaConversao))].map(csvCampo).join(';'));
    linhas.push(['Taxa Wise (%)', num(parseNum(c.taxaWisePct))].map(csvCampo).join(';'));
    linhas.push(['Dias úteis', parseNum(c.diasUteis)].map(csvCampo).join(';'));
    if (rates.usd) linhas.push(['Cotação USD do dia', num(rates.usd)].map(csvCampo).join(';'));
    linhas.push('');

    linhas.push(COLS.map(function (col) { return csvCampo(col[0]); }).join(';'));
    list.forEach(function (it) {
      var r = calcItem(it);
      linhas.push(COLS.map(function (col) { return csvCampo(col[1](it, r)); }).join(';'));
    });

    var t = calcTotais();
    linhas.push(['TOTAL', num(t.salarioBase), num(t.comissao), num(t.aluguel), num(t.bonificacao),
      num(t.total), num(t.diario), '', '', '', '', num(t.dolar), num(t.fee), num(t.totalUsd), '']
      .map(csvCampo).join(';'));

    baixar('folha-' + state.competencia + '.csv', linhas.join('\r\n'));
    toast('CSV exportado.');
  }

  function exportarWise() {
    var list = itens().filter(function (it) { return calcItem(it).totalUsd > 0; });
    if (!list.length) { toast('Nada para exportar.', true); return; }
    var linhas = [['Nome', 'Valor USD', 'Taxa Wise', 'Total USD', 'Link Wise', 'Referência'].join(';')];
    list.forEach(function (it) {
      var r = calcItem(it);
      linhas.push([
        csvCampo(it.nome),
        num(r.dolar), num(r.fee), num(r.totalUsd),
        csvCampo(wiseHref(it.wise)),
        csvCampo('Folha ' + labelCompetencia(state.competencia))
      ].join(';'));
    });
    baixar('pagamento-usd-' + state.competencia + '.csv', linhas.join('\r\n'));
    toast('Lista de pagamento exportada.');
  }

  /** Parser CSV simples com suporte a aspas; detecta ; , ou TAB. */
  function parseCSV(texto) {
    texto = texto.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
    var primeira = texto.split('\n')[0] || '';
    var delim = [';', ',', '\t'].reduce(function (a, d) {
      return (primeira.split(d).length > primeira.split(a).length) ? d : a;
    }, ';');

    var linhas = [], campo = '', linha = [], aspas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (aspas) {
        if (ch === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; }
          else aspas = false;
        } else campo += ch;
      } else if (ch === '"') {
        aspas = true;
      } else if (ch === delim) {
        linha.push(campo); campo = '';
      } else if (ch === '\n') {
        linha.push(campo); linhas.push(linha); linha = []; campo = '';
      } else campo += ch;
    }
    linha.push(campo);
    if (linha.length > 1 || linha[0] !== '') linhas.push(linha);
    return linhas;
  }

  function normalizarCabecalho(h) {
    return String(h || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  var MAPA_COLUNAS = {
    nome: 'nome', colaborador: 'nome', funcionario: 'nome',
    salariobase: 'salarioBase', salario: 'salarioBase', base: 'salarioBase',
    comissao: 'comissao',
    alugueloutros: 'aluguel', aluguel: 'aluguel', outros: 'aluguel',
    bonificacao: 'bonificacao', bonus: 'bonificacao',
    cidade: 'cidade', grupo: 'cidade',
    cargo: 'cargo', funcao: 'cargo',
    data: 'data',
    obs: 'obs', observacao: 'obs', observacoes: 'obs',
    wise: 'wise', linkwise: 'wise'
  };

  var NUMERICOS = { salarioBase: 1, comissao: 1, aluguel: 1, bonificacao: 1 };

  function importarCSV(texto) {
    var linhas = parseCSV(texto).filter(function (l) {
      return l.some(function (c) { return String(c).trim() !== ''; });
    });
    if (!linhas.length) { toast('Arquivo vazio.', true); return; }

    // acha a linha de cabeçalho (a que contém "nome")
    var idxCab = -1, mapa = null;
    for (var i = 0; i < Math.min(linhas.length, 15); i++) {
      var m = {}, achou = false;
      linhas[i].forEach(function (col, j) {
        var campo = MAPA_COLUNAS[normalizarCabecalho(col)];
        if (campo) { m[j] = campo; if (campo === 'nome') achou = true; }
      });
      if (achou) { idxCab = i; mapa = m; break; }
    }
    if (idxCab === -1) {
      toast('Não encontrei a coluna "Nome" no arquivo.', true);
      return;
    }

    var novos = [];
    for (var r = idxCab + 1; r < linhas.length; r++) {
      var linha = linhas[r];
      var it = itemNovo();
      var temDado = false;
      for (var j in mapa) {
        var campo = mapa[j];
        var bruto = (linha[j] || '').trim();
        if (!bruto) continue;
        if (campo === 'nome' && /^total$/i.test(bruto)) { temDado = false; break; }
        it[campo] = NUMERICOS[campo] ? parseNum(bruto) : bruto;
        if (campo === 'data') it.data = normalizarData(bruto);
        temDado = true;
      }
      if (temDado && (it.nome || calcItem(it).total > 0)) novos.push(it);
    }

    if (!novos.length) { toast('Nenhuma linha válida encontrada.', true); return; }

    var substituir = itens().length
      ? confirm('Já existem ' + itens().length + ' colaboradores em ' + labelCompetencia(state.competencia) + '.\n\nOK = substituir tudo\nCancelar = adicionar ao final')
      : true;

    if (substituir) folhaAtual().itens = novos;
    else folhaAtual().itens = itens().concat(novos);

    salvar(); renderPainel(); renderTabelas();
    toast(novos.length + ' colaboradores importados.');
  }

  function normalizarData(v) {
    v = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      var ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return ano + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    return '';
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(msg, erro) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (erro ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  /* ---------------- init ---------------- */

  function init() {
    TB_FOLHA = $('#tbody-folha');
    TB_USD = $('#tbody-usd');

    carregar();
    folhaAtual();

    renderPainel();
    renderCotacao();
    renderTabelas();

    bindPainel();
    bindTabelas();

    $('#btn-add').addEventListener('click', function () { addColaborador(false); });
    $('#btn-export-csv').addEventListener('click', exportarCSV);
    $('#btn-export-wise').addEventListener('click', exportarWise);
    $('#btn-print').addEventListener('click', function () { window.print(); });

    $('#btn-import-csv').addEventListener('click', function () { $('#file-csv').click(); });
    $('#file-csv').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importarCSV(String(reader.result)); };
      reader.onerror = function () { toast('Erro ao ler o arquivo.', true); };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });

    $('#btn-limpar').addEventListener('click', function () {
      if (!itens().length) { toast('A folha já está vazia.'); return; }
      if (!confirm('Apagar todos os colaboradores de ' + labelCompetencia(state.competencia) + '?')) return;
      folhaAtual().itens = [];
      salvar(); renderPainel(); renderTabelas();
      toast('Folha limpa.');
    });

    buscarCotacao(true);
    setInterval(function () { buscarCotacao(true); }, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
