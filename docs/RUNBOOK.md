# Runbook operacional

## Env vars — o que é e onde vive

Nenhum secret vai pro git (repo público). Tudo abaixo é configurado em
**Vercel → Project Settings → Environment Variables**, em Production e
Preview. `.env.example` na raiz do repo documenta os placeholders.

| Variável | Uso | Onde gerar/obter |
|---|---|---|
| `DATABASE_URL` | Postgres de produção | Vercel → Storage → adicionar um Postgres |
| `DATABASE_URL_TEST` | Postgres de teste (branch/base separada — os testes fazem DELETE em massa) | idem, banco separado |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Credenciais do app | Partner Dashboard → App → API credentials, após `shopify app config link` |
| `SHOPIFY_APP_URL` | URL pública do deploy | domínio da Vercel |
| `SCOPES` | `read_orders,read_fulfillments,read_checkouts,read_products,read_inventory,read_customers` | fixo, v1 |
| `ENCRYPTION_KEY` | AES-256-GCM dos tokens de loja (32 bytes base64) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — gerar uma vez, colar só na Vercel |
| `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` | Destino padrão do adapter `n8n`, usado quando a loja não tem webhook próprio configurado na tela do app (seção "Webhook n8n") | workflow n8n `Shopify → NexTags` |
| `NEXTAGS_API_BASE` / `NEXTAGS_FLOWS_PATH` | API NexTags | `https://app.nextagsai.com.br` / `/api/accounts/flows` |
| `CRON_SECRET` | Autentica os endpoints `/api/cron/*` (quem chama é o n8n, via Header Auth) | gerar um valor aleatório qualquer |
| `DISPATCH_MODE_DEFAULT` | `n8n` (v1) ou `direct` | fixo, `n8n` |

**Gotcha do Prisma Postgres na Vercel.** A integração "Prisma Postgres"
(Storage tab) cria, além da `DATABASE_URL` (só se ela não existir ainda —
senão prefixa com `prisma_`), duas outras variáveis que **não** servem
pro nosso `db.server.ts` (que faz `new PrismaClient()` puro, sem
Accelerate):

- `..._POSTGRES_URL` — conexão Postgres direta (`postgres://...`). **É essa
  que vai em `DATABASE_URL`/`DATABASE_URL_TEST`.**
- `..._DATABASE_URL` e `..._PRISMA_DATABASE_URL` — URL do Prisma Accelerate
  (`prisma+postgres://accelerate.prisma-data.net/...`). Só funciona com a
  extensão `@prisma/extension-accelerate`, que não usamos.

Se a Vercel gerar essas variáveis com prefixo, copiar o **valor** de
`..._POSTGRES_URL` pra dentro da `DATABASE_URL` (editar a variável
existente, não criar uma segunda com o mesmo nome).

**Gotcha do `functions` no `vercel.json`.** O preset do React Router
(`@vercel/react-router`) não expõe as rotas como Serverless Functions
individuais em `api/`, então qualquer chave em `functions` — mesmo um
glob como `"app/routes/**/*"` — quebra o build com `Error: The pattern
"..." defined in \`functions\` doesn't match any Serverless Functions
inside the \`api\` directory`. Isso já aconteceu duas vezes (Task 15 e a
tentativa de correção). Enquanto não existir a sintaxe certa por rota
pra este preset, `maxDuration` das rotas de cron fica no default da
Vercel (Project Settings → Functions), não no `vercel.json`.

## Como rodar a migração

`vercel-build` já roda `prisma migrate deploy` a cada deploy (antes do
`react-router build`), então isso é automático — nenhum passo manual
depois de configurar `DATABASE_URL`. Pra aplicar manualmente (ex.: fora
da Vercel):

```bash
npx prisma migrate deploy   # com DATABASE_URL de produção no ambiente
```

Local/dev, para criar uma nova migração a partir de mudanças no schema:

```bash
npx prisma migrate dev --name <nome_da_mudanca>
```

### Integração "Prisma Postgres" da Vercel — cuidado com o prefixo

Se a Vercel adicionar um Postgres via a integração **Prisma Postgres**
(Storage tab) e já existir uma variável `DATABASE_URL` no projeto (mesmo
vazia), ela **não sobrescreve** — cria as variáveis com prefixo
(`prisma_DATABASE_URL`, `prisma_POSTGRES_URL`, `prisma_PRISMA_DATABASE_URL`)
pra não colidir. São coisas diferentes:

- `prisma_POSTGRES_URL` — conexão Postgres direta (`postgres://...`).
  **É essa que o `DATABASE_URL`/`DATABASE_URL_TEST` deste projeto precisam**,
  porque `app/db.server.ts` usa `new PrismaClient()` puro, sem a extensão
  Accelerate.
- `prisma_DATABASE_URL` / `prisma_PRISMA_DATABASE_URL` — URL do Prisma
  Accelerate (`prisma+postgres://accelerate.prisma-data.net/...`). Só
  funciona com `@prisma/extension-accelerate`, que este projeto não usa.

Ação: copiar o valor de `prisma_POSTGRES_URL` pra dentro de `DATABASE_URL`
(e `DATABASE_URL_TEST`) manualmente nas Environment Variables.

## Como diagnosticar um disparo que não chegou

1. Abrir a tela embedded do app (bloco **Status**) e localizar o evento pela loja/pedido.
2. Se não aparecer ali, consultar `event_log` direto no Postgres:
   ```sql
   select id, topic, event, dispatch_status, nextags_response, attempts, next_attempt_at
   from event_log
   where shop_domain = '<loja>.myshopify.com'
   order by created_at desc
   limit 20;
   ```
3. `dispatch_status`:
   - `ok` — NexTags respondeu `200`/`success:true`. **Isso não prova entrega** — confirmar no WhatsApp do destinatário.
   - `retrying` — vai ser reprocessado por `/api/cron/retry-dispatch` (agendado no n8n a cada 5 min) até `next_attempt_at`.
   - `failed` — esgotou o backoff (`BACKOFF_MS = [30s, 5min, 30min]`). Ação manual: corrigir a causa (token revogado, `flow_id` errado, CUF vazio) e reenviar via **Teste de disparo** na UI.
   - `skipped` — loja desabilitada, sem token, sem telefone válido, ou topic sem disparo em v1 (catálogo). O motivo vai em `nextags_response`.
4. `success:true` do NexTags também acontece para `flow_id` inexistente — por isso o `event_log` é a única fonte de auditoria confiável, não a resposta da API.

## Como trocar uma loja para `dispatch_mode=direct`

`direct` chama a API NexTags sem passar pelo n8n (elimina o hop e o
`X-ACCESS-TOKEN` do cliente não viaja no payload app→n8n). Migração é por
loja, sem reescrita de código — o dispatcher já implementa os dois modos.

```sql
update store_config set dispatch_mode = 'direct' where shop_domain = '<loja>.myshopify.com';
```

Confirmar com um disparo de teste na UI depois da troca.

## O que fazer se o n8n cair

- O handler de webhook já respondeu `200` pra Shopify antes de tentar o
  dispatch (o teto de 5s é do handler, não do disparo em si) — nenhum evento
  é perdido, mas fica com `dispatch_status='retrying'` ou `'failed'` até o
  n8n voltar.
- Assim que o n8n voltar, `/api/cron/retry-dispatch` (a cada 5 min) reprocessa
  sozinho as linhas `retrying` que já venceram o backoff.
- Para forçar um reprocessamento imediato sem esperar o cron do n8n:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/retry-dispatch
  ```
- Linhas que já foram para `failed` **não** entram automaticamente no retry
  (esgotaram o backoff). Resolver a causa raiz e reenviar manualmente pela UI.
- Escape hatch: trocar a loja pra `dispatch_mode=direct` (acima) tira o n8n
  do caminho inteiramente.

## Como rotacionar a `ENCRYPTION_KEY`

Trocar a chave sem re-cifrar invalida todos os tokens NexTags já salvos
(`decrypt` passa a falhar). Procedimento:

1. Gerar a nova chave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Rodar um script one-off, com **as duas chaves disponíveis**, que para cada
   `store_config.nextags_token_enc`: descifra com a chave antiga e recifra
   com a nova (usar as funções de `app/lib/crypto.server.ts`, apontando
   `ENCRYPTION_KEY` pra chave antiga na leitura e pra nova na escrita).
3. Só depois de confirmar que todas as linhas foram recifradas, atualizar
   `ENCRYPTION_KEY` na Vercel para a nova chave e redeployar.
4. Se um secret vazar no git por engano: a rotação da chave é obrigatória
   (o histórico do repo público é permanente — reverter o commit não apaga
   o segredo já exposto).

## Matriz de eventos validados em E2E

Preencher durante a Task 17 / Step 7 (E2E na dev store), com data, `flow_id`
usado e confirmação de recebimento **no WhatsApp** (não só a resposta HTTP):

| Evento | Validado em | `flow_id` | Confirmado no WhatsApp? |
|---|---|---|---|
| `order_paid` | _pendente_ | | |
| `order_fulfilled` | _pendente_ | | |
| `ready_pickup` | _pendente_ | | |
| `order_delivered` | _pendente_ | | |
| `order_cancelled` | _pendente_ | | |
| `abandoned_cart` | _pendente_ | | |

## Pendências desta task (dependem de acesso humano)

Os passos abaixo do plano de implementação (`docs/superpowers/plans/2026-08-27-shopify-app-nextags.md`,
Task 17) exigem credenciais/contas que só o time NexTags tem:

- **Step 1** — criar/linkar o app no Partner Dashboard (`shopify app config link`) e obter `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`.
- **Step 2** — configurar as env vars acima na Vercel (Production e Preview).
- **Step 3** — `npx vercel --prod` + `npx prisma migrate deploy` com a `DATABASE_URL` real + `shopify app deploy`.
- **Step 4** — montar o workflow n8n multi-tenant `Shopify → NexTags`.
- **Step 5/6** — instalar na dev store, colar a chave da conta **NexTags Ajuda**, verificar registro dos webhooks.
- **Step 7/8/9** — E2E real com confirmação no WhatsApp, teste de carrinho abandonado, teste de desinstalação.

Todo o código, testes e configuração declarativa (schema, `shopify.app.toml`,
rotas, `vercel.json`) já estão prontos para esses passos — ver
`docs/superpowers/plans/2026-08-27-shopify-app-nextags.md` para o passo a
passo detalhado de cada um.
