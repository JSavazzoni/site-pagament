'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('./calc.js');

function close(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 0.005 : tol);
}

test('parseNum aceita formatos pt-BR, en-US e R$', () => {
  assert.equal(Calc.parseNum('4.500,00'), 4500);
  assert.equal(Calc.parseNum('4,500.00'), 4500);
  assert.equal(Calc.parseNum('R$ 4.500,00'), 4500);
  assert.equal(Calc.parseNum('4500'), 4500);
  assert.equal(Calc.parseNum(''), 0);
  assert.equal(Calc.parseNum('abc'), 0);
  assert.equal(Calc.parseNum('-50,00'), -50);
  assert.equal(Calc.parseNum(2000), 2000);
});

test('calcItem/calcTotais batem com a planilha real (config explicito, sem closure)', () => {
  const config = { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5 };
  const itens = [
    { nome: 'JOSE', salarioBase: 4500, comissao: 500, aluguel: 50, bonificacao: 0 },
    { nome: 'JOSE', salarioBase: 2000, comissao: 0, aluguel: 0, bonificacao: 0 },
    { nome: 'JOSE', salarioBase: 2500, comissao: 0, aluguel: 0, bonificacao: 0 },
    { nome: 'JOSE', salarioBase: 4000, comissao: 0, aluguel: 0, bonificacao: 0 },
    { nome: 'JOSE', salarioBase: 2000, comissao: 0, aluguel: 0, bonificacao: 0 }
  ];
  const esperado = [
    { total: 5050, diario: 194.23, dolar: 1010, fee: 10.10, totalUsd: 1020.10 },
    { total: 2000, diario: 76.92, dolar: 400, fee: 4.00, totalUsd: 404.00 },
    { total: 2500, diario: 96.15, dolar: 500, fee: 5.00, totalUsd: 505.00 },
    { total: 4000, diario: 153.85, dolar: 800, fee: 8.00, totalUsd: 808.00 },
    { total: 2000, diario: 76.92, dolar: 400, fee: 4.00, totalUsd: 404.00 }
  ];

  itens.forEach((it, i) => {
    const r = Calc.calcItem(it, config);
    assert.ok(close(r.total, esperado[i].total), `L${i + 1} total`);
    assert.ok(close(r.diario, esperado[i].diario, 0.01), `L${i + 1} diario`);
    assert.ok(close(r.dolar, esperado[i].dolar), `L${i + 1} dolar`);
    assert.ok(close(r.fee, esperado[i].fee), `L${i + 1} fee`);
    assert.ok(close(r.totalUsd, esperado[i].totalUsd), `L${i + 1} totalUsd`);
  });

  const t = Calc.calcTotais(itens, config);
  assert.ok(close(t.total, 15550), 'total folha BRL');
  assert.ok(close(t.dolar, 3110), 'total USD');
  assert.ok(close(t.fee, 31.10), 'total taxas');
  assert.ok(close(t.totalUsd, 3141.10), 'total c/ taxas');
});

test('libra converte pela propria taxa, independente do dolar', () => {
  const config = { diasUteis: 22, taxaWisePct: 1, taxaConversao: 5, taxaConversaoGbp: 6.25 };
  const it = { salarioBase: 4500, comissao: 500, aluguel: 50, bonificacao: 0 };
  const r = Calc.calcItem(it, config);

  assert.ok(close(r.total, 5050), 'total em real');
  assert.ok(close(r.dolar, 1010), 'dolar = 5050 / 5');
  assert.ok(close(r.libra, 808), 'libra = 5050 / 6,25');
  assert.ok(close(r.feeGbp, 8.08), 'taxa Wise de 1% sobre a libra');
  assert.ok(close(r.totalGbp, 816.08), 'total em libra com taxa');

  // trocar so a taxa da libra nao pode mexer no dolar (e vice-versa)
  const r2 = Calc.calcItem(it, { ...config, taxaConversaoGbp: 6.5 });
  assert.ok(close(r2.dolar, 1010), 'dolar intocado ao mudar a taxa da libra');
  assert.ok(close(r2.libra, 5050 / 6.5, 0.01), 'libra segue a taxa nova');

  const r3 = Calc.calcItem(it, { ...config, taxaConversao: 5.5 });
  assert.ok(close(r3.libra, 808), 'libra intocada ao mudar a taxa do dolar');

  // sem taxa da libra configurada, o valor e 0 -- nunca herda o do dolar
  const semGbp = Calc.calcItem(it, { diasUteis: 22, taxaWisePct: 1, taxaConversao: 5 });
  assert.equal(semGbp.libra, 0, 'sem taxa da libra o resultado e zero');
  assert.ok(close(semGbp.dolar, 1010), 'dolar continua valendo');

  const t = Calc.calcTotais([it, it], config);
  assert.ok(close(t.libra, 1616), 'soma das libras');
  assert.ok(close(t.totalGbp, 1632.16), 'soma das libras com taxa');
});

test('moeda de pagamento define o "a enviar" e o equivalente em real', () => {
  const config = { diasUteis: 22, taxaWisePct: 1, taxaConversao: 5, taxaConversaoEur: 6, taxaConversaoGbp: 6.25 };
  const base = { salarioBase: 4500, comissao: 500, aluguel: 50, bonificacao: 0 }; // total 5050

  const emUsd = Calc.calcItem({ ...base, moedaPagamento: 'USD' }, config);
  assert.equal(emUsd.moeda, 'USD');
  assert.ok(close(emUsd.aEnviar, 1020.10), 'USD: 5050/5 + 1%');
  assert.ok(close(emUsd.equivaleBrl, 5100.50), 'USD: custa a folha + 1%');

  const emEur = Calc.calcItem({ ...base, moedaPagamento: 'EUR' }, config);
  assert.ok(close(emEur.aEnviar, 850.08, 0.01), 'EUR: 5050/6 + 1%');
  assert.ok(close(emEur.equivaleBrl, 5100.50), 'EUR: mesmo custo em real');

  const emGbp = Calc.calcItem({ ...base, moedaPagamento: 'GBP' }, config);
  assert.ok(close(emGbp.aEnviar, 816.08), 'GBP: 5050/6,25 + 1%');
  assert.ok(close(emGbp.equivaleBrl, 5100.50), 'GBP: mesmo custo em real');

  // em real nao ha conversao, logo nao ha taxa Wise
  const emBrl = Calc.calcItem({ ...base, moedaPagamento: 'BRL' }, config);
  assert.ok(close(emBrl.aEnviar, 5050), 'BRL: manda o total, sem taxa');
  assert.ok(close(emBrl.equivaleBrl, 5050), 'BRL: custa exatamente o total');

  // moeda ausente ou invalida cai em USD, nunca quebra
  assert.equal(Calc.calcItem(base, config).moeda, 'USD');
  assert.equal(Calc.calcItem({ ...base, moedaPagamento: 'XYZ' }, config).moeda, 'USD');

  // as 3 conversoes continuam disponiveis, independentes entre si
  assert.ok(close(emUsd.dolar, 1010) && close(emUsd.euro, 841.67, 0.01) && close(emUsd.libra, 808),
    'as tres moedas convertem do mesmo total, cada uma pela sua taxa');
});

test('calcTotais separa por moeda de pagamento', () => {
  const config = { diasUteis: 22, taxaWisePct: 1, taxaConversao: 5, taxaConversaoEur: 6, taxaConversaoGbp: 6.25 };
  const p = (moedaPagamento) => ({ salarioBase: 5050, moedaPagamento });

  const t = Calc.calcTotais([p('USD'), p('USD'), p('EUR'), p('GBP'), p('BRL')], config);

  assert.deepEqual(Calc.moedasEmUso(t), ['BRL', 'USD', 'EUR', 'GBP'], 'lista so as moedas com gente');
  assert.equal(t.porMoeda.USD.qtd, 2);
  assert.equal(t.porMoeda.EUR.qtd, 1);
  assert.ok(close(t.porMoeda.USD.aEnviar, 2040.20), 'soma so os que recebem em dolar');
  assert.ok(close(t.porMoeda.EUR.aEnviar, 850.08, 0.01), 'soma so os que recebem em euro');
  assert.ok(close(t.porMoeda.BRL.aEnviar, 5050), 'em real, sem taxa');

  assert.ok(close(t.total, 25250), 'folha total em real');
  // 4 pessoas pagam 1% de taxa, 1 (em real) nao paga
  assert.ok(close(t.equivaleBrl, 25250 + 4 * 50.50), 'custo real = folha + taxa so de quem converte');

  const vazio = Calc.calcTotais([], config);
  assert.deepEqual(Calc.moedasEmUso(vazio), [], 'sem itens, nenhuma moeda em uso');
});

test('calcItem nao vaza estado entre chamadas com configs diferentes (regressao do bug de closure)', () => {
  const it = { salarioBase: 5050, comissao: 0, aluguel: 0, bonificacao: 0 };
  const r1 = Calc.calcItem(it, { diasUteis: 26, taxaWisePct: 1, taxaConversao: 5 });
  const r2 = Calc.calcItem(it, { diasUteis: 20, taxaWisePct: 2, taxaConversao: 5.1216 });
  assert.ok(close(r1.dolar, 1010), 'config 1 nao foi contaminada pela config 2');
  assert.ok(close(r2.dolar, 5050 / 5.1216, 0.01), 'config 2 aplicada corretamente');
  assert.notEqual(r1.dolar, r2.dolar);
});

test('parseCSV com aspas e delimitador ; e mapeamento de cabecalho', () => {
  const csv = 'Nome;Salário Base;Comissão;Cidade\r\n"Silva; Jr";4.500,00;500,00;Santa Group\r\nAna;2.000,00;;SP\r\n';
  const linhas = Calc.parseCSV(csv);
  assert.equal(linhas.length, 3);
  assert.deepEqual(linhas[0], ['Nome', 'Salário Base', 'Comissão', 'Cidade']);
  assert.equal(linhas[1][0], 'Silva; Jr');
  assert.equal(Calc.parseNum(linhas[1][1]), 4500);
  assert.equal(linhas[2][2], '');

  ['Nome', 'Salário Base', 'Comissão', 'Aluguel/Outros', 'Bonificação', 'Cidade', 'Cargo', 'Data', 'OBS', 'Wise']
    .forEach((h) => assert.ok(Calc.MAPA_COLUNAS[Calc.normalizarCabecalho(h)], `mapeia coluna "${h}"`));
});

test('datas, links Wise e rotulo de competencia', () => {
  assert.equal(Calc.normalizarData('05/08/2026'), '2026-08-05');
  assert.equal(Calc.normalizarData('2026-08-05'), '2026-08-05');
  assert.equal(Calc.normalizarData('5-8-26'), '2026-08-05');
  assert.equal(Calc.normalizarData('xx'), '');

  assert.equal(Calc.wiseHref('https://wise.com/pay/me/ana'), 'https://wise.com/pay/me/ana');
  assert.equal(Calc.wiseHref('wise.com/pay/me/ana'), 'https://wise.com/pay/me/ana');
  assert.equal(Calc.wiseHref('ana'), 'https://wise.com/pay/me/ana');
  assert.equal(Calc.wiseHref(''), '');

  assert.equal(Calc.labelCompetencia('2026-08'), 'agosto/2026');
  assert.equal(Calc.mesAnterior('2026-01'), '2025-12');
});
