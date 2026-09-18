# integrador_shopify_nextags

App Shopify que dispara notificações transacionais no WhatsApp via
[NexTags](https://nextags.com.br) — pedido pago, enviado, pronto para retirada,
entregue, cancelado e carrinho abandonado — sem nenhum setup manual em n8n por
lojista.

O lojista instala o app, cola a chave de API da conta NexTags dele, escolhe um
flow por evento e está pronto. Os campos personalizados (CUFs) usados nos
textos do flow são criados automaticamente na conta dele.

## Stack

React Router 7 (SSR) · Polaris web components + App Bridge · Prisma · Postgres

Dois deploys rodam este mesmo código, com `client_id` e distribuição
diferentes:

| deploy | app Shopify | config | onde |
|---|---|---|---|
| Custom App | `Nextags_custom` | `shopify.app.toml` | Vercel |
| App Store | `nextagsai` | `shopify.app.nextagsai.toml` | VPS, sob `/notificacoes` |

`SHOPIFY_APP_DISTRIBUTION` decide qual dos dois o processo serve.

## Rodando local

```shell
cp .env.example .env   # preencher: ver comentários do próprio arquivo
npm ci
npx prisma migrate deploy
npm run dev            # shopify app dev
```

Testes precisam de um Postgres separado em `DATABASE_URL_TEST` — eles truncam
tabelas entre os casos:

```shell
npm test
npm run typecheck
npm run lint
```

## Deploy

- **Vercel** (Custom App): push na branch. `vercel-build` roda `prisma
  generate && prisma migrate deploy && react-router build`.
- **VPS** (App Store): `docker compose up -d --build`. O passo a passo,
  incluindo o bloco do nginx e a tabela de propagação das variáveis, está em
  [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

O app roda sob subpath na VPS (`APP_BASE_PATH=notificacoes`) porque o domínio
já serve outra aplicação na raiz. O prefixo é compilado no bundle do cliente,
então é **build arg**, não variável de container.

## Documentação

| arquivo | o que tem |
|---|---|
| [`AGENTS.md`](AGENTS.md) | regras não negociáveis do código — leia antes de mexer |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | deploy, operação, incidentes, crons |
| [`docs/APP_STORE.md`](docs/APP_STORE.md) | estado da submissão à App Store |
| [`docs/LISTING.md`](docs/LISTING.md) | textos da listagem |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | política de privacidade (espelhada em `/privacy`) |

## Segurança

Repositório público: **nenhum secret no git, nunca.** Fixtures usam dados
sintéticos — jamais telefone ou token real. O token NexTags de cada loja fica
cifrado em AES-256-GCM no banco e é redigido dentro de `event_log.canonical`.

## Licença

[MIT](LICENSE.md)
