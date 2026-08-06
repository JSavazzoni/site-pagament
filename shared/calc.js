/* ============================================================
   shared/calc.js
   Calculo, parsing e formatacao da folha de pagamento.
   Modulo puro (sem document/window/localStorage) usado tanto pelo
   servidor (require) quanto pelo navegador (<script src="/shared/calc.js">).

   Extraido do app.js da versao single-usuario. calcItem/calcTotais
   antes liam a config por closure sobre um `state` de modulo; aqui
   recebem `config` explicito por parametro -- essencial num servidor
   que atende requisicoes concorrentes de setores/competencias
   diferentes (closure de modulo vazaria estado entre requisicoes).
   A matematica interna e identica, ja validada contra planilha real:
   4500 + 500 + 50 @ taxa 5,00, wise 1% -> total 5050, dolar 1010,
   taxa 10.10, total c/ taxas 1020.10.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Calc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- formatacao ---------------- */

  var nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfGBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfRate = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  function brl(n) { return nfBRL.format(isFinite(n) ? n : 0); }
  function usd(n) { return nfUSD.format(isFinite(n) ? n : 0); }
  function gbp(n) { return nfGBP.format(isFinite(n) ? n : 0); }
  function num(n) { return nfNum.format(isFinite(n) ? n : 0); }
  function rate(n) { return nfRate.format(isFinite(n) ? n : 0); }

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

  /* ---------------- calculo (config explicito, sem closure) ---------------- */

  /**
   * Dolar e libra sao conversoes INDEPENDENTES do mesmo total em real, cada uma
   * pela sua propria taxa -- nunca uma derivada da outra por cross rate.
   *
   * @param {object} it - { salarioBase, comissao, aluguel, bonificacao }
   * @param {object} config - { diasUteis, taxaConversao, taxaConversaoGbp, taxaWisePct }
   */
  function calcItem(it, config) {
    var c = config || {};
    var total = parseNum(it.salarioBase) + parseNum(it.comissao) + parseNum(it.aluguel) + parseNum(it.bonificacao);
    var dias = Math.max(1, parseNum(c.diasUteis) || 26);
    var pct = parseNum(c.taxaWisePct) / 100;

    var taxaUsd = parseNum(c.taxaConversao);
    var dolar = taxaUsd > 0 ? total / taxaUsd : 0;
    var fee = dolar * pct;

    var taxaGbp = parseNum(c.taxaConversaoGbp);
    var libra = taxaGbp > 0 ? total / taxaGbp : 0;
    var feeGbp = libra * pct;

    return {
      total: total, diario: total / dias,
      dolar: dolar, fee: fee, totalUsd: dolar + fee,
      libra: libra, feeGbp: feeGbp, totalGbp: libra + feeGbp
    };
  }

  /**
   * @param {object[]} itens
   * @param {object} config
   */
  function calcTotais(itens, config) {
    var list = itens || [];
    var t = {
      salarioBase: 0, comissao: 0, aluguel: 0, bonificacao: 0,
      total: 0, diario: 0,
      dolar: 0, fee: 0, totalUsd: 0,
      libra: 0, feeGbp: 0, totalGbp: 0
    };
    list.forEach(function (it) {
      var r = calcItem(it, config);
      t.salarioBase += parseNum(it.salarioBase);
      t.comissao += parseNum(it.comissao);
      t.aluguel += parseNum(it.aluguel);
      t.bonificacao += parseNum(it.bonificacao);
      t.total += r.total; t.diario += r.diario;
      t.dolar += r.dolar; t.fee += r.fee; t.totalUsd += r.totalUsd;
      t.libra += r.libra; t.feeGbp += r.feeGbp; t.totalGbp += r.totalGbp;
    });
    return t;
  }

  function wiseHref(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/[./]/.test(v)) return 'https://' + v.replace(/^\/+/, '');
    return 'https://wise.com/pay/me/' + encodeURIComponent(v.replace(/^@/, ''));
  }

  /* ---------------- CSV ---------------- */

  function csvCampo(v) {
    v = String(v == null ? '' : v);
    return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  /** Parser CSV simples com suporte a aspas; detecta ; , ou TAB. */
  function parseCSV(texto) {
    texto = String(texto || '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
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

  return {
    brl: brl, usd: usd, gbp: gbp, num: num, rate: rate,
    parseNum: parseNum, esc: esc,
    MESES: MESES, labelCompetencia: labelCompetencia, mesAtual: mesAtual, mesAnterior: mesAnterior,
    calcItem: calcItem, calcTotais: calcTotais, wiseHref: wiseHref,
    csvCampo: csvCampo, parseCSV: parseCSV,
    normalizarCabecalho: normalizarCabecalho, MAPA_COLUNAS: MAPA_COLUNAS, NUMERICOS: NUMERICOS,
    normalizarData: normalizarData
  };
});
