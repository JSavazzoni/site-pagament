# Folha de Pagamento — multiusuário

Site de folha de pagamento com login, separação por setor e conversão automática de
Reais para Dólar. Cada **gestor** cuida da folha do próprio setor; a **CCO** vê tudo
junto (mas separado por setor) e executa o pagamento.

> A versão anterior — sem login, um usuário só, dados salvos no navegador — continua
> em [`legado-single-usuario/`](legado-single-usuario/), sem alterações.

## Como rodar

Precisa de **Node.js 22.5 ou mais recente** (usa o módulo `node:sqlite`, nativo do
Node — nenhum banco de dados externo para instalar).

```bash
npm install
npm run seed      # cria o banco e a primeira conta da CCO
npm start         # sobe o servidor em http://localhost:3000
```

O `npm run seed` imprime a senha da conta CCO **uma única vez** — guarde-a. Se quiser
escolher usuário/senha em vez de gerar aleatório:

```bash
SEED_CCO_USERNAME=cco SEED_CCO_PASSWORD="sua-senha-forte" npm run seed
```

Esqueceu uma senha (inclusive a da CCO)? Não há recuperação por e-mail — redefina
pelo terminal:

```bash
npm run reset-password -- <username> [nova-senha]
```

### Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `data/app.db` | Caminho do arquivo SQLite |
| `SESSION_TTL_DAYS` | `7` | Duração da sessão de login |
| `NODE_ENV` | — | Defina `production` para exigir cookie só-HTTPS |

## Papéis

- **Gestor** — entra em `/setor.html`. Só vê e edita os colaboradores do próprio
  setor: nome, salário base, comissão, aluguel/outros, bonificação, cidade, cargo,
  data, OBS, link Wise. Total, custo diário e conversão para dólar são calculados
  automaticamente. A taxa de conversão, dias úteis e taxa Wise são definidos pela
  CCO (o gestor só visualiza). Um lançamento marcado como **pago** trava para
  edição/remoção pelo gestor.
- **CCO** — entra em `/painel.html`. Vê todos os setores agrupados (com subtotal
  cada um) e o total geral em R$ e US$, controla a taxa de conversão do mês
  (manual ou sincronizada com a cotação ao vivo), marca lançamentos como pagos,
  exporta CSV geral ou lista de pagamento Wise. Em `/admin.html` cria/renomeia
  setores e cria/desativa contas de gestor.

Cada gestor pertence a exatamente um setor. Contas CCO são um papel, não uma
única conta fixa — dá para ter mais de uma.

## Cálculo

- **Total** = salário base + comissão + aluguel/outros + bonificação
- **Custo diário** = total ÷ dias úteis do mês
- **Dólar** = total ÷ taxa de conversão
- **Taxa Wise** = dólar × percentual configurado
- **Total c/ taxas** = dólar + taxa Wise

A cotação ao vivo vem da [AwesomeAPI](https://economia.awesomeapi.com.br), com
fallback para [exchangerate-api](https://open.er-api.com) se a primeira falhar.

## Onde ficam os dados

Tudo em `data/app.db` (SQLite, criado automaticamente, fora do controle de
versão). Backup = copiar esse arquivo com o servidor parado.

## Arquitetura (para quem for mexer no código)

```
server/            backend Express — só 1 dependência externa (express);
                    banco via node:sqlite, senha via crypto.scrypt, sessão via
                    cookie httpOnly (token opaco, nunca JWT)
  routes/           uma rota por área: auth, sectors, users, config, payroll
  repo/              acesso a dados por tabela
shared/calc.js      cálculo/parsing/formatação — usado pelo servidor (require)
                    E pelo navegador (<script>), pra nunca duplicar a lógica
public/             frontend estático (vanilla JS, sem build): login, setor
                    (gestor), painel (CCO), admin (CCO)
scripts/            seed.js e reset-password.js (CLI)
```

Autorização é sempre conferida no servidor: um gestor pedindo dados de outro
setor recebe `404` (não `403`, pra não confirmar que o setor existe). Sessão
nunca guarda papel/setor em cache — cada requisição confere de novo no banco,
então desativar alguém derruba a sessão dela na hora.

## Deploy

Este README cobre uso local. Para deixar acessível pela internet (gestores em
computadores diferentes o tempo todo, não só na mesma rede), o próximo passo é
subir isto num serviço como Railway, Render ou uma VPS — o código já está
pronto pra isso (configuração via variáveis de ambiente, nada de caminho fixo
de máquina local). Se quiser ajuda com isso, é só pedir.
