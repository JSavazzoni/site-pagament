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

### Variáveis de ambiente (todas opcionais no uso local)

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `data/app.db` | Caminho do arquivo SQLite local |
| `TURSO_DATABASE_URL` | — | URL do banco Turso; quando definida, o app usa o Turso em vez do arquivo local (obrigatória no Vercel) |
| `TURSO_AUTH_TOKEN` | — | Token de acesso do banco Turso |
| `SESSION_TTL_DAYS` | `7` | Duração da sessão de login |
| `NODE_ENV` | — | Defina `production` para exigir cookie só-HTTPS (no Vercel isso já é automático) |

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

- **Local**: `data/app.db` (SQLite, criado automaticamente, fora do controle de
  versão). Backup = copiar esse arquivo com o servidor parado.
- **No Vercel**: num banco [Turso](https://turso.tech) (SQLite hospedado, mesmo
  dialeto SQL). O Vercel é serverless e **não tem disco persistente** — sem um
  banco externo, os dados sumiriam a cada execução.

## Arquitetura (para quem for mexer no código)

```
server/app.js       monta o app Express (sem listen) — usado pelos 2 modos
server/index.js     modo local: listen + loop de cotação
api/index.js        modo Vercel: exporta o app como serverless function
server/db.js        adapter de banco com 2 backends na mesma interface async:
                    node:sqlite (arquivo local) e Turso/libSQL sobre HTTP
  routes/           uma rota por área: auth, sectors, users, config, payroll
  repo/             acesso a dados por tabela
shared/calc.js      cálculo/parsing/formatação — usado pelo servidor (require)
                    E pelo navegador (<script>), pra nunca duplicar a lógica
public/             frontend estático (vanilla JS, sem build): login, setor
                    (gestor), painel (CCO), admin (CCO)
scripts/            seed.js e reset-password.js (CLI; com TURSO_* exportadas,
                    operam direto no banco de produção)
```

Autorização é sempre conferida no servidor: um gestor pedindo dados de outro
setor recebe `404` (não `403`, pra não confirmar que o setor existe). Sessão
nunca guarda papel/setor em cache — cada requisição confere de novo no banco,
então desativar alguém derruba a sessão dela na hora.

## Deploy no Vercel

O projeto já vem pronto para o Vercel: `api/index.js` expõe o Express como
serverless function e o `vercel.json` roteia tudo que não é arquivo estático
para ela. Só falta o banco — 3 passos, uma única vez:

1. **Crie um banco no [Turso](https://turso.tech)** (grátis): entre com GitHub,
   crie um database (escolha uma região próxima, ex.: São Paulo) e gere um
   token de acesso (Database → Tokens → Create Token).
2. **No Vercel** (Project → Settings → Environment Variables), adicione:
   - `TURSO_DATABASE_URL` = a URL do banco (`libsql://...turso.io`)
   - `TURSO_AUTH_TOKEN` = o token gerado
   Depois faça **Redeploy** (Deployments → ⋯ → Redeploy) para as variáveis
   valerem.
3. **Crie a conta CCO no banco de produção**, rodando o seed da sua máquina
   apontado para o Turso (o schema é criado automaticamente):

   ```powershell
   # PowerShell (Windows)
   $env:TURSO_DATABASE_URL = "libsql://SEU-BANCO.turso.io"
   $env:TURSO_AUTH_TOKEN   = "SEU-TOKEN"
   npm run seed
   ```

   Guarde a senha impressa. `npm run reset-password -- <username>` funciona do
   mesmo jeito (com as variáveis exportadas) se precisar redefinir depois.

Enquanto o banco não estiver configurado, o site no Vercel responde
`503 — Banco de dados não configurado` no login, de propósito, para deixar
claro o que falta.

Detalhes que o código já resolve sozinho em produção: cookie de sessão com
`Secure`, `trust proxy` (IP real atrás do proxy do Vercel), rate limit de
login persistido no banco (contador em memória não sobrevive em serverless) e
sincronização da cotação sem processo residente (aplicada quando o painel
busca a cotação).
