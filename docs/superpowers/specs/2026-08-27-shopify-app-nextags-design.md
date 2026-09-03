# Design — App público Shopify NexTags (v1)

**Data:** 2026-08-27
**Status:** aprovado (brainstorming)
**Repo:** `gustavowalkersgroup/integrador_shopify_nextags`

---

## 1. Objetivo

App oficial NexTags publicado na Shopify App Store. Lojista instala pela loja de apps, conecta a conta NexTags, e os disparos transacionais (pedido pago / enviado / entregue / pronto p/ retirada / cancelado / carrinho abandonado) passam a funcionar sem setup manual em n8n.

Substitui o processo atual: hoje cada cliente Shopify exige credencial + workflow n8n criados à mão (101 clientes, 159 workflows transacionais, dos quais 72 não são nem legíveis via MCP).

### Não-objetivos

- Backend de atendimento sob demanda (MCP) — território da skill `nextags-mcp-builder`.
- Migrar as lojas Shopify já rodando em n8n (convivem; migração é posterior).
- Suporte a Tray / Nuvemshop / Bagy neste app (já atendidos pelo integrador existente).
- Cobrança (Billing API).

---

## 2. Decisões travadas

| # | Decisão | Escolha |
|---|---|---|
| 1 | Produto | App NexTags oficial (não conector genérico) |
| 2 | Runtime do disparo | n8n executa; app provisiona e normaliza |
| 3 | Monetização | Grátis, sem Billing API, só clientes NexTags |
| 4 | Vínculo loja↔NexTags | Lojista cola `X-ACCESS-TOKEN` da conta dele |
| 5 | Escopo de eventos | Máximo: transacional + pós-venda + catálogo + obrigatórios |
| 6 | Stack | Remix + Polaris + App Bridge, Vercel Pro, Postgres (Neon) |
| 7 | Provisionamento | App grava config; n8n multi-tenant (sem clonar workflow por cliente) |
| 8 | Auth do `send_flow` | Token **por conta do cliente**, não conta-mãe (ver abaixo) |
| 9 | Acoplamento | Standalone — zero dependência do integrador atual |
| 10 | Config de flows | App lista flows via API NexTags → dropdown (fallback: input manual + teste) |

### Correção relevante

`send_flow` **não** pode sair de uma conta-mãe NexTags. O disparo é `POST /api/contacts` com header `X-ACCESS-TOKEN` **da conta do cliente**. Evidência: incidente de produção auditado — um workflow clonado manteve o token de **outra conta**, e o disparo retornou `success:true` produzindo um **no-op silencioso na conta errada**. Logo o token é por loja. [Certeza]

---

## 3. Arquitetura

```
Lojista → Shopify App Store → instala
   │
   ├─ OAuth (app na Vercel) → grava shop + access_token cifrado
   ├─ Registra webhooks Shopify → /webhooks/shopify
   └─ Tela embedded: cola X-ACCESS-TOKEN NexTags → app lista flows → mapeia evento→flow

Shopify evento → POST /webhooks/shopify
   ├─ verifica HMAC (X-Shopify-Hmac-Sha256)
   ├─ dedup (X-Shopify-Webhook-Id + order_id|status)
   ├─ normaliza (telefone BR, nome/sobrenome, order_id vs order_number, itens)
   ├─ responde 200 em <5s  (limite Shopify)
   └─ dispatcher → n8n (1 workflow multi-tenant) → POST /api/contacts
                                                   actions: set_field_value… → send_flow

Cron (Vercel, ~15min) → carrinho abandonado (Shopify não tem webhook nativo)
   └─ GraphQL abandonedCheckouts → guard idade 1–48h + não-convertido + dedup → dispatcher
```

### Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Remix app (Vercel)** | OAuth, sessão, UI embedded, receptores de webhook, cron, endpoints GDPR | Shopify Admin API, Postgres |
| **Postgres (Neon)** | sessions, stores, store_config, dedup, event_log, flows_cache | — |
| **Dispatcher** | Interface única com 2 adapters: `n8n` (default v1) e `direct` (chama NexTags sem hop). Flag global + override por loja | n8n ou API NexTags |
| **n8n** | **1** workflow multi-tenant `Shopify → NexTags`: recebe evento canônico, monta `actions[]`, dispara `send_flow` | API NexTags |

### Por que o dispatcher tem dois modos

Com o app fazendo HMAC, dedup, normalização e config, a única responsabilidade restante do n8n é um POST com `actions[]`. O hop custa latência e faz o `X-ACCESS-TOKEN` do cliente **viajar no payload** app→n8n (mitigado por TLS + header secret).

v1 sai em `n8n` — respeita o modelo atual e permite o time editar visualmente. `direct` fica implementado atrás de flag, migrável por loja, sem reescrita.

---

## 4. Modelo de dados

```
stores          shop_domain PK, access_token (cifrado), scopes, api_version,
                installed_at, uninstalled_at

store_config    shop_domain FK, nextags_token (cifrado), agent_id,
                flow_map   jsonb { order_paid, order_fulfilled, order_delivered,
                                   ready_pickup, order_cancelled, abandoned_cart },
                cuf_map    jsonb,
                dispatch_mode ('n8n' | 'direct'),
                enabled bool

event_dedup     shop_domain, dedup_key UNIQUE, first_seen_at
                -- 3 famílias de chave:
                --   webhook_id            → replay do mesmo webhook
                --   order_id|status       → mudança de estado do pedido
                --   cart:{checkout_id}    → carrinho

event_log       id, shop_domain, topic, shopify_id, payload_hash,
                dispatch_status ('ok'|'retrying'|'failed'|'skipped'),
                nextags_response, attempts, created_at

flows_cache     shop_domain, flow_id, flow_name, fetched_at
```

`event_log` é obrigatório porque `/send/{flow_id}` retorna `success:true` **até para `flow_id` inexistente** — é a única forma de auditar entrega depois. [Certeza]

Chave de dedup usa `order_id` **interno** da Shopify, nunca `order_number` (pode repetir). CUF de exibição usa `order.name` sem o `#`.

---

## 5. Eventos

| Shopify topic | Evento canônico | Destino |
|---|---|---|
| `orders/paid` | `order_paid` | flow pago |
| `orders/fulfilled` | `order_fulfilled` | flow enviado |
| `orders/fulfilled` / `fulfillments/create` com método de entrega **pickup** | `ready_pickup` | flow pronto p/ retirada |
| `fulfillments/update` (status `delivered`) | `order_delivered` | flow entregue |
| `orders/cancelled` | `order_cancelled` | flow cancelado |
| `refunds/create` | `order_refunded` | `flow_map.order_cancelled` (compartilhado em v1) |
| `orders/updated` | — | só `event_log` |
| cron `abandonedCheckouts` | `abandoned_cart` | flow carrinho |
| `products/create|update|delete` | — | só `event_log` (v1) |
| `inventory_levels/update` | — | só `event_log` (v1) |
| `app/uninstalled` | interno | marca `uninstalled_at`, para cron |
| `customers/data_request` | GDPR | obrigatório |
| `customers/redact` | GDPR | obrigatório |
| `shop/redact` | GDPR | obrigatório |

**Catálogo:** registrado e logado em v1, **sem consumidor**. O consumo é do MCP (`nextags-mcp-builder`) → v2. Popular cache sem leitor é peso morto.

**Contrato canônico app→n8n** (versionado):

```json
{
  "schema": 1,
  "event": "order_paid",
  "shop": "loja.myshopify.com",
  "customer": { "first_name": "...", "last_name": "...", "phone": "55DD9XXXXXXXX" },
  "order":    { "id": "...", "number": "1234", "total": "199.90",
                "items": "Produto (Qtd: 2, R$ 99,95)", "tracking": null, "tracking_url": null },
  "nextags":  { "token": "...", "flow_id": "...", "cuf": {} }
}
```

**Discriminação de `ready_pickup` vs `order_fulfilled`:** o mesmo topic serve os dois. Regra: se o fulfillment tem método de entrega local pickup (`delivery_method.method_type` = `pick_up` / status de pickup ready), o evento canônico é `ready_pickup`; caso contrário `order_fulfilled`. Loja sem `flow_map.ready_pickup` configurado cai em `order_fulfilled`. Nome exato do campo a confirmar na versão fixada da API. [Provável]

**Desvio consciente do padrão auditado:** a regra "Switch por `status.alias`, nunca por `body.event`" existe porque payload de plataforma é instável. Aqui o contrato é **do app** e versionado (`schema`), então o n8n faz Switch por `event`. Justificado.

---

## 6. Tela embedded (Remix + Polaris + App Bridge)

Uma página, quatro blocos:

1. **Conexão NexTags** — input do token, com texto de ajuda literal:

   > Para pegar a chave na NexTags: Configurações → Integrações → Chave de API do NexTags AI. Gere a chave caso ainda não tenha, copie o valor e cole aqui.

   Ao salvar, valida chamando a API NexTags. Token inválido falha na hora, não silenciosamente.

2. **Mapeamento de flows** — um dropdown por evento, populado por `flows_cache`. Se a API NexTags não listar flows, degrada para input manual com aviso de risco.

3. **Teste de disparo** — evento + telefone de teste → dispara → mostra o registro do `event_log`. Existe porque `success:true` não prova entrega; a confirmação é no WhatsApp.

4. **Status** — webhooks registrados (✓/✗ por topic), últimos 20 eventos com resultado, toggle master.

Polaris não é preferência estética: é o que a review de design da Shopify espera.

---

## 7. Resiliência

| Regra | Implementação |
|---|---|
| Timeout Shopify 5s | handler: HMAC → dedup → dispatch → 200. Nenhum trabalho pós-response (serverless encerra o processo) |
| Retry | 3 tentativas, backoff 5s / 25s / 125s; falha final → `event_log.dispatch_status='failed'` |
| Rate limit (429) | detecta e re-agenda; cron com `batchSize 1` + ~500ms entre itens |
| Telefone BR | normaliza **antes** de enviar — NexTags adiciona `9` cego em fixo e corrompe o ID do contato (fixo `551933334444` → `5519933334444`) |
| Campos nulos | `verificarDado(v, 'Não informado')` — NexTags rejeita `null`/`undefined` |
| CUF | valida tipo TEXTO; CUF tipo NÚMERO descarta valor **sem erro** |
| Template WhatsApp | recusa disparo se qualquer CUF interpolado estiver vazio (erro `#131008` derruba o template inteiro) |
| Ordem das actions | `set_field_value` **sempre antes** de `send_flow` no mesmo array, senão os CUFs chegam vazios |
| Carrinho | guards: idade 1–48h + não convertido em pedido + dedup |

---

## 8. Gates da Shopify App Store (bloqueantes)

| Gate | Exigência |
|---|---|
| **Protected Customer Data** | Aprovação explícita para ler telefone/email/endereço, com justificativa de uso, política de retenção e criptografia em repouso. Sem isso os campos chegam vazios e o app não funciona. **Caminho crítico — pedir primeiro.** [Certeza] |
| Webhooks GDPR | 3 endpoints obrigatórios, funcionais; a review testa |
| `app/uninstalled` | tratar desinstalação |
| API version | fixar versão dentro da janela de suporte Shopify |
| Embedded + App Bridge | rodar dentro do admin, sessão via session token |
| Conta externa | app grátis exigindo conta NexTags é permitido, mas a review pede **credenciais de teste funcionais** → precisa conta NexTags demo com flows reais |
| `read_all_orders` | necessário só para pedidos >60 dias. **v1 não solicita** |
| Listing | ícone, screenshots, política de privacidade pública, canal de suporte |
| Uptime | Vercel Pro; monitorar |

**Scopes v1:** `read_orders`, `read_fulfillments`, `read_checkouts`, `read_products`, `read_inventory`, `read_customers`.

---

## 9. Testes

- **Unit:** normalizador de telefone (fixo/celular por DDD, casos que corromperam contato), `order_id` vs `order_number`, mapeamento topic→evento, verificação HMAC (válido / payload alterado / header ausente), montagem de `actions[]` com ordem correta.
- **Integração:** dedup (mesmo `webhook_id` 3×; mesma ordem com status diferente), dispatcher nos dois modos, retry e 429, recusa por CUF vazio.
- **E2E em dev store:** instalar → OAuth → configurar → pedido de teste → confirmar mensagem **no WhatsApp** (não na resposta da API).
- **Fixtures:** payloads reais dos topics em JSON versionado.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Protected Customer Data reprovado ou demorado | solicitar **antes** de construir a UI; é o caminho crítico |
| Chamada de listagem de flows falha em runtime | degrada para input manual + teste de disparo obrigatório |
| Repo público (decidido) | secrets só em env var da Vercel; `.env` no `.gitignore`; fixtures sintéticas; secret vazado exige **rotação da chave**, não revert |
| Cron Vercel Hobby = 1×/dia | Pro resolve; carrinho precisa ~15min |
| REST `checkouts.json` deprecado | usar GraphQL `abandonedCheckouts`; confirmar na versão fixada [Provável] |
| n8n indisponível | `event_log` + retry; `direct` como escape hatch |
| Token NexTags no payload app→n8n | TLS + header secret; `direct` elimina |

---

## 11. Questões — status

| # | Questão | Status |
|---|---|---|
| 1 | API NexTags lista flows? | **Resolvida: sim.** Dropdown é o caminho principal; input manual fica como degradação se a chamada falhar em runtime |
| 2 | Conta demo para a review Shopify | **Resolvida:** conta **NexTags Ajuda**. Precisa ter flows reais mapeados antes de submeter |
| 3 | URL do webhook n8n que recebe o evento canônico | **Aberta.** Fica em env var `N8N_WEBHOOK_URL` + `N8N_WEBHOOK_SECRET`; definir antes do primeiro deploy. Não bloqueia o desenvolvimento (dispatcher testável em `direct` e com mock) |
| 4 | Repo privado ou público | **Resolvida: público.** Consequências abaixo |

### Consequências de repo público

- Nenhum secret no git, em nenhuma circunstância: `SHOPIFY_API_SECRET`, `N8N_WEBHOOK_SECRET`, `DATABASE_URL`, chave de criptografia — **só** env var na Vercel.
- `.env` e variantes no `.gitignore`; apenas `.env.example` com placeholders.
- Nenhum token de cliente, `flow_id` real, telefone ou nome de contato em fixture, teste ou log comitado. Fixtures usam dados sintéticos.
- Histórico de git é permanente: secret comitado por engano exige **rotação da chave**, não só um revert.
- Incidentes de produção citados aqui são anonimizados: nenhum nome de cliente, ID de conta ou `flow_id` real aparece neste repositório.
