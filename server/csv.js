'use strict';
/** Monta os CSVs de exportacao reusando shared/calc.js -- mesmas colunas da versao single-usuario. */
const Calc = require('../shared/calc.js');

function linha(valores) {
  return valores.map(Calc.csvCampo).join(';');
}

function buildFolhaCsv(itens, config, options) {
  const comSetor = !!(options && options.comSetor);

  const cabecalho = [];
  if (comSetor) cabecalho.push('Setor');
  cabecalho.push(
    'Nome', 'Salário Base', 'Comissão', 'Aluguel/Outros', 'Bonificação', 'Total', 'Custo Diário',
    'Cidade', 'Cargo', 'Data', 'OBS', 'Pago', 'Dólar', 'Taxa Wise', 'Total c/ Taxas', 'Wise'
  );
  const linhas = [linha(cabecalho)];

  itens.forEach((it) => {
    const r = Calc.calcItem(it, config);
    const valores = [];
    if (comSetor) valores.push(it.sectorName || '');
    valores.push(
      it.nome, Calc.num(Calc.parseNum(it.salarioBase)), Calc.num(Calc.parseNum(it.comissao)),
      Calc.num(Calc.parseNum(it.aluguel)), Calc.num(Calc.parseNum(it.bonificacao)),
      Calc.num(r.total), Calc.num(r.diario), it.cidade, it.cargo, it.data, it.obs,
      it.pago ? 'Sim' : 'Nao', Calc.num(r.dolar), Calc.num(r.fee), Calc.num(r.totalUsd), it.wiseLink
    );
    linhas.push(linha(valores));
  });

  const t = Calc.calcTotais(itens, config);
  const totalValores = [];
  if (comSetor) totalValores.push('');
  totalValores.push(
    'TOTAL', Calc.num(t.salarioBase), Calc.num(t.comissao), Calc.num(t.aluguel), Calc.num(t.bonificacao),
    Calc.num(t.total), Calc.num(t.diario), '', '', '', '', '', Calc.num(t.dolar), Calc.num(t.fee), Calc.num(t.totalUsd), ''
  );
  linhas.push(linha(totalValores));

  return linhas.join('\r\n');
}

function buildWiseCsv(itens, config) {
  const linhas = [linha(['Setor', 'Nome', 'Valor USD', 'Taxa Wise', 'Total USD', 'Link Wise'])];
  itens
    .filter((it) => Calc.calcItem(it, config).totalUsd > 0)
    .forEach((it) => {
      const r = Calc.calcItem(it, config);
      linhas.push(linha([it.sectorName || '', it.nome, Calc.num(r.dolar), Calc.num(r.fee), Calc.num(r.totalUsd), Calc.wiseHref(it.wiseLink)]));
    });
  return linhas.join('\r\n');
}

function withBom(text) {
  return '\ufeff' + text;
}

module.exports = { buildFolhaCsv, buildWiseCsv, withBom };
