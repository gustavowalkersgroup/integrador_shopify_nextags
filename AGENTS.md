# integrador_shopify_nextags

App publico Shopify que dispara notificacoes transacionais NexTags
(pedido pago, enviado, pronto p/ retirada, entregue, cancelado,
carrinho abandonado) sem setup manual em n8n.

Stack: React Router 7 + Polaris web components + App Bridge, Prisma,
Postgres, deploy na Vercel.

## Antes de mexer no codigo

Leia, nesta ordem:

1. `docs/superpowers/specs/2026-08-27-shopify-app-nextags-design.md` — decisoes travadas e por que
2. `docs/superpowers/plans/2026-08-27-shopify-app-nextags.md` — plano de implementacao, 18 tasks com TDD

## Regras que nao sao negociaveis

- Repo publico: nenhum secret no git, nunca. Só env var na Vercel.
  Fixtures usam dados sinteticos, nunca telefone ou token real.
- Handler de webhook responde em menos de 5s (limite Shopify).
  Nada de trabalho depois do return: serverless encerra o processo.
- `set_field_value` sempre antes de `send_flow` no mesmo `actions[]`,
  senao os CUFs chegam vazios no NexTags.
- Token NexTags e por conta do cliente, nunca conta-mae.
- `success:true` do NexTags nao prova entrega. Todo disparo grava
  em `event_log`.
- Telefone BR: fixo de 8 digitos NUNCA ganha o nono digito.
