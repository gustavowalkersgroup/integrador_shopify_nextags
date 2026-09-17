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

## Duas apps Shopify, um repo só

Esse código serve **duas** apps registradas no Partner Dashboard, cada
uma com seu próprio `client_id` e seu próprio deploy na Vercel — nunca
misturar credenciais das duas no mesmo projeto Vercel/`shopify.app*.toml`:

| App no Partner Dashboard | Distribution | `shopify.app*.toml` | Deploy Vercel | Uso |
|---|---|---|---|---|
| `Nextags_custom` | Custom App (`SingleMerchant`) | `shopify.app.toml` (o default do repo) | projeto Vercel atual (`integrador-shopify-nextags`) | loja de teste/dev, sem gate de Protected Customer Data |
| `nextagsai` | Public (`AppStore`) | `shopify.app.nextagsai.toml` (criar com `shopify app config link`, escolhendo "Link to a different app") | projeto Vercel **separado** | listagem pública (Task 18) |

O que muda entre os dois: `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`
(credenciais de cada app), `SHOPIFY_APP_URL` (domínio de cada deploy) e
`SHOPIFY_APP_DISTRIBUTION` (`single_merchant` ou `app_store` —
`app/shopify.server.ts` lê essa env var pra decidir o `distribution` do
SDK). Todo o resto (banco, `NEXTAGS_API_BASE`, etc.) pode ser
compartilhado ou não, dependendo se as duas apps atendem a mesma base de
lojas ou não.

Pra criar o segundo deploy: novo projeto na Vercel apontando pro mesmo
repo/branch, `shopify app config link` local escolhendo "Link to a
different app" (gera `shopify.app.nextagsai.toml` com o `client_id` real
do `nextagsai`), copiar as credenciais geradas pras env vars desse novo
projeto Vercel, e rodar `shopify app deploy --config nextagsai` a partir
daí em diante (nunca `shopify app deploy` sem `--config` depois de ter
mais de um toml, senão o CLI pergunta qual usar ou pode aplicar no
errado).

**Gotcha do `functions` no `vercel.json`.** O preset do React Router
(`@vercel/react-router`) não expõe as rotas como Serverless Functions
individuais em `api/`, então qualquer chave em `functions` — mesmo um
glob como `"app/routes/**/*"` — quebra o build com `Error: The pattern
"..." defined in \`functions\` doesn't match any Serverless Functions
inside the \`api\` directory`. Isso já aconteceu duas vezes (Task 15 e a
tentativa de correção). Enquanto não existir a sintaxe certa por rota
pra este preset, `maxDuration` das rotas de cron fica no default da
Vercel (Project Settings → Functions), não no `vercel.json`.

## Plano B: Custom Distribution (instalar nas 50+ lojas sem esperar a listagem pública)

O banco já é multi-tenant desde a Task 2 — toda tabela é indexada por
`shopDomain`, então o mesmo código atende qualquer número de lojas sem
mudança nenhuma. O que trava escalar pras lojas dos clientes não é o
código, é a **distribuição** no lado Shopify: App Store pública exige a
revisão completa de listagem (design/UX/conteúdo), que é lenta e
independente da aprovação de Protected Customer Data.

**Custom Distribution** é o caminho pra pular só a revisão de listagem,
mantendo o mesmo app registrado (`nextagsai`) e o mesmo deploy:

- No Partner Dashboard, no app, em **App setup → Distribution**, trocar
  de "Public distribution" pra **"Custom distribution"**.
- A Shopify gera um **link de instalação único** pro app.
- Esse link é enviado direto pra cada uma das lojas dos clientes (ou
  usado por quem tiver acesso admin delas) — cada instalação passa pelo
  OAuth normal, igual uma instalação vinda da App Store.
- **Não elimina a aprovação de Protected Customer Data.** O escopo
  `read_customers` (nome/telefone do cliente) exige essa aprovação
  independente de como o app é distribuído — sem ela, `customer.phone`
  chega vazio em qualquer uma das 50 lojas. Ver checklist da Task 18 em
  `docs/APP_STORE.md`.
- O que o Custom Distribution elimina: screenshots/descrição revisados,
  categoria aprovada, avaliação de design/UX da equipe de review da
  Shopify — só a parte de "aparecer listado na busca pública".
- Zero mudança em `shopify.app*.toml`, env vars ou código — é
  configuração feita direto no Partner Dashboard, no mesmo app
  `nextagsai` já registrado.
- Transição de volta pra distribuição pública (Task 18 completa), pra
  pegar lojas futuras que não estão na lista de clientes conhecidos: dá
  pra trocar de volta no mesmo app pela mesma tela de Distribution — os
  detalhes exatos dessa transição (se reabre revisão do zero ou só muda
  a config) precisam ser confirmados na hora, na própria tela do Partner
  Dashboard.

## Deploy em VPS (Docker, sob subpath)

A Vercel continua funcionando sem mudança — os dois alvos convivem. O que os
separa é `react-router.config.ts`, que só aplica o `vercelPreset()` quando
`process.env.VERCEL` existe (a Vercel injeta essa variável sozinha em todo
build dela). Com o preset, a saída são funções serverless em
`build/server/nodejs_<hash>/`; sem ele, é o servidor Node em
`build/server/index.js`, que é o que `npm start` e o `Dockerfile` esperam.

**O app divide o domínio com outra aplicação.** `integrador.nextags.com.br`
serve uma SPA na raiz; o app Shopify vive sob `/notificacoes`, atrás do nginx
que já roda na VPS. Por isso o compose não tem Caddy e publica a porta só em
`127.0.0.1`.

### Por que o prefixo não pode ser "shopify"

A Shopify recusa URLs de listagem que contenham a palavra "shopify" —
inclusive no path, não só no domínio. `…/shopify/privacy` é rejeitado no campo
Privacy policy URL com "URL can't contain 'Shopify'". Daí `/notificacoes`.

### Passo a passo

1. `cp .env.example .env` e preencher. Além das vars de sempre: `APP_DOMAIN`,
   `APP_BASE_PATH` (sem barras, ex.: `notificacoes`), `APP_PORT` e, se for usar
   o Postgres do compose, `POSTGRES_PASSWORD`.
2. `docker compose up -d --build`. O container roda `prisma migrate deploy` no
   boot, então o schema sobe sozinho.
3. Adicionar o bloco de proxy abaixo ao server block do nginx que já atende
   `integrador.nextags.com.br`, e recarregar (`nginx -t && nginx -s reload`).
4. No Dev Dashboard do app, apontar `application_url` para
   `https://integrador.nextags.com.br/notificacoes` e o redirect URL para
   `https://integrador.nextags.com.br/notificacoes/auth/callback`. O mesmo em
   `shopify.app*.toml` (inclusive o `uri` dos webhooks), e `shopify app deploy`.
5. Reapontar os agendamentos do n8n para
   `https://integrador.nextags.com.br/notificacoes/api/cron/*`. Eles não mudam
   em nada além da URL: quem agenda sempre foi o n8n, via
   `Authorization: Bearer $CRON_SECRET`, nunca a Vercel.

### Bloco do nginx

```nginx
location /notificacoes/ {
    # SEM barra no fim do proxy_pass. Esta é a linha que faz o subpath
    # funcionar: assim o nginx repassa o path COMPLETO (/notificacoes/app
    # chega como /notificacoes/app). Com barra — `http://127.0.0.1:3000/` —
    # o nginx removeria o prefixo, e aí duas coisas quebram de uma vez:
    # o basename do React Router não casa mais (404 em tudo), e a lib da
    # Shopify monta a volta do bounce como `appUrl + url.pathname`, que
    # cairia na raiz do domínio, ou seja, na outra aplicação.
    proxy_pass http://127.0.0.1:3000;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # O webhook da Shopify é validado por HMAC sobre o corpo cru: nada de
    # buffer ou reescrita de corpo neste location.
    proxy_request_buffering off;
}
```

### Como o prefixo se propaga

`APP_BASE_PATH` é lido em dois lugares, e precisa existir **em build time**
porque o basename é compilado no bundle do cliente:

| onde | efeito |
|---|---|
| `react-router.config.ts` | `basename` — todas as rotas passam a viver sob o prefixo |
| `app/shopify.server.ts` | `authPathPrefix` — as URLs de OAuth ganham o prefixo |
| `app/routes/_index/route.tsx` | o redirect para `/app` ganha o prefixo |
| `Dockerfile` (ARG) | entra no build; trocar exige `up -d --build`, não basta reiniciar |

`SHOPIFY_APP_URL` fica **sem** o path (`https://integrador.nextags.com.br`):
a lib descarta o path de qualquer forma — `shopify-app.js` faz
`appConfig.appUrl = appUrl.origin` — e o prefixo entra pelo `authPathPrefix`.

### Verificado localmente

Com `APP_BASE_PATH=notificacoes`, servidor Node em pé:

| rota | esperado |
|---|---|
| `/privacy` (raiz) | 404 — não colide com a SPA |
| `/notificacoes/` | 200 |
| `/notificacoes/privacy` | 200 |
| `/notificacoes/healthz` | 200, ou 503 se o Postgres estiver fora |
| `/notificacoes/auth/login?shop=…` | 302 para `admin.shopify.com/store/…/oauth/install` |

`HEALTHCHECK` do container bate em `/<base>/healthz`, que toca o Postgres. Um
processo vivo mas sem banco não consegue gravar `event_log`, e aceitar webhook
nesse estado significa perder pedido — por isso o healthcheck falha (503) e o
Docker reinicia, em vez de deixar a instância engolir tráfego.

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
   `ENCRYPTION_KEY` no host (Vercel ou `.env` da VPS) e redeployar.
   Se pular o passo 2, o efeito aparece assim: todo webhook da loja passa a
   gravar uma linha `failed` em `event_log` com "excecao antes do dispatch",
   e o cron de retry fecha as linhas antigas com "retry excecao". Nenhum
   pedido some em silêncio — mas nenhum é entregue até recifrar.
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
