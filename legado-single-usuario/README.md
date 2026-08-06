# Folha de Pagamento — BRL → USD

Site de folha de pagamento com conversão automática de reais para dólar usando a cotação atual do mercado.

## Como usar

Abra o arquivo `index.html` no navegador — é só isso. Não precisa instalar nada.

Se preferir rodar em um servidor local (recomendado, evita restrições de `file://` em alguns navegadores):

```bash
npx serve .
# ou
python -m http.server 8000
```

Depois acesse `http://localhost:3000` (ou `:8000`).

## O que o site faz

### Cotação ao vivo
- Busca USD/BRL e EUR/BRL na [AwesomeAPI](https://economia.awesomeapi.com.br) ao abrir e a cada 10 minutos.
- Fallback automático para a [exchangerate-api](https://open.er-api.com) se a primeira falhar.
- Última cotação fica em cache, então o site abre já mostrando um valor mesmo offline.

### Taxa de conversão
Você escolhe qual taxa usar no cálculo da folha:
- **Taxa fixa** — digite o valor (ex.: `5,00`, como na sua planilha). É o padrão.
- **Botão "Usar cotação"** — puxa a cotação do momento uma única vez.
- **"Sincronizar com a cotação ao vivo"** — a taxa acompanha o dólar automaticamente.

### Colunas da folha
`Nome · Salário base · Comissão · Aluguel/Outros · Bonificação · Total · Custo diário · Cidade · Cargo · Data · OBS`

Calculadas automaticamente:
- **Total** = salário base + comissão + aluguel/outros + bonificação
- **Custo diário** = total ÷ dias úteis (padrão 26, configurável)

### Pagamento em dólar
`Nome · Valor (R$) · Dólar ($) · Taxa Wise · Total c/ taxas ($) · Link Wise`

- **Dólar** = total ÷ taxa de conversão
- **Taxa Wise** = dólar × percentual configurado (padrão 1%)
- **Total c/ taxas** = dólar + taxa Wise
- O campo Wise aceita link completo, `wise.com/pay/me/nome` ou só o usuário — vira link clicável.

### Resumo no topo
Colaboradores, total da folha em R$, total em US$, total com taxas e o **custo real na cotação de hoje** — quanto você gastaria em reais para comprar esses dólares agora, comparado ao total da folha. É esse número que mostra se a taxa fixa está te favorecendo ou não.

### Competência (mês)
Cada mês guarda sua própria folha e seus próprios parâmetros. O botão **Copiar mês anterior** traz os colaboradores do mês passado para o atual.

### Importar / exportar
- **Exportar CSV** — folha completa com cabeçalho de parâmetros e linha de totais. Separador `;` e números em pt-BR, abre direto no Excel brasileiro.
- **Importar CSV** — reconhece as colunas pelo nome (com ou sem acento), aceita `;`, `,` ou tab, e entende valores em pt-BR e en-US. Só precisa ter uma coluna **Nome**.
- **Exportar lista de pagamento** — CSV enxuto só com nome, valor em dólar e link Wise.
- **Imprimir / PDF** — layout A4 paisagem, sem botões, pronto para arquivar ou enviar.

## Atalhos

- **Enter** em qualquer célula pula para a linha de baixo; na última linha, cria um colaborador novo.
- Valores aceitam qualquer formato: `4500`, `4.500,00`, `4,500.00` ou `R$ 4.500,00`.

## Onde ficam os dados

Tudo no `localStorage` do navegador — nada sai da sua máquina, nenhum servidor envolvido. As únicas requisições externas são as de cotação.

Consequências: limpar os dados do navegador apaga a folha, e ela não sincroniza entre dispositivos. Use **Exportar CSV** para backup.

## Arquivos

```
index.html    estrutura da página
styles.css    estilos (inclui o layout de impressão)
app.js        cálculos, cotação, persistência, CSV
```

Sem dependências, sem build.
