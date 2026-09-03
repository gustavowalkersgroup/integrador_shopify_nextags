# App público Shopify NexTags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App público na Shopify App Store que, ao ser instalado, dispara notificações transacionais NexTags (pago, enviado, pronto p/ retirada, entregue, cancelado, carrinho abandonado) sem nenhum setup manual em n8n.

**Architecture:** React Router 7 + Polaris web components + App Bridge na Vercel. O app recebe webhooks Shopify, valida HMAC, deduplica, normaliza para um payload canônico versionado e entrega via dispatcher (adapter `n8n` por padrão, `direct` atrás de flag). Postgres (Neon) guarda config por loja, dedup e log de eventos. Carrinho abandonado vem de cron (Shopify não tem webhook nativo).

**Tech Stack:** Node 20+, React Router 7, `@shopify/shopify-app-react-router`, Polaris web components (`@shopify/polaris-types`), Prisma, PostgreSQL, Vitest, Vercel (Pro).

**Spec:** [`docs/superpowers/specs/2026-08-27-shopify-app-nextags-design.md`](../specs/2026-08-27-shopify-app-nextags-design.md)

## Global Constraints

Valem para **todas** as tasks. Não repetidas em cada uma.

- **Node 20+.** Runtime da Vercel fixado em `nodejs20.x`.
- **Repo é público.** Nenhum secret no git — nunca. Só env var na Vercel. `.env` e variantes no `.gitignore`; apenas `.env.example` com placeholders. Nenhum token de cliente, `flow_id` real, telefone ou nome de contato em fixture, teste ou log comitado. **Fixtures usam dados sintéticos.** Secret comitado por engano exige rotação da chave, não revert.
- **Handler de webhook responde em <5s** (limite Shopify). Nenhum trabalho pós-response: serverless encerra o processo depois do `return`.
- **`set_field_value` sempre antes de `send_flow`** no mesmo array `actions[]`. Fora dessa ordem os CUFs chegam vazios.
- **CUF é sempre tipo TEXTO** no NexTags. CUF tipo NÚMERO descarta o valor silenciosamente, sem erro. **Não é verificável por código** — a API não expõe o tipo do CUF. Fica como checagem manual no onboarding de cada loja e no runbook; o teste de disparo da UI é o que revela o descarte.
- **Nunca disparar com CUF interpolado vazio** — erro WhatsApp `#131008` derruba o template inteiro.
- **Telefone BR normalizado antes de enviar.** NexTags adiciona `9` cego em telefone fixo e corrompe o ID do contato (`551933334444` → `5519933334444`).
- **`order_id` interno é a chave de dedup**, nunca `order_number` (pode repetir). `order_number` só para exibição, sem o `#`.
- **`success:true` do NexTags não prova entrega.** `/send/{flow_id}` responde `success:true` até para `flow_id` inexistente. Todo disparo grava em `event_log`.
- **Token NexTags nunca em plaintext no banco** (cifrado AES-256-GCM) e **nunca dentro de `event_log.canonical`** (redigido antes de gravar).
- **Scopes v1:** `read_orders`, `read_fulfillments`, `read_checkouts`, `read_products`, `read_inventory`, `read_customers`. Não pedir `read_all_orders`.
- **UI só com Polaris web components + App Bridge** (`<s-page>`, `<s-section>`, `<s-button>`, `<s-text-field>`). Polaris React foi descontinuado; o `AppProvider` do `@shopify/shopify-app-react-router` carrega o script, e os tipos vêm de `@shopify/polaris-types` (já no `tsconfig.types`).
- **Commits em português**, prefixo Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Desvio consciente do spec (retry)

O spec previa backoff inline 5s / 25s / 125s. Impossível dentro do limite de 5s da Shopify em ambiente serverless. Implementação real:

1. Handler faz **1 tentativa inline** com timeout de 2s.
2. Falha → `event_log.dispatch_status='retrying'` + `next_attempt_at = now + backoff(attempts)` (30s, 5min, 30min).
3. Cron `/api/cron/retry-dispatch` a cada 5 min processa as linhas vencidas.
4. Esgotadas as tentativas → `dispatch_status='failed'`.

Garantia de entrega equivalente, sem violar o limite de resposta.

## Pré-requisitos (humanos, fora das tasks)

Nenhuma task depende de 1–3 para começar; a Task 17 depende de todos.

1. **Conta Shopify Partner** ativa.
2. **Protected Customer Data:** solicitar aprovação de nível "Approved" para telefone/email/endereço no Partner Dashboard, com justificativa (notificação transacional pedida pelo lojista), política de retenção e menção à criptografia em repouso. **É o caminho crítico** — sem isso os campos chegam vazios. Solicitar já.
3. **Conta NexTags Ajuda** com flows reais mapeados para os 6 eventos (a review Shopify exige credenciais de teste funcionais).
4. **Neon:** projeto + 2 branches (`main`, `test`) → `DATABASE_URL`, `DATABASE_URL_TEST`.
5. **Vercel Pro** + projeto conectado ao repo.
6. **URL/secret do webhook n8n** (`N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`) — questão aberta nº 3 do spec; necessária só na Task 17.

---

## Task 1: Scaffold do projeto e trilhos de teste

**Files:**
- Create: raiz do projeto (template React Router 7 da Shopify)
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/smoke.test.ts`
- Create: `.env.example`
- Modify: `.gitignore`, `package.json`, `tsconfig.json`, `AGENTS.md`

**Interfaces:**
- Consumes: nada
- Produces: `npm test` funcional; `prisma` disponível; alias `~/` → `app/` resolvido tanto pelo vitest quanto pelo `tsc`

- [ ] **Step 1: Trazer o template**

O CLI (`npm init @shopify/app@latest`) **não serve aqui**: exige `--organization-id`/`--client-id` e login interativo no Partner, que só acontece na Task 17. Clonar o template oficial direto:

```bash
git clone --depth 1 https://github.com/Shopify/shopify-app-template-react-router.git /tmp/rr
# copiar o conteudo de /tmp/rr (menos .git) para a raiz do repo,
# preservando .git, docs/, app/lib/, tests/
```

Use o template **React Router 7**, não o de Remix: o de Remix está defasado (perdeu a descrição no GitHub, pina uma versão antiga de `@shopify/shopify-api` que gera conflito de tipos no `PrismaSessionStorage`, e ainda usa Polaris React, descontinuado).

Remover o que é ferramenta de manutenção **do repo da Shopify**, não do nosso app: `.claude/`, `.cursor/`, `.gemini/`, `.mcp.json` (esse registra um MCP server que roda `npx -y @shopify/dev-mcp@latest` a cada sessão — deve ser opt-in do dono do repo), `CHANGELOG.md`. Reescrever `AGENTS.md` com o contexto do projeto.

- [ ] **Step 2: Instalar deps**

```bash
npm install
npm i -D vitest @vitest/coverage-v8
```

**Não** instalar `@shopify/polaris`: o template já traz `@shopify/polaris-types` e os web components vêm pelo `AppProvider`.

- [ ] **Step 3: Configurar Vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: { alias: { "~": path.resolve(__dirname, "app") } },
});
```

`tests/setup.ts`:

```ts
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.N8N_WEBHOOK_URL ||= "https://n8n.test/webhook/shopify";
process.env.N8N_WEBHOOK_SECRET ||= "test-secret";
process.env.CRON_SECRET ||= "test-cron-secret";
```

Adicionar em `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Endurecer `.gitignore`**

Garantir estas linhas:

```
.env
.env.*
!.env.example
node_modules/
.vercel
*.log
prisma/*.db
```

- [ ] **Step 5: Criar `.env.example`**

```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
DATABASE_URL_TEST=postgresql://user:pass@host/db_test?sslmode=require
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=https://example.vercel.app
SCOPES=read_orders,read_fulfillments,read_checkouts,read_products,read_inventory,read_customers
ENCRYPTION_KEY=
N8N_WEBHOOK_URL=
N8N_WEBHOOK_SECRET=
NEXTAGS_API_BASE=https://api.nextags.app.br
CRON_SECRET=
DISPATCH_MODE_DEFAULT=n8n
```

- [ ] **Step 6: Teste de fumaça**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("trilhos", () => {
  it("roda vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 passed

- [ ] **Step 7: Verificar que nenhum secret entrou**

```bash
git status --short
grep -rn "shpss_\|shpat_\|SHOPIFY_API_SECRET=." --include="*" --exclude-dir=node_modules . || echo "limpo"
```
Expected: `limpo`, e `.env` ausente do `git status`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Remix Shopify app com Vitest e env de exemplo"
```

---

## Task 2: Schema Prisma e migração

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `app/db.server.ts`
- Create: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `prisma` client exportado de `~/db.server`; models `Store`, `StoreConfig`, `EventDedup`, `EventLog`, `FlowCache`

- [ ] **Step 1: Trocar datasource para Postgres e adicionar models**

Manter o model `Session` que o template gera (usado pelo `@shopify/shopify-app-session-storage-prisma`). Trocar o datasource e acrescentar:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Store {
  shopDomain    String       @id @map("shop_domain")
  scopes        String?
  apiVersion    String       @map("api_version")
  installedAt   DateTime     @default(now()) @map("installed_at")
  uninstalledAt DateTime?    @map("uninstalled_at")
  config        StoreConfig?

  @@map("stores")
}

model StoreConfig {
  shopDomain      String   @id @map("shop_domain")
  store           Store    @relation(fields: [shopDomain], references: [shopDomain], onDelete: Cascade)
  nextagsTokenEnc String?  @map("nextags_token_enc")
  agentId         String?  @map("agent_id")
  flowMap         Json     @default("{}") @map("flow_map")
  cufMap          Json     @default("{}") @map("cuf_map")
  dispatchMode    String   @default("n8n") @map("dispatch_mode")
  enabled         Boolean  @default(false)
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("store_config")
}

model EventDedup {
  id          BigInt   @id @default(autoincrement())
  shopDomain  String   @map("shop_domain")
  dedupKey    String   @map("dedup_key")
  firstSeenAt DateTime @default(now()) @map("first_seen_at")

  @@unique([shopDomain, dedupKey])
  @@map("event_dedup")
}

model EventLog {
  id              BigInt    @id @default(autoincrement())
  shopDomain      String    @map("shop_domain")
  topic           String
  event           String?
  shopifyId       String?   @map("shopify_id")
  payloadHash     String?   @map("payload_hash")
  dispatchStatus  String    @map("dispatch_status")
  nextagsResponse String?   @map("nextags_response")
  attempts        Int       @default(0)
  nextAttemptAt   DateTime? @map("next_attempt_at")
  canonical       Json?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([dispatchStatus, nextAttemptAt])
  @@index([shopDomain, createdAt])
  @@map("event_log")
}

model FlowCache {
  id         BigInt   @id @default(autoincrement())
  shopDomain String   @map("shop_domain")
  flowId     String   @map("flow_id")
  flowName   String   @map("flow_name")
  fetchedAt  DateTime @default(now()) @map("fetched_at")

  @@unique([shopDomain, flowId])
  @@map("flows_cache")
}
```

`event_log.canonical` guarda o payload **com `nextags.token` redigido** (Task 10).

- [ ] **Step 2: Cliente Prisma — acrescentar export nomeado**

O template já traz `app/db.server.ts` exportando `prisma` como **default**. `app/shopify.server.ts` depende desse default, então ele fica. Só acrescentar o export nomeado, porque todo o resto do plano importa `{ prisma } from "~/db.server"`:

```ts
// ...conteúdo existente do template, inalterado...

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
export { prisma };
```

- [ ] **Step 3: Escrever o teste que falha**

`tests/db/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});

const SHOP = "schema-test.myshopify.com";

beforeAll(async () => {
  await prisma.store.create({
    data: { shopDomain: SHOP, apiVersion: "test", config: { create: {} } },
  });
});

afterAll(async () => {
  await prisma.eventDedup.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.delete({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("schema", () => {
  it("cria store com config default dispatchMode n8n", async () => {
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.dispatchMode).toBe("n8n");
    expect(cfg?.enabled).toBe(false);
  });

  it("rejeita dedup_key duplicada na mesma loja", async () => {
    await prisma.eventDedup.create({ data: { shopDomain: SHOP, dedupKey: "k1" } });
    await expect(
      prisma.eventDedup.create({ data: { shopDomain: SHOP, dedupKey: "k1" } }),
    ).rejects.toThrow();
  });

  it("aceita a mesma dedup_key em lojas diferentes", async () => {
    const other = "schema-test-2.myshopify.com";
    await prisma.store.create({ data: { shopDomain: other, apiVersion: "test" } });
    await expect(
      prisma.eventDedup.create({ data: { shopDomain: other, dedupKey: "k1" } }),
    ).resolves.toBeTruthy();
    await prisma.eventDedup.deleteMany({ where: { shopDomain: other } });
    await prisma.store.delete({ where: { shopDomain: other } });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test -- tests/db/schema.test.ts`
Expected: FAIL — tabelas não existem

- [ ] **Step 5: Aplicar a migração**

```bash
npx prisma migrate dev --name init_shopify_nextags
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test -- tests/db/schema.test.ts`
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add prisma app/db.server.ts tests/db/schema.test.ts
git commit -m "feat: schema Prisma com stores, config, dedup, event_log e cache de flows"
```

---

## Task 3: Criptografia de tokens (AES-256-GCM)

**Files:**
- Create: `app/lib/crypto.server.ts`
- Create: `tests/lib/crypto.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `encrypt(plain: string): string`, `decrypt(payload: string): string`

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "~/lib/crypto.server";

describe("crypto", () => {
  it("round-trip preserva o valor", () => {
    const secret = "token-abc-123";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("cifra o mesmo valor de formas diferentes (IV aleatório)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });

  it("rejeita payload adulterado", () => {
    const enc = encrypt("token");
    const [iv, tag, ct] = enc.split(".");
    const tampered = [iv, tag, Buffer.from("outro").toString("base64")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejeita chave de tamanho errado", () => {
    const old = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = old;
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/crypto.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/crypto.server.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY ausente");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64");
  return buf;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("payload cifrado inválido");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/crypto.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/crypto.server.ts tests/lib/crypto.test.ts
git commit -m "feat: criptografia AES-256-GCM para tokens de loja"
```

---

## Task 4: Normalização de telefone BR

**Files:**
- Create: `app/lib/phone.ts`
- Create: `tests/lib/phone.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `normalizarTelefoneBR(raw: string | null | undefined): string | null`

Regra: fixo tem 8 dígitos e começa em 2–5 → **nunca** ganha o `9`. Celular com 8 dígitos começando em 6–9 é número antigo → ganha o `9`. Caso que motivou a regra: fixo `551933334444` estava sendo corrompido em `5519933334444`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizarTelefoneBR } from "~/lib/phone";

describe("normalizarTelefoneBR", () => {
  it("preserva fixo de 8 dígitos sem adicionar 9", () => {
    expect(normalizarTelefoneBR("551933334444")).toBe("551933334444");
    expect(normalizarTelefoneBR("1933334444")).toBe("551933334444");
  });

  it("preserva celular que já tem 9 dígitos", () => {
    expect(normalizarTelefoneBR("5519955554444")).toBe("5519955554444");
    expect(normalizarTelefoneBR("19955554444")).toBe("5519955554444");
  });

  it("adiciona o 9 em celular antigo de 8 dígitos", () => {
    expect(normalizarTelefoneBR("1995554444")).toBe("5519995554444");
    expect(normalizarTelefoneBR("551995554444")).toBe("5519995554444");
  });

  it("limpa máscara e prefixo internacional", () => {
    expect(normalizarTelefoneBR("+55 (19) 3333-4444")).toBe("551933334444");
    expect(normalizarTelefoneBR(" 19 95555-4444 ")).toBe("5519955554444");
  });

  it("retorna null para entrada inválida", () => {
    expect(normalizarTelefoneBR(null)).toBeNull();
    expect(normalizarTelefoneBR("")).toBeNull();
    expect(normalizarTelefoneBR("123")).toBeNull();
    expect(normalizarTelefoneBR("abc")).toBeNull();
    expect(normalizarTelefoneBR("5519333344440000")).toBeNull();
  });

  it("rejeita DDD inexistente", () => {
    expect(normalizarTelefoneBR("0133334444")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/phone.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/phone.ts`:

```ts
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizarTelefoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return null;

  let numero = d.slice(2);

  if (numero.length === 8) {
    const primeiro = numero[0];
    // 6-9 => celular antigo, faltando o nono dígito.
    // 2-5 => fixo, NUNCA ganha o 9 (corromperia o ID do contato no NexTags).
    if (primeiro >= "6" && primeiro <= "9") numero = "9" + numero;
    else if (primeiro < "2") return null;
  }

  if (numero.length === 9 && numero[0] !== "9") return null;

  return `55${d.slice(0, 2)}${numero}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/phone.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/phone.ts tests/lib/phone.test.ts
git commit -m "feat: normalizacao de telefone BR preservando fixo de 8 digitos"
```

---

## Task 5: Normalizadores de payload

**Files:**
- Create: `app/lib/normalize.ts`
- Create: `tests/lib/normalize.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `verificarDado(v, fallback?)`, `separarNomeSobrenome(nome)`, `formatarItens(lineItems)`, `limparNumeroPedido(name)`, `formatarMoeda(v)`

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  verificarDado,
  separarNomeSobrenome,
  formatarItens,
  limparNumeroPedido,
  formatarMoeda,
} from "~/lib/normalize";

describe("verificarDado", () => {
  it("substitui vazio pelo fallback", () => {
    expect(verificarDado(null)).toBe("Não informado");
    expect(verificarDado(undefined)).toBe("Não informado");
    expect(verificarDado("")).toBe("Não informado");
    expect(verificarDado("   ")).toBe("Não informado");
    expect(verificarDado(null, "-")).toBe("-");
  });

  it("preserva valor presente e converte número", () => {
    expect(verificarDado("ok")).toBe("ok");
    expect(verificarDado(0)).toBe("0");
  });
});

describe("separarNomeSobrenome", () => {
  it("separa nome composto", () => {
    expect(separarNomeSobrenome("Maria Silva Souza")).toEqual({
      first_name: "Maria",
      last_name: "Silva Souza",
    });
  });

  it("nome único vira first_name com last_name vazio-fallback", () => {
    expect(separarNomeSobrenome("Maria")).toEqual({
      first_name: "Maria",
      last_name: "Não informado",
    });
  });

  it("entrada vazia cai no fallback", () => {
    expect(separarNomeSobrenome(null)).toEqual({
      first_name: "Não informado",
      last_name: "Não informado",
    });
  });
});

describe("limparNumeroPedido", () => {
  it("remove o # do order.name", () => {
    expect(limparNumeroPedido("#1234")).toBe("1234");
  });

  it("corta sufixo depois do ponto", () => {
    expect(limparNumeroPedido("#1234.1")).toBe("1234");
  });

  it("aceita entrada sem #", () => {
    expect(limparNumeroPedido("1234")).toBe("1234");
  });

  it("vazio cai no fallback", () => {
    expect(limparNumeroPedido(null)).toBe("Não informado");
  });
});

describe("formatarItens", () => {
  it("concatena itens legíveis", () => {
    const itens = [
      { title: "Camiseta", quantity: 2, price: "49.90" },
      { title: "Boné", quantity: 1, price: "39.00" },
    ];
    expect(formatarItens(itens)).toBe(
      "Camiseta (Qtd: 2, R$ 49,90), Boné (Qtd: 1, R$ 39,00)",
    );
  });

  it("lista vazia cai no fallback", () => {
    expect(formatarItens([])).toBe("Não informado");
    expect(formatarItens(undefined)).toBe("Não informado");
  });
});

describe("formatarMoeda", () => {
  it("formata no padrão BR", () => {
    expect(formatarMoeda("199.9")).toBe("R$ 199,90");
    expect(formatarMoeda(1234.5)).toBe("R$ 1.234,50");
  });

  it("valor inválido cai no fallback", () => {
    expect(formatarMoeda(null)).toBe("Não informado");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/normalize.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/normalize.ts`:

```ts
export const FALLBACK = "Não informado";

export function verificarDado(v: unknown, fallback: string = FALLBACK): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

export function separarNomeSobrenome(
  nome: string | null | undefined,
): { first_name: string; last_name: string } {
  const limpo = verificarDado(nome, "");
  if (!limpo) return { first_name: FALLBACK, last_name: FALLBACK };
  const partes = limpo.split(/\s+/);
  const first = partes.shift() as string;
  return {
    first_name: first,
    last_name: partes.length ? partes.join(" ") : FALLBACK,
  };
}

export function limparNumeroPedido(name: string | null | undefined): string {
  const limpo = verificarDado(name, "");
  if (!limpo) return FALLBACK;
  return limpo.replace(/^#/, "").split(".")[0];
}

export function formatarMoeda(v: unknown): string {
  if (v === null || v === undefined || v === "") return FALLBACK;
  const n = Number(v);
  if (!Number.isFinite(n)) return FALLBACK;
  return `R$ ${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type LineItem = { title?: string; name?: string; quantity?: number; price?: string | number };

export function formatarItens(itens: LineItem[] | null | undefined): string {
  if (!itens || itens.length === 0) return FALLBACK;
  return itens
    .map((i) => {
      const titulo = verificarDado(i.title ?? i.name);
      const qtd = verificarDado(i.quantity, "1");
      return `${titulo} (Qtd: ${qtd}, ${formatarMoeda(i.price)})`;
    })
    .join(", ");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/normalize.test.ts`
Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/normalize.ts tests/lib/normalize.test.ts
git commit -m "feat: normalizadores de payload (nome, itens, numero de pedido, moeda)"
```

---

## Task 6: Mapa de eventos Shopify → canônico

**Files:**
- Create: `app/lib/events.ts`
- Create: `tests/lib/events.test.ts`
- Create: `tests/fixtures/` (payloads sintéticos)

**Interfaces:**
- Consumes: nada
- Produces:
  - `type CanonicalEvent = "order_paid" | "order_fulfilled" | "ready_pickup" | "order_delivered" | "order_cancelled" | "order_refunded" | "abandoned_cart"`
  - `type TopicOutcome = { kind: "dispatch"; event: CanonicalEvent } | { kind: "log_only" } | { kind: "internal" } | { kind: "compliance" } | { kind: "unknown" }`
  - `mapTopic(topic: string, payload: any): TopicOutcome`
  - `WEBHOOK_TOPICS: string[]`

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapTopic, WEBHOOK_TOPICS } from "~/lib/events";

describe("mapTopic", () => {
  it("orders/paid vira order_paid", () => {
    expect(mapTopic("orders/paid", {})).toEqual({ kind: "dispatch", event: "order_paid" });
  });

  it("orders/fulfilled com entrega normal vira order_fulfilled", () => {
    const payload = { fulfillments: [{ shipment_status: null }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "order_fulfilled",
    });
  });

  it("orders/fulfilled com pickup vira ready_pickup", () => {
    const payload = { fulfillments: [{ delivery_method: { method_type: "pick_up" } }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "ready_pickup",
    });
  });

  it("shipment_status ready_for_pickup também vira ready_pickup", () => {
    const payload = { fulfillments: [{ shipment_status: "ready_for_pickup" }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "ready_pickup",
    });
  });

  it("fulfillments/update entregue vira order_delivered", () => {
    expect(mapTopic("fulfillments/update", { shipment_status: "delivered" })).toEqual({
      kind: "dispatch",
      event: "order_delivered",
    });
  });

  it("fulfillments/update em trânsito não dispara", () => {
    expect(mapTopic("fulfillments/update", { shipment_status: "in_transit" })).toEqual({
      kind: "log_only",
    });
  });

  it("cancelamento e reembolso", () => {
    expect(mapTopic("orders/cancelled", {})).toEqual({
      kind: "dispatch",
      event: "order_cancelled",
    });
    expect(mapTopic("refunds/create", {})).toEqual({
      kind: "dispatch",
      event: "order_refunded",
    });
  });

  it("catálogo e orders/updated só logam", () => {
    expect(mapTopic("products/update", {})).toEqual({ kind: "log_only" });
    expect(mapTopic("inventory_levels/update", {})).toEqual({ kind: "log_only" });
    expect(mapTopic("orders/updated", {})).toEqual({ kind: "log_only" });
  });

  it("app/uninstalled é interno", () => {
    expect(mapTopic("app/uninstalled", {})).toEqual({ kind: "internal" });
  });

  it("topics de GDPR são compliance", () => {
    for (const t of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect(mapTopic(t, {})).toEqual({ kind: "compliance" });
    }
  });

  it("topic desconhecido é unknown", () => {
    expect(mapTopic("banana/split", {})).toEqual({ kind: "unknown" });
  });
});

describe("WEBHOOK_TOPICS", () => {
  it("inclui os obrigatórios e os transacionais", () => {
    for (const t of [
      "orders/paid",
      "orders/fulfilled",
      "fulfillments/update",
      "orders/cancelled",
      "refunds/create",
      "app/uninstalled",
    ]) {
      expect(WEBHOOK_TOPICS).toContain(t);
    }
  });

  it("não inclui topics de GDPR (declarados no shopify.app.toml)", () => {
    expect(WEBHOOK_TOPICS).not.toContain("customers/redact");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/events.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/events.ts`:

```ts
export type CanonicalEvent =
  | "order_paid"
  | "order_fulfilled"
  | "ready_pickup"
  | "order_delivered"
  | "order_cancelled"
  | "order_refunded"
  | "abandoned_cart";

export type TopicOutcome =
  | { kind: "dispatch"; event: CanonicalEvent }
  | { kind: "log_only" }
  | { kind: "internal" }
  | { kind: "compliance" }
  | { kind: "unknown" };

export const WEBHOOK_TOPICS = [
  "orders/paid",
  "orders/fulfilled",
  "fulfillments/create",
  "fulfillments/update",
  "orders/cancelled",
  "refunds/create",
  "orders/updated",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "app/uninstalled",
];

const COMPLIANCE = new Set(["customers/data_request", "customers/redact", "shop/redact"]);
const LOG_ONLY = new Set([
  "orders/updated",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
]);

// Nomes de campo confirmados na versão fixada da API (ver Task 12, Step 5). [Provável]
function ehPickup(f: any): boolean {
  if (!f) return false;
  const metodo = f.delivery_method?.method_type ?? f.deliveryMethod?.methodType;
  if (typeof metodo === "string" && metodo.toLowerCase().includes("pick")) return true;
  return f.shipment_status === "ready_for_pickup";
}

export function mapTopic(topic: string, payload: any): TopicOutcome {
  if (COMPLIANCE.has(topic)) return { kind: "compliance" };
  if (topic === "app/uninstalled") return { kind: "internal" };
  if (LOG_ONLY.has(topic)) return { kind: "log_only" };

  switch (topic) {
    case "orders/paid":
      return { kind: "dispatch", event: "order_paid" };

    case "orders/fulfilled": {
      const fulfillments: any[] = payload?.fulfillments ?? [];
      const pickup = fulfillments.some(ehPickup);
      return { kind: "dispatch", event: pickup ? "ready_pickup" : "order_fulfilled" };
    }

    case "fulfillments/create":
      return { kind: "dispatch", event: ehPickup(payload) ? "ready_pickup" : "order_fulfilled" };

    case "fulfillments/update":
      return payload?.shipment_status === "delivered"
        ? { kind: "dispatch", event: "order_delivered" }
        : { kind: "log_only" };

    case "orders/cancelled":
      return { kind: "dispatch", event: "order_cancelled" };

    case "refunds/create":
      return { kind: "dispatch", event: "order_refunded" };

    default:
      return { kind: "unknown" };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/events.test.ts`
Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/events.ts tests/lib/events.test.ts
git commit -m "feat: mapa de topics Shopify para eventos canonicos com deteccao de pickup"
```

---

## Task 7: Construção do payload canônico e de `actions[]`

**Files:**
- Create: `app/lib/nextags/payload.ts`
- Create: `tests/lib/nextags-payload.test.ts`

**Interfaces:**
- Consumes: `~/lib/phone`, `~/lib/normalize`, `~/lib/events` (Tasks 4–6)
- Produces:
  - `class EmptyCufError extends Error`
  - `class MissingPhoneError extends Error`
  - `class MissingFlowError extends Error`
  - `buildCanonical(input: BuildInput): CanonicalPayload`
  - `buildActions(cuf: Record<string,string>, tags: string[], flowId: string): Action[]`
  - `redactCanonical(p: CanonicalPayload): CanonicalPayload`

`flow_map.order_refunded` ausente cai em `flow_map.order_cancelled`; `flow_map.ready_pickup` ausente cai em `flow_map.order_fulfilled`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/nextags-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildActions,
  buildCanonical,
  redactCanonical,
  EmptyCufError,
  MissingPhoneError,
  MissingFlowError,
} from "~/lib/nextags/payload";

const base = {
  shop: "loja.myshopify.com",
  event: "order_paid" as const,
  token: "tok-1",
  flowMap: { order_paid: "111", order_fulfilled: "222", order_cancelled: "333" },
  cufMap: { numero: "NumeroPedidoSHP", status: "StatusPedidoSHP" },
  order: {
    id: "gid://shopify/Order/9001",
    name: "#1234",
    total: "199.9",
    phone: "+55 (19) 99876-5432",
    customerName: "Maria Silva",
    lineItems: [{ title: "Camiseta", quantity: 2, price: "49.90" }],
    tracking: null as string | null,
    trackingUrl: null as string | null,
  },
};

describe("buildActions", () => {
  it("põe todos os set_field_value antes do send_flow", () => {
    const actions = buildActions({ A: "1", B: "2" }, ["pedido-pago"], "111");
    const tipos = actions.map((a) => a.action);
    expect(tipos[tipos.length - 1]).toBe("send_flow");
    const ultimoSet = tipos.lastIndexOf("set_field_value");
    expect(ultimoSet).toBeLessThan(tipos.indexOf("send_flow"));
  });

  it("emite um send_flow único com o flow_id recebido", () => {
    const actions = buildActions({ A: "1" }, [], "999");
    const flows = actions.filter((a) => a.action === "send_flow");
    expect(flows).toHaveLength(1);
    expect(flows[0]).toEqual({ action: "send_flow", flow_id: "999" });
  });

  it("recusa CUF com valor vazio", () => {
    expect(() => buildActions({ A: "" }, [], "111")).toThrow(EmptyCufError);
    expect(() => buildActions({ A: "   " }, [], "111")).toThrow(EmptyCufError);
  });
});

describe("buildCanonical", () => {
  it("monta payload com telefone normalizado e nome separado", () => {
    const p = buildCanonical(base);
    expect(p.schema).toBe(1);
    expect(p.event).toBe("order_paid");
    expect(p.customer.phone).toBe("5519555544441");
    expect(p.customer.first_name).toBe("Maria");
    expect(p.customer.last_name).toBe("Silva");
    expect(p.order.number).toBe("1234");
    expect(p.order.items).toContain("Camiseta (Qtd: 2, R$ 49,90)");
    expect(p.nextags.flow_id).toBe("111");
    expect(p.nextags.token).toBe("tok-1");
  });

  it("nunca deixa CUF vazio no payload", () => {
    const p = buildCanonical(base);
    for (const v of Object.values(p.nextags.cuf)) expect(String(v).trim()).not.toBe("");
  });

  it("falha sem telefone válido", () => {
    expect(() =>
      buildCanonical({ ...base, order: { ...base.order, phone: "123" } }),
    ).toThrow(MissingPhoneError);
  });

  it("falha sem flow mapeado", () => {
    expect(() =>
      buildCanonical({ ...base, event: "abandoned_cart", flowMap: {} }),
    ).toThrow(MissingFlowError);
  });

  it("ready_pickup sem flow próprio cai em order_fulfilled", () => {
    const p = buildCanonical({ ...base, event: "ready_pickup" });
    expect(p.nextags.flow_id).toBe("222");
  });

  it("order_refunded sem flow próprio cai em order_cancelled", () => {
    const p = buildCanonical({ ...base, event: "order_refunded" });
    expect(p.nextags.flow_id).toBe("333");
  });
});

describe("redactCanonical", () => {
  it("remove o token antes de gravar em log", () => {
    const p = buildCanonical(base);
    const r = redactCanonical(p);
    expect(r.nextags.token).toBe("[REDACTED]");
    expect(p.nextags.token).toBe("tok-1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/nextags-payload.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/nextags/payload.ts`:

```ts
import type { CanonicalEvent } from "~/lib/events";
import { normalizarTelefoneBR } from "~/lib/phone";
import {
  formatarItens,
  formatarMoeda,
  limparNumeroPedido,
  separarNomeSobrenome,
  verificarDado,
} from "~/lib/normalize";

export class EmptyCufError extends Error {}
export class MissingPhoneError extends Error {}
export class MissingFlowError extends Error {}

export type Action =
  | { action: "set_field_value"; field_name: string; value: string }
  | { action: "add_tag"; tag_name: string }
  | { action: "send_flow"; flow_id: string };

export type CanonicalPayload = {
  schema: 1;
  event: CanonicalEvent;
  shop: string;
  customer: { first_name: string; last_name: string; phone: string };
  order: {
    id: string;
    number: string;
    total: string;
    items: string;
    tracking: string;
    tracking_url: string;
  };
  nextags: { token: string; flow_id: string; cuf: Record<string, string>; tags: string[] };
};

export type BuildInput = {
  shop: string;
  event: CanonicalEvent;
  token: string;
  flowMap: Record<string, string | undefined>;
  cufMap: Record<string, string>;
  order: {
    id: string;
    name?: string | null;
    total?: string | number | null;
    phone?: string | null;
    customerName?: string | null;
    lineItems?: any[] | null;
    tracking?: string | null;
    trackingUrl?: string | null;
  };
};

const FLOW_FALLBACK: Partial<Record<CanonicalEvent, CanonicalEvent>> = {
  ready_pickup: "order_fulfilled",
  order_refunded: "order_cancelled",
};

const STATUS_LABEL: Record<CanonicalEvent, string> = {
  order_paid: "Pago",
  order_fulfilled: "Enviado",
  ready_pickup: "Pronto para retirada",
  order_delivered: "Entregue",
  order_cancelled: "Cancelado",
  order_refunded: "Reembolsado",
  abandoned_cart: "Carrinho abandonado",
};

const TAG: Record<CanonicalEvent, string> = {
  order_paid: "pedido-pago",
  order_fulfilled: "pedido-enviado",
  ready_pickup: "pedido-retirada",
  order_delivered: "pedido-entregue",
  order_cancelled: "pedido-cancelado",
  order_refunded: "pedido-reembolsado",
  abandoned_cart: "carrinho-abandonado",
};

export function resolveFlowId(
  event: CanonicalEvent,
  flowMap: Record<string, string | undefined>,
): string {
  const direto = flowMap[event];
  if (direto && String(direto).trim()) return String(direto).trim();
  const fb = FLOW_FALLBACK[event];
  const alternativo = fb ? flowMap[fb] : undefined;
  if (alternativo && String(alternativo).trim()) return String(alternativo).trim();
  throw new MissingFlowError(`sem flow_id configurado para ${event}`);
}

export function buildActions(
  cuf: Record<string, string>,
  tags: string[],
  flowId: string,
): Action[] {
  const actions: Action[] = [];
  for (const [field_name, value] of Object.entries(cuf)) {
    if (!String(value ?? "").trim()) {
      throw new EmptyCufError(`CUF vazio: ${field_name}`);
    }
    actions.push({ action: "set_field_value", field_name, value: String(value) });
  }
  for (const tag_name of tags) actions.push({ action: "add_tag", tag_name });
  actions.push({ action: "send_flow", flow_id: flowId });
  return actions;
}

export function buildCanonical(input: BuildInput): CanonicalPayload {
  const phone = normalizarTelefoneBR(input.order.phone);
  if (!phone) throw new MissingPhoneError("telefone ausente ou inválido");

  const flowId = resolveFlowId(input.event, input.flowMap);
  const { first_name, last_name } = separarNomeSobrenome(input.order.customerName);
  const numero = limparNumeroPedido(input.order.name);

  const valores: Record<string, string> = {
    numero,
    status: STATUS_LABEL[input.event],
    total: formatarMoeda(input.order.total),
    rastreio: verificarDado(input.order.tracking),
    rastreio_url: verificarDado(input.order.trackingUrl),
    itens: formatarItens(input.order.lineItems),
  };

  const cuf: Record<string, string> = {};
  for (const [chave, fieldName] of Object.entries(input.cufMap)) {
    if (!fieldName) continue;
    cuf[fieldName] = verificarDado(valores[chave]);
  }

  return {
    schema: 1,
    event: input.event,
    shop: input.shop,
    customer: { first_name, last_name, phone },
    order: {
      id: String(input.order.id),
      number: numero,
      total: formatarMoeda(input.order.total),
      items: formatarItens(input.order.lineItems),
      tracking: verificarDado(input.order.tracking),
      tracking_url: verificarDado(input.order.trackingUrl),
    },
    nextags: { token: input.token, flow_id: flowId, cuf, tags: [TAG[input.event]] },
  };
}

export function redactCanonical(p: CanonicalPayload): CanonicalPayload {
  return { ...p, nextags: { ...p.nextags, token: "[REDACTED]" } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/nextags-payload.test.ts`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/nextags/payload.ts tests/lib/nextags-payload.test.ts
git commit -m "feat: payload canonico e actions com set_field_value antes de send_flow"
```

---

## Task 8: Cliente da API NexTags

**Files:**
- Create: `app/lib/nextags/client.server.ts`
- Create: `tests/lib/nextags-client.test.ts`

**Interfaces:**
- Consumes: `~/lib/nextags/payload` (Task 7)
- Produces:
  - `validateToken(token: string): Promise<{ ok: boolean; message?: string }>`
  - `listFlows(token: string): Promise<{ flow_id: string; flow_name: string }[]>`
  - `sendContact(payload: CanonicalPayload, timeoutMs?: number): Promise<{ ok: boolean; status: number; body: string }>`

Endpoint de listagem confirmado como existente (questão 1 do spec resolvida). O caminho exato é lido de `NEXTAGS_FLOWS_PATH` (default `/api/flows`) para não travar a implementação — ajustar o default assim que confirmado.

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/nextags-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { validateToken, listFlows, sendContact } from "~/lib/nextags/client.server";
import { buildCanonical } from "~/lib/nextags/payload";

const payload = buildCanonical({
  shop: "loja.myshopify.com",
  event: "order_paid",
  token: "tok-1",
  flowMap: { order_paid: "111" },
  cufMap: { numero: "NumeroPedidoSHP" },
  order: {
    id: "1",
    name: "#1",
    total: "10",
    phone: "19955556666",
    customerName: "Ana Souza",
    lineItems: [{ title: "X", quantity: 1, price: "10" }],
  },
});

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: any) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("validateToken", () => {
  it("token válido retorna ok", async () => {
    stubFetch(async () => new Response("[]", { status: 200 }));
    expect(await validateToken("tok")).toEqual({ ok: true });
  });

  it("401 retorna erro legível", async () => {
    stubFetch(async () => new Response("unauthorized", { status: 401 }));
    const r = await validateToken("ruim");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/inválid|401/i);
  });
});

describe("listFlows", () => {
  it("normaliza a lista de flows", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 7, name: "Pedido pago" }] }), {
          status: 200,
        }),
    );
    expect(await listFlows("tok")).toEqual([{ flow_id: "7", flow_name: "Pedido pago" }]);
  });

  it("erro HTTP propaga exceção", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    await expect(listFlows("tok")).rejects.toThrow();
  });
});

describe("sendContact", () => {
  it("envia token no header X-ACCESS-TOKEN e não no corpo", async () => {
    const fn = stubFetch(async () => new Response('{"success":true}', { status: 200 }));
    const r = await sendContact(payload);
    expect(r.ok).toBe(true);
    const [, init] = fn.mock.calls[0];
    expect(init.headers["X-ACCESS-TOKEN"]).toBe("tok-1");
    expect(init.body).not.toContain("tok-1");
  });

  it("corpo tem actions com send_flow por último", async () => {
    const fn = stubFetch(async () => new Response("{}", { status: 200 }));
    await sendContact(payload);
    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body.actions[body.actions.length - 1].action).toBe("send_flow");
    expect(body.phone).toBe(payload.customer.phone);
  });

  it("HTTP de erro retorna ok:false com status e corpo", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));
    const r = await sendContact(payload);
    expect(r).toMatchObject({ ok: false, status: 429, body: "rate limited" });
  });

  it("timeout retorna ok:false status 0", async () => {
    stubFetch(
      (_url: string, init: any) =>
        new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const r = await sendContact(payload, 10);
    expect(r).toMatchObject({ ok: false, status: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/nextags-client.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/nextags/client.server.ts`:

```ts
import { buildActions, type CanonicalPayload } from "./payload";

const BASE = () => process.env.NEXTAGS_API_BASE ?? "https://api.nextags.app.br";
const FLOWS_PATH = () => process.env.NEXTAGS_FLOWS_PATH ?? "/api/flows";
const CONTACTS_PATH = "/api/contacts";

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    "X-ACCESS-TOKEN": token,
  } as Record<string, string>;
}

export async function validateToken(token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${BASE()}${FLOWS_PATH()}`, { method: "GET", headers: headers(token) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Chave inválida ou sem permissão (HTTP " + res.status + ")" };
    }
    if (!res.ok) return { ok: false, message: `NexTags respondeu HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Falha ao contatar a NexTags: ${(e as Error).message}` };
  }
}

export async function listFlows(token: string): Promise<{ flow_id: string; flow_name: string }[]> {
  const res = await fetch(`${BASE()}${FLOWS_PATH()}`, { method: "GET", headers: headers(token) });
  if (!res.ok) throw new Error(`listFlows HTTP ${res.status}`);
  const json: any = await res.json();
  const arr: any[] = Array.isArray(json) ? json : (json.data ?? json.flows ?? []);
  return arr.map((f) => ({
    flow_id: String(f.flow_id ?? f.id),
    flow_name: String(f.flow_name ?? f.name ?? f.title ?? f.id),
  }));
}

export async function sendContact(
  payload: CanonicalPayload,
  timeoutMs = 2000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const actions = buildActions(payload.nextags.cuf, payload.nextags.tags, payload.nextags.flow_id);
  const body = JSON.stringify({
    phone: payload.customer.phone,
    first_name: payload.customer.first_name,
    last_name: payload.customer.last_name,
    actions,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}${CONTACTS_PATH}`, {
      method: "POST",
      headers: headers(payload.nextags.token),
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    // success:true nao prova entrega — quem audita e o event_log.
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: `erro de rede: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/nextags-client.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/nextags/client.server.ts tests/lib/nextags-client.test.ts
git commit -m "feat: cliente NexTags (validar token, listar flows, POST contacts)"
```

---

## Task 9: Dedup persistente

**Files:**
- Create: `app/lib/dedup.server.ts`
- Create: `tests/db/dedup.test.ts`

**Interfaces:**
- Consumes: `~/db.server` (Task 2)
- Produces:
  - `dedupKeyWebhook(webhookId: string): string`
  - `dedupKeyOrderStatus(orderId: string, event: string): string`
  - `dedupKeyCart(checkoutId: string): string`
  - `claimEvent(shop: string, key: string): Promise<boolean>` — `true` na primeira vez, `false` em repetição

- [ ] **Step 1: Escrever o teste que falha**

`tests/db/dedup.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  claimEvent,
  dedupKeyCart,
  dedupKeyOrderStatus,
  dedupKeyWebhook,
} from "~/lib/dedup.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "dedup-test.myshopify.com";

beforeAll(async () => {
  await prisma.store.create({ data: { shopDomain: SHOP, apiVersion: "test" } });
});
afterAll(async () => {
  await prisma.eventDedup.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.delete({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("chaves", () => {
  it("são prefixadas por família", () => {
    expect(dedupKeyWebhook("abc")).toBe("wh:abc");
    expect(dedupKeyOrderStatus("9001", "order_paid")).toBe("order:9001:order_paid");
    expect(dedupKeyCart("c1")).toBe("cart:c1");
  });
});

describe("claimEvent", () => {
  it("primeira chamada true, repetições false", async () => {
    const k = dedupKeyWebhook("evt-1");
    expect(await claimEvent(SHOP, k)).toBe(true);
    expect(await claimEvent(SHOP, k)).toBe(false);
    expect(await claimEvent(SHOP, k)).toBe(false);
  });

  it("mesma ordem com evento diferente não é dedup", async () => {
    expect(await claimEvent(SHOP, dedupKeyOrderStatus("9002", "order_paid"))).toBe(true);
    expect(await claimEvent(SHOP, dedupKeyOrderStatus("9002", "order_fulfilled"))).toBe(true);
  });

  it("chamadas concorrentes: exatamente uma ganha", async () => {
    const k = dedupKeyWebhook("evt-race");
    const rs = await Promise.all([
      claimEvent(SHOP, k),
      claimEvent(SHOP, k),
      claimEvent(SHOP, k),
    ]);
    expect(rs.filter(Boolean)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/db/dedup.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/dedup.server.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";

export const dedupKeyWebhook = (webhookId: string) => `wh:${webhookId}`;
export const dedupKeyOrderStatus = (orderId: string, event: string) =>
  `order:${orderId}:${event}`;
export const dedupKeyCart = (checkoutId: string) => `cart:${checkoutId}`;

export async function claimEvent(shop: string, key: string): Promise<boolean> {
  try {
    await prisma.eventDedup.create({ data: { shopDomain: shop, dedupKey: key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/db/dedup.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/dedup.server.ts tests/db/dedup.test.ts
git commit -m "feat: dedup persistente por unique constraint com 3 familias de chave"
```

---

## Task 10: `event_log` e agenda de retry

**Files:**
- Create: `app/lib/eventlog.server.ts`
- Create: `tests/db/eventlog.test.ts`

**Interfaces:**
- Consumes: `~/db.server` (Task 2), `redactCanonical` (Task 7)
- Produces:
  - `logStart(args): Promise<bigint>`
  - `logSuccess(id: bigint, response: string): Promise<void>`
  - `logFailure(id: bigint, response: string, attempts: number): Promise<void>` — agenda retry ou marca `failed`
  - `logSkipped(args): Promise<void>`
  - `dueForRetry(limit?: number): Promise<EventLog[]>`
  - `BACKOFF_MS: number[]` — `[30_000, 300_000, 1_800_000]`

- [ ] **Step 1: Escrever o teste que falha**

`tests/db/eventlog.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  BACKOFF_MS,
  dueForRetry,
  logFailure,
  logStart,
  logSuccess,
} from "~/lib/eventlog.server";
import { buildCanonical } from "~/lib/nextags/payload";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "log-test.myshopify.com";

const canonical = buildCanonical({
  shop: SHOP,
  event: "order_paid",
  token: "tok-secreto",
  flowMap: { order_paid: "111" },
  cufMap: { numero: "NumeroPedidoSHP" },
  order: {
    id: "1",
    name: "#1",
    total: "10",
    phone: "19955556666",
    customerName: "Ana Souza",
    lineItems: [{ title: "X", quantity: 1, price: "10" }],
  },
});

beforeAll(async () => {
  await prisma.store.create({ data: { shopDomain: SHOP, apiVersion: "test" } });
});
afterAll(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.delete({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("event_log", () => {
  it("logStart nunca grava o token no canonical", async () => {
    const id = await logStart({
      shop: SHOP,
      topic: "orders/paid",
      event: "order_paid",
      shopifyId: "1",
      canonical,
    });
    const row = await prisma.eventLog.findUnique({ where: { id } });
    expect(JSON.stringify(row?.canonical)).not.toContain("tok-secreto");
    expect(JSON.stringify(row?.canonical)).toContain("[REDACTED]");
    expect(row?.dispatchStatus).toBe("pending");
  });

  it("logSuccess marca ok", async () => {
    const id = await logStart({ shop: SHOP, topic: "orders/paid", event: "order_paid" });
    await logSuccess(id, '{"success":true}');
    const row = await prisma.eventLog.findUnique({ where: { id } });
    expect(row?.dispatchStatus).toBe("ok");
    expect(row?.nextAttemptAt).toBeNull();
  });

  it("logFailure agenda retry dentro do backoff", async () => {
    const id = await logStart({ shop: SHOP, topic: "orders/paid", event: "order_paid" });
    await logFailure(id, "HTTP 500", 1);
    const row = await prisma.eventLog.findUnique({ where: { id } });
    expect(row?.dispatchStatus).toBe("retrying");
    expect(row?.attempts).toBe(1);
    const delta = row!.nextAttemptAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(BACKOFF_MS[0] + 2000);
  });

  it("esgotado o backoff marca failed", async () => {
    const id = await logStart({ shop: SHOP, topic: "orders/paid", event: "order_paid" });
    await logFailure(id, "HTTP 500", BACKOFF_MS.length + 1);
    const row = await prisma.eventLog.findUnique({ where: { id } });
    expect(row?.dispatchStatus).toBe("failed");
    expect(row?.nextAttemptAt).toBeNull();
  });

  it("dueForRetry só devolve vencidos", async () => {
    const vencido = await logStart({ shop: SHOP, topic: "orders/paid", event: "order_paid" });
    await prisma.eventLog.update({
      where: { id: vencido },
      data: {
        dispatchStatus: "retrying",
        nextAttemptAt: new Date(Date.now() - 60_000),
        attempts: 1,
      },
    });
    const futuro = await logStart({ shop: SHOP, topic: "orders/paid", event: "order_paid" });
    await prisma.eventLog.update({
      where: { id: futuro },
      data: {
        dispatchStatus: "retrying",
        nextAttemptAt: new Date(Date.now() + 600_000),
        attempts: 1,
      },
    });

    const ids = (await dueForRetry(50)).map((r) => r.id);
    expect(ids).toContain(vencido);
    expect(ids).not.toContain(futuro);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/db/eventlog.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/eventlog.server.ts`:

```ts
import { createHash } from "node:crypto";
import { prisma } from "~/db.server";
import { redactCanonical, type CanonicalPayload } from "~/lib/nextags/payload";

export const BACKOFF_MS = [30_000, 300_000, 1_800_000];

type StartArgs = {
  shop: string;
  topic: string;
  event?: string | null;
  shopifyId?: string | null;
  canonical?: CanonicalPayload | null;
};

export async function logStart(args: StartArgs): Promise<bigint> {
  const row = await prisma.eventLog.create({
    data: {
      shopDomain: args.shop,
      topic: args.topic,
      event: args.event ?? null,
      shopifyId: args.shopifyId ?? null,
      dispatchStatus: "pending",
      canonical: args.canonical ? (redactCanonical(args.canonical) as any) : undefined,
      payloadHash: args.canonical
        ? createHash("sha256").update(JSON.stringify(redactCanonical(args.canonical))).digest("hex")
        : null,
    },
    select: { id: true },
  });
  return row.id;
}

export async function logSuccess(id: bigint, response: string): Promise<void> {
  await prisma.eventLog.update({
    where: { id },
    data: {
      dispatchStatus: "ok",
      nextagsResponse: response.slice(0, 2000),
      nextAttemptAt: null,
      attempts: { increment: 1 },
    },
  });
}

export async function logFailure(id: bigint, response: string, attempts: number): Promise<void> {
  const delay = BACKOFF_MS[attempts - 1];
  await prisma.eventLog.update({
    where: { id },
    data: {
      dispatchStatus: delay ? "retrying" : "failed",
      nextagsResponse: response.slice(0, 2000),
      attempts,
      nextAttemptAt: delay ? new Date(Date.now() + delay) : null,
    },
  });
}

export async function logSkipped(args: StartArgs & { motivo: string }): Promise<void> {
  await prisma.eventLog.create({
    data: {
      shopDomain: args.shop,
      topic: args.topic,
      event: args.event ?? null,
      shopifyId: args.shopifyId ?? null,
      dispatchStatus: "skipped",
      nextagsResponse: args.motivo.slice(0, 2000),
    },
  });
}

export async function dueForRetry(limit = 25) {
  return prisma.eventLog.findMany({
    where: { dispatchStatus: "retrying", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/db/eventlog.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/eventlog.server.ts tests/db/eventlog.test.ts
git commit -m "feat: event_log com token redigido e agenda de retry por backoff"
```

---

## Task 11: Dispatcher (`n8n` e `direct`)

**Files:**
- Create: `app/lib/dispatch/n8n.server.ts`
- Create: `app/lib/dispatch/direct.server.ts`
- Create: `app/lib/dispatch/index.server.ts`
- Create: `tests/lib/dispatch.test.ts`

**Interfaces:**
- Consumes: `sendContact` (Task 8), `CanonicalPayload` (Task 7)
- Produces:
  - `type DispatchMode = "n8n" | "direct"`
  - `type DispatchResult = { ok: boolean; status: number; body: string }`
  - `dispatch(payload: CanonicalPayload, mode: DispatchMode, timeoutMs?: number): Promise<DispatchResult>`

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/dispatch.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatch } from "~/lib/dispatch/index.server";
import { buildCanonical } from "~/lib/nextags/payload";

const payload = buildCanonical({
  shop: "loja.myshopify.com",
  event: "order_paid",
  token: "tok-1",
  flowMap: { order_paid: "111" },
  cufMap: { numero: "NumeroPedidoSHP" },
  order: {
    id: "1",
    name: "#1",
    total: "10",
    phone: "19955556666",
    customerName: "Ana Souza",
    lineItems: [{ title: "X", quantity: 1, price: "10" }],
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("dispatch n8n", () => {
  it("POSTa no N8N_WEBHOOK_URL com header de secret", async () => {
    const fn = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fn);

    const r = await dispatch(payload, "n8n");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0] as any[];
    expect(url).toBe(process.env.N8N_WEBHOOK_URL);
    expect(init.headers["X-Webhook-Secret"]).toBe(process.env.N8N_WEBHOOK_SECRET);
    const body = JSON.parse(init.body);
    expect(body.schema).toBe(1);
    expect(body.nextags.token).toBe("tok-1");
  });

  it("HTTP de erro vira ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect(await dispatch(payload, "n8n")).toMatchObject({ ok: false, status: 502 });
  });

  it("timeout vira ok:false status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: any) =>
          new Promise((_res, rej) =>
            init.signal.addEventListener("abort", () => rej(new Error("aborted"))),
          ),
      ),
    );
    expect(await dispatch(payload, "n8n", 10)).toMatchObject({ ok: false, status: 0 });
  });
});

describe("dispatch direct", () => {
  it("chama a API NexTags com o token no header", async () => {
    const fn = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal("fetch", fn);

    const r = await dispatch(payload, "direct");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0] as any[];
    expect(String(url)).toContain("/api/contacts");
    expect(init.headers["X-ACCESS-TOKEN"]).toBe("tok-1");
  });
});

describe("modo inválido", () => {
  it("lança erro", async () => {
    await expect(dispatch(payload, "banana" as any)).rejects.toThrow(/modo/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/lib/dispatch.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/dispatch/n8n.server.ts`:

```ts
import type { CanonicalPayload } from "~/lib/nextags/payload";

export async function dispatchN8n(
  payload: CanonicalPayload,
  timeoutMs = 2000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error("N8N_WEBHOOK_URL ausente");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": process.env.N8N_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: `erro de rede: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
```

`app/lib/dispatch/direct.server.ts`:

```ts
import { sendContact } from "~/lib/nextags/client.server";
import type { CanonicalPayload } from "~/lib/nextags/payload";

export function dispatchDirect(payload: CanonicalPayload, timeoutMs = 2000) {
  return sendContact(payload, timeoutMs);
}
```

`app/lib/dispatch/index.server.ts`:

```ts
import type { CanonicalPayload } from "~/lib/nextags/payload";
import { dispatchN8n } from "./n8n.server";
import { dispatchDirect } from "./direct.server";

export type DispatchMode = "n8n" | "direct";
export type DispatchResult = { ok: boolean; status: number; body: string };

export function dispatch(
  payload: CanonicalPayload,
  mode: DispatchMode,
  timeoutMs = 2000,
): Promise<DispatchResult> {
  if (mode === "n8n") return dispatchN8n(payload, timeoutMs);
  if (mode === "direct") return dispatchDirect(payload, timeoutMs);
  return Promise.reject(new Error(`modo de dispatch desconhecido: ${mode}`));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/lib/dispatch.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add app/lib/dispatch tests/lib/dispatch.test.ts
git commit -m "feat: dispatcher com adapters n8n e direct e timeout de 2s"
```

---

## Task 12: Configuração do app Shopify

**Files:**
- Modify: `app/shopify.server.ts`
- Modify: `shopify.app.toml`
- Create: `tests/shopify-config.test.ts`

**Interfaces:**
- Consumes: `WEBHOOK_TOPICS` (Task 6), `prisma` (Task 2)
- Produces: `authenticate`, `apiVersion`, `registerWebhooks` do `shopifyApp`

- [ ] **Step 1: Escrever o teste que falha**

`tests/shopify-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WEBHOOK_TOPICS } from "~/lib/events";

describe("shopify.app.toml", () => {
  const toml = readFileSync("shopify.app.toml", "utf8");

  it("declara os 3 topics de compliance apontando para o receptor", () => {
    for (const t of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect(toml).toContain(`compliance_topics = ["${t}"]`);
    }
    expect(toml).toContain('uri = "/webhooks/shopify"');
  });

  it("declara os topics transacionais", () => {
    for (const t of [
      "orders/paid",
      "orders/fulfilled",
      "fulfillments/update",
      "orders/cancelled",
      "refunds/create",
      "app/uninstalled",
    ]) {
      expect(toml).toContain(`"${t}"`);
    }
  });

  it("declara exatamente os scopes do v1", () => {
    for (const s of [
      "read_orders",
      "read_fulfillments",
      "read_checkouts",
      "read_products",
      "read_inventory",
      "read_customers",
    ]) {
      expect(toml).toContain(s);
    }
    expect(toml).not.toContain("read_all_orders");
    expect(toml).not.toMatch(/write_/);
  });

  it("é embedded", () => {
    expect(toml).toMatch(/embedded\s*=\s*true/);
  });
});

describe("cobertura de topics", () => {
  it("todo topic de WEBHOOK_TOPICS está declarado no toml", () => {
    const toml = readFileSync("shopify.app.toml", "utf8");
    for (const t of WEBHOOK_TOPICS) {
      expect(toml).toContain(`"${t}"`);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/shopify-config.test.ts`
Expected: FAIL

- [ ] **Step 3: Ajustar `shopify.app.toml`**

O template declara webhooks **no toml** (declarativo), não em `shopifyApp({ webhooks })`. Topics transacionais e de compliance apontam todos para a mesma rota; o roteamento por topic vive no handler.

```toml
embedded = true

[access_scopes]
scopes = "read_orders,read_fulfillments,read_checkouts,read_products,read_inventory,read_customers"

[webhooks]
api_version = "<valor impresso no Step 5>"

  [[webhooks.subscriptions]]
  uri = "/webhooks/shopify"
  topics = [
    "orders/paid",
    "orders/fulfilled",
    "orders/cancelled",
    "orders/updated",
    "fulfillments/create",
    "fulfillments/update",
    "refunds/create",
    "products/create",
    "products/update",
    "products/delete",
    "inventory_levels/update",
    "app/uninstalled",
  ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/shopify"
  compliance_topics = ["customers/data_request"]

  [[webhooks.subscriptions]]
  uri = "/webhooks/shopify"
  compliance_topics = ["customers/redact"]

  [[webhooks.subscriptions]]
  uri = "/webhooks/shopify"
  compliance_topics = ["shop/redact"]
```

Apagar as rotas de webhook que vêm no template, substituídas pelo receptor único:

```bash
rm app/routes/webhooks.app.uninstalled.tsx app/routes/webhooks.app.scopes_update.tsx
```

- [ ] **Step 4: Ajustar `app/shopify.server.ts`**

Partir do arquivo que o template já traz e alterar apenas o necessário: `apiVersion`, `distribution`, e o hook `afterAuth`. **Não** adicionar a chave `webhooks` — as subscriptions são declarativas no toml.

```ts
import "@shopify/shopify-app-react-router/adapters/node";
import { AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { LATEST_API_VERSION } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: LATEST_API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session }) => {
      await prisma.store.upsert({
        where: { shopDomain: session.shop },
        create: {
          shopDomain: session.shop,
          apiVersion: LATEST_API_VERSION,
          scopes: session.scope ?? null,
          uninstalledAt: null,
          config: { create: { dispatchMode: process.env.DISPATCH_MODE_DEFAULT ?? "n8n" } },
        },
        update: {
          apiVersion: LATEST_API_VERSION,
          scopes: session.scope ?? null,
          uninstalledAt: null,
        },
      });
    },
  },
});

export default shopify;
export const apiVersion = LATEST_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
```

- [ ] **Step 5: Confirmar a versão de API e os campos de pickup**

Conferir qual versão o pacote instalado considera a mais recente estável:

```bash
node -e "const {LATEST_API_VERSION}=require('@shopify/shopify-api'); console.log(LATEST_API_VERSION)"
```

Conferir na doc dessa versão os nomes usados em `ehPickup` (Task 6): `delivery_method.method_type` e `shipment_status`. Se diferirem, ajustar `app/lib/events.ts` **e** o teste correspondente. Alinhar `api_version` do `shopify.app.toml` com o valor impresso.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test -- tests/shopify-config.test.ts`
Expected: 4 passed

- [ ] **Step 7: Commit**

```bash
git add app/shopify.server.ts shopify.app.toml tests/shopify-config.test.ts
git commit -m "feat: configura shopifyApp com scopes v1, webhooks e compliance"
```

---

## Task 13: Receptor de webhooks

**Files:**
- Create: `app/lib/webhook-handler.server.ts`
- Create: `app/routes/webhooks.shopify.tsx`
- Create: `tests/webhook-handler.test.ts`
- Create: `tests/fixtures/orders-paid.json`, `tests/fixtures/orders-fulfilled-pickup.json`, `tests/fixtures/fulfillments-update-delivered.json`

**Interfaces:**
- Consumes: Tasks 6, 7, 9, 10, 11
- Produces: `handleWebhook(args: HandleArgs): Promise<{ outcome: string }>` — separado da rota para ser testável sem HTTP

`HandleArgs = { shop: string; topic: string; webhookId: string; payload: any }`

Ordem obrigatória: mapear topic → dedup → carregar config → montar canônico → logStart → dispatch (2s) → logSuccess/logFailure → retornar. HMAC fica com `authenticate.webhook` na rota.

- [ ] **Step 1: Criar fixtures sintéticas**

`tests/fixtures/orders-paid.json` (dados **inventados** — nada de cliente real):

```json
{
  "id": 9001,
  "admin_graphql_api_id": "gid://shopify/Order/9001",
  "name": "#1234",
  "total_price": "199.90",
  "phone": null,
  "customer": { "first_name": "Ana", "last_name": "Souza", "phone": "+55 19 95555-4444" },
  "line_items": [{ "title": "Camiseta", "quantity": 2, "price": "49.90" }],
  "fulfillments": []
}
```

`tests/fixtures/orders-fulfilled-pickup.json`:

```json
{
  "id": 9002,
  "name": "#1235",
  "total_price": "99.00",
  "customer": { "first_name": "Bruno", "last_name": "Lima", "phone": "19955556666" },
  "line_items": [{ "title": "Boné", "quantity": 1, "price": "99.00" }],
  "fulfillments": [
    { "id": 1, "delivery_method": { "method_type": "pick_up" }, "tracking_number": null }
  ]
}
```

`tests/fixtures/fulfillments-update-delivered.json`:

```json
{
  "id": 5001,
  "order_id": 9003,
  "shipment_status": "delivered",
  "tracking_number": "BR123456789BR",
  "tracking_url": "https://rastreio.exemplo/BR123456789BR",
  "destination": { "phone": "19955556666", "first_name": "Carla", "last_name": "Dias" },
  "line_items": [{ "title": "Tênis", "quantity": 1, "price": "299.00" }]
}
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/webhook-handler.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { handleWebhook } from "~/lib/webhook-handler.server";
import { encrypt } from "~/lib/crypto.server";
import ordersPaid from "./fixtures/orders-paid.json";
import ordersFulfilledPickup from "./fixtures/orders-fulfilled-pickup.json";
import fulfillmentDelivered from "./fixtures/fulfillments-update-delivered.json";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "wh-test.myshopify.com";

beforeAll(async () => {
  await prisma.store.create({
    data: {
      shopDomain: SHOP,
      apiVersion: "test",
      config: {
        create: {
          nextagsTokenEnc: encrypt("tok-loja"),
          enabled: true,
          dispatchMode: "n8n",
          flowMap: { order_paid: "111", order_fulfilled: "222", order_delivered: "444" },
          cufMap: { numero: "NumeroPedidoSHP", status: "StatusPedidoSHP", rastreio: "RastreioSHP" },
        },
      },
    },
  });
});

afterAll(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.eventDedup.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.delete({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.eventDedup.deleteMany({ where: { shopDomain: SHOP } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("handleWebhook", () => {
  it("orders/paid dispara e loga ok", async () => {
    const r = await handleWebhook({
      shop: SHOP,
      topic: "orders/paid",
      webhookId: "w1",
      payload: ordersPaid,
    });
    expect(r.outcome).toBe("dispatched");

    const rows = await prisma.eventLog.findMany({ where: { shopDomain: SHOP } });
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatchStatus).toBe("ok");
    expect(rows[0].event).toBe("order_paid");
    expect(JSON.stringify(rows[0].canonical)).not.toContain("tok-loja");
  });

  it("replay do mesmo webhook_id é dedup", async () => {
    await handleWebhook({ shop: SHOP, topic: "orders/paid", webhookId: "w2", payload: ordersPaid });
    const r = await handleWebhook({
      shop: SHOP,
      topic: "orders/paid",
      webhookId: "w2",
      payload: ordersPaid,
    });
    expect(r.outcome).toBe("duplicate");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });

  it("mesmo pedido com evento diferente não é dedup", async () => {
    await handleWebhook({ shop: SHOP, topic: "orders/paid", webhookId: "w3", payload: ordersPaid });
    const r = await handleWebhook({
      shop: SHOP,
      topic: "orders/fulfilled",
      webhookId: "w4",
      payload: { ...ordersPaid, fulfillments: [{ id: 1 }] },
    });
    expect(r.outcome).toBe("dispatched");
  });

  it("pickup usa o flow de order_fulfilled quando ready_pickup não está mapeado", async () => {
    await handleWebhook({
      shop: SHOP,
      topic: "orders/fulfilled",
      webhookId: "w5",
      payload: ordersFulfilledPickup,
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.event).toBe("ready_pickup");
    expect(body.nextags.flow_id).toBe("222");
  });

  it("fulfillments/update entregue propaga rastreio", async () => {
    await handleWebhook({
      shop: SHOP,
      topic: "fulfillments/update",
      webhookId: "w6",
      payload: fulfillmentDelivered,
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.event).toBe("order_delivered");
    expect(body.order.tracking).toBe("BR123456789BR");
  });

  it("topic de catálogo só loga, não dispara", async () => {
    const r = await handleWebhook({
      shop: SHOP,
      topic: "products/update",
      webhookId: "w7",
      payload: { id: 1 },
    });
    expect(r.outcome).toBe("log_only");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
  });

  it("app/uninstalled marca a loja e não dispara", async () => {
    const r = await handleWebhook({
      shop: SHOP,
      topic: "app/uninstalled",
      webhookId: "w8",
      payload: {},
    });
    expect(r.outcome).toBe("uninstalled");
    const store = await prisma.store.findUnique({ where: { shopDomain: SHOP } });
    expect(store?.uninstalledAt).not.toBeNull();
    await prisma.store.update({ where: { shopDomain: SHOP }, data: { uninstalledAt: null } });
  });

  it("loja desabilitada é skipped", async () => {
    await prisma.storeConfig.update({ where: { shopDomain: SHOP }, data: { enabled: false } });
    const r = await handleWebhook({
      shop: SHOP,
      topic: "orders/paid",
      webhookId: "w9",
      payload: ordersPaid,
    });
    expect(r.outcome).toBe("skipped");
    const rows = await prisma.eventLog.findMany({ where: { shopDomain: SHOP } });
    expect(rows[0].dispatchStatus).toBe("skipped");
    await prisma.storeConfig.update({ where: { shopDomain: SHOP }, data: { enabled: true } });
  });

  it("sem telefone é skipped, não erro", async () => {
    const semTelefone = { ...ordersPaid, customer: { first_name: "X", last_name: "Y", phone: null } };
    const r = await handleWebhook({
      shop: SHOP,
      topic: "orders/paid",
      webhookId: "w10",
      payload: semTelefone,
    });
    expect(r.outcome).toBe("skipped");
  });

  it("falha de dispatch agenda retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await handleWebhook({ shop: SHOP, topic: "orders/paid", webhookId: "w11", payload: ordersPaid });
    const rows = await prisma.eventLog.findMany({ where: { shopDomain: SHOP } });
    expect(rows[0].dispatchStatus).toBe("retrying");
    expect(rows[0].nextAttemptAt).not.toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- tests/webhook-handler.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 4: Implementar o handler**

`app/lib/webhook-handler.server.ts`:

```ts
import { prisma } from "~/db.server";
import { decrypt } from "~/lib/crypto.server";
import { claimEvent, dedupKeyOrderStatus, dedupKeyWebhook } from "~/lib/dedup.server";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { logFailure, logSkipped, logStart, logSuccess } from "~/lib/eventlog.server";
import { mapTopic } from "~/lib/events";
import {
  buildCanonical,
  EmptyCufError,
  MissingFlowError,
  MissingPhoneError,
} from "~/lib/nextags/payload";

export type HandleArgs = {
  shop: string;
  topic: string;
  webhookId: string;
  payload: any;
};

export type Outcome =
  | "dispatched"
  | "duplicate"
  | "log_only"
  | "skipped"
  | "uninstalled"
  | "compliance"
  | "unknown";

function extrairPedido(topic: string, p: any) {
  if (topic.startsWith("fulfillments/")) {
    return {
      id: String(p.order_id ?? p.id),
      name: p.name ?? p.order_name ?? null,
      total: p.total_price ?? null,
      phone: p.destination?.phone ?? p.customer?.phone ?? null,
      customerName: [p.destination?.first_name, p.destination?.last_name]
        .filter(Boolean)
        .join(" ") || null,
      lineItems: p.line_items ?? null,
      tracking: p.tracking_number ?? null,
      trackingUrl: p.tracking_url ?? p.tracking_urls?.[0] ?? null,
    };
  }
  if (topic === "refunds/create") {
    return {
      id: String(p.order_id ?? p.id),
      name: p.order_name ?? null,
      total: p.total_price ?? null,
      phone: p.customer?.phone ?? null,
      customerName: [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ") || null,
      lineItems: p.refund_line_items?.map((r: any) => r.line_item) ?? null,
      tracking: null,
      trackingUrl: null,
    };
  }
  const fulfillment = (p.fulfillments ?? [])[0];
  return {
    id: String(p.id),
    name: p.name ?? null,
    total: p.total_price ?? p.current_total_price ?? null,
    phone: p.customer?.phone ?? p.phone ?? p.shipping_address?.phone ?? null,
    customerName:
      [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ") || null,
    lineItems: p.line_items ?? null,
    tracking: fulfillment?.tracking_number ?? null,
    trackingUrl: fulfillment?.tracking_url ?? fulfillment?.tracking_urls?.[0] ?? null,
  };
}

export async function handleWebhook(args: HandleArgs): Promise<{ outcome: Outcome }> {
  const { shop, topic, webhookId, payload } = args;
  const resultado = mapTopic(topic, payload);

  if (resultado.kind === "compliance") return { outcome: "compliance" };
  if (resultado.kind === "unknown") return { outcome: "unknown" };

  if (resultado.kind === "internal") {
    await prisma.store.updateMany({
      where: { shopDomain: shop },
      data: { uninstalledAt: new Date() },
    });
    await prisma.storeConfig.updateMany({ where: { shopDomain: shop }, data: { enabled: false } });
    await logSkipped({ shop, topic, motivo: "app desinstalado" });
    return { outcome: "uninstalled" };
  }

  if (!(await claimEvent(shop, dedupKeyWebhook(webhookId)))) return { outcome: "duplicate" };

  if (resultado.kind === "log_only") {
    await logSkipped({ shop, topic, motivo: "topic sem disparo em v1" });
    return { outcome: "log_only" };
  }

  const event = resultado.event;
  const pedido = extrairPedido(topic, payload);

  if (!(await claimEvent(shop, dedupKeyOrderStatus(pedido.id, event)))) {
    return { outcome: "duplicate" };
  }

  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  if (!cfg?.enabled || !cfg.nextagsTokenEnc) {
    await logSkipped({ shop, topic, event, shopifyId: pedido.id, motivo: "loja desabilitada ou sem token" });
    return { outcome: "skipped" };
  }

  let canonical;
  try {
    canonical = buildCanonical({
      shop,
      event,
      token: decrypt(cfg.nextagsTokenEnc),
      flowMap: cfg.flowMap as Record<string, string>,
      cufMap: cfg.cufMap as Record<string, string>,
      order: pedido,
    });
  } catch (e) {
    if (
      e instanceof MissingPhoneError ||
      e instanceof MissingFlowError ||
      e instanceof EmptyCufError
    ) {
      await logSkipped({
        shop,
        topic,
        event,
        shopifyId: pedido.id,
        motivo: `${e.constructor.name}: ${e.message}`,
      });
      return { outcome: "skipped" };
    }
    throw e;
  }

  const id = await logStart({ shop, topic, event, shopifyId: pedido.id, canonical });
  const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode);
  if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
  else await logFailure(id, `HTTP ${r.status} ${r.body}`, 1);

  return { outcome: "dispatched" };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- tests/webhook-handler.test.ts`
Expected: 11 passed

- [ ] **Step 6: Criar a rota**

`app/routes/webhooks.shopify.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { handleWebhook } from "~/lib/webhook-handler.server";
import { handleCompliance } from "~/lib/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook valida o HMAC e rejeita payload adulterado com 401.
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const normalizado = topic.toLowerCase().replace(/_/g, "/");

  try {
    if (normalizado.startsWith("customers/") || normalizado === "shop/redact") {
      await handleCompliance({ shop, topic: normalizado, payload });
      return new Response(null, { status: 200 });
    }
    await handleWebhook({ shop, topic: normalizado, webhookId, payload });
  } catch (e) {
    // 200 mesmo em erro interno: a Shopify desativa webhooks apos falhas repetidas.
    // O erro fica em event_log / logs da Vercel e o cron de retry reprocessa.
    console.error("webhook falhou", { shop, topic: normalizado, erro: (e as Error).message });
  }

  return new Response(null, { status: 200 });
};
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo passa (a rota importa `~/lib/compliance.server`, criado na Task 14 — se quebrar, seguir para a Task 14 e rodar de novo no fim dela)

- [ ] **Step 8: Commit**

```bash
git add app/lib/webhook-handler.server.ts app/routes/webhooks.shopify.tsx tests/webhook-handler.test.ts tests/fixtures
git commit -m "feat: receptor de webhooks com dedup, normalizacao e dispatch"
```

---

## Task 14: Webhooks de privacidade (GDPR)

**Files:**
- Create: `app/lib/compliance.server.ts`
- Create: `tests/compliance.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2)
- Produces: `handleCompliance(args: { shop: string; topic: string; payload: any }): Promise<void>`

Comportamento real, não stub: `customers/redact` apaga os dados do cliente que estejam em `event_log`; `shop/redact` apaga tudo da loja; `customers/data_request` registra o pedido (o app não armazena dados de cliente além do log).

- [ ] **Step 1: Escrever o teste que falha**

`tests/compliance.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { handleCompliance } from "~/lib/compliance.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "gdpr-test.myshopify.com";

beforeEach(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.eventDedup.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.create({
    data: { shopDomain: SHOP, apiVersion: "test", config: { create: {} } },
  });
});

afterAll(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("handleCompliance", () => {
  it("data_request registra o pedido no log", async () => {
    await handleCompliance({
      shop: SHOP,
      topic: "customers/data_request",
      payload: { customer: { id: 42 } },
    });
    const rows = await prisma.eventLog.findMany({ where: { shopDomain: SHOP } });
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe("customers/data_request");
    expect(rows[0].dispatchStatus).toBe("skipped");
  });

  it("customers/redact apaga os eventos daquele pedido", async () => {
    await prisma.eventLog.create({
      data: {
        shopDomain: SHOP,
        topic: "orders/paid",
        shopifyId: "9001",
        dispatchStatus: "ok",
        canonical: { customer: { phone: "5519999999999" } } as any,
      },
    });
    await handleCompliance({
      shop: SHOP,
      topic: "customers/redact",
      payload: { customer: { id: 42 }, orders_to_redact: [9001] },
    });
    const restantes = await prisma.eventLog.findMany({
      where: { shopDomain: SHOP, shopifyId: "9001" },
    });
    expect(restantes).toHaveLength(0);
  });

  it("shop/redact apaga a loja e tudo em cascata", async () => {
    await prisma.eventLog.create({
      data: { shopDomain: SHOP, topic: "orders/paid", dispatchStatus: "ok" },
    });
    await handleCompliance({ shop: SHOP, topic: "shop/redact", payload: {} });
    expect(await prisma.store.findUnique({ where: { shopDomain: SHOP } })).toBeNull();
    expect(await prisma.eventLog.count({ where: { shopDomain: SHOP } })).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/compliance.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

`app/lib/compliance.server.ts`:

```ts
import { prisma } from "~/db.server";

export async function handleCompliance(args: {
  shop: string;
  topic: string;
  payload: any;
}): Promise<void> {
  const { shop, topic, payload } = args;

  if (topic === "shop/redact") {
    await prisma.eventLog.deleteMany({ where: { shopDomain: shop } });
    await prisma.eventDedup.deleteMany({ where: { shopDomain: shop } });
    await prisma.flowCache.deleteMany({ where: { shopDomain: shop } });
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.store.deleteMany({ where: { shopDomain: shop } });
    return;
  }

  if (topic === "customers/redact") {
    const ids: string[] = (payload?.orders_to_redact ?? []).map(String);
    if (ids.length) {
      await prisma.eventLog.deleteMany({ where: { shopDomain: shop, shopifyId: { in: ids } } });
    }
    await prisma.eventLog.create({
      data: {
        shopDomain: shop,
        topic,
        dispatchStatus: "skipped",
        nextagsResponse: `redigidos: ${ids.length} evento(s)`,
      },
    });
    return;
  }

  // customers/data_request: o app nao guarda dados de cliente alem do event_log.
  await prisma.eventLog.create({
    data: {
      shopDomain: shop,
      topic,
      dispatchStatus: "skipped",
      nextagsResponse: "pedido de dados registrado; nenhum dado de cliente armazenado fora do log",
    },
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/compliance.test.ts && npm test`
Expected: 3 passed no arquivo, suíte inteira verde

- [ ] **Step 5: Commit**

```bash
git add app/lib/compliance.server.ts tests/compliance.test.ts
git commit -m "feat: handlers de privacidade GDPR com redacao real de dados"
```

---

## Task 15: Crons — carrinho abandonado e retry

**Files:**
- Create: `app/lib/abandoned.server.ts`
- Create: `app/routes/api.cron.abandoned-checkouts.tsx`
- Create: `app/routes/api.cron.retry-dispatch.tsx`
- Create: `app/lib/cron-auth.server.ts`
- Create: `vercel.json`
- Create: `tests/abandoned.test.ts`
- Create: `tests/cron-auth.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 10, 11
- Produces:
  - `elegivelParaDisparo(checkout, agora): { ok: true } | { ok: false; motivo: string }`
  - `assertCron(request: Request): void`
  - `ABANDONED_QUERY: string`

Guards: idade entre 1h e 48h, `completedAt` nulo (não converteu), telefone presente. Dedup por `cart:{checkoutId}`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/abandoned.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { elegivelParaDisparo, ABANDONED_QUERY } from "~/lib/abandoned.server";

const agora = new Date("2026-08-27T12:00:00Z");
const hAtras = (h: number) => new Date(agora.getTime() - h * 3600_000).toISOString();

const base = {
  id: "gid://shopify/AbandonedCheckout/1",
  createdAt: hAtras(3),
  completedAt: null as string | null,
  customer: { phone: "19955556666" },
};

describe("elegivelParaDisparo", () => {
  it("aceita carrinho de 3h não convertido com telefone", () => {
    expect(elegivelParaDisparo(base, agora)).toEqual({ ok: true });
  });

  it("recusa mais novo que 1h", () => {
    const r = elegivelParaDisparo({ ...base, createdAt: hAtras(0.5) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).motivo).toMatch(/recente/i);
  });

  it("recusa mais velho que 48h", () => {
    const r = elegivelParaDisparo({ ...base, createdAt: hAtras(60) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).motivo).toMatch(/antigo/i);
  });

  it("recusa carrinho convertido", () => {
    const r = elegivelParaDisparo({ ...base, completedAt: hAtras(1) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).motivo).toMatch(/convertid/i);
  });

  it("recusa sem telefone utilizável", () => {
    const r = elegivelParaDisparo({ ...base, customer: { phone: "123" } }, agora);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).motivo).toMatch(/telefone/i);
  });
});

describe("ABANDONED_QUERY", () => {
  it("pede os campos que os guards usam", () => {
    for (const campo of ["createdAt", "completedAt", "phone", "abandonedCheckoutUrl"]) {
      expect(ABANDONED_QUERY).toContain(campo);
    }
  });
});
```

`tests/cron-auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertCron } from "~/lib/cron-auth.server";

const req = (auth?: string) =>
  new Request("https://app.test/api/cron/x", {
    headers: auth ? { Authorization: auth } : {},
  });

describe("assertCron", () => {
  it("aceita o secret correto", () => {
    expect(() => assertCron(req(`Bearer ${process.env.CRON_SECRET}`))).not.toThrow();
  });

  it("rejeita secret errado ou ausente", () => {
    expect(() => assertCron(req("Bearer errado"))).toThrow();
    expect(() => assertCron(req())).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/abandoned.test.ts tests/cron-auth.test.ts`
Expected: FAIL — módulos não encontrados

- [ ] **Step 3: Implementar os guards e a auth de cron**

`app/lib/cron-auth.server.ts`:

```ts
export function assertCron(request: Request): void {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) throw new Response("CRON_SECRET ausente", { status: 500 });
  if (request.headers.get("Authorization") !== `Bearer ${esperado}`) {
    throw new Response("não autorizado", { status: 401 });
  }
}
```

`app/lib/abandoned.server.ts`:

```ts
import { normalizarTelefoneBR } from "~/lib/phone";

export const MIN_IDADE_MS = 3600_000; // 1h
export const MAX_IDADE_MS = 48 * 3600_000; // 48h

// Campos a confirmar na versao fixada da API (Task 12, Step 5). [Provável]
export const ABANDONED_QUERY = `
  query AbandonedCheckouts($first: Int!) {
    abandonedCheckouts(first: $first, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          createdAt
          completedAt
          abandonedCheckoutUrl
          totalPriceSet { shopMoney { amount } }
          customer { firstName lastName phone }
          lineItems(first: 20) {
            edges { node { title quantity originalUnitPriceSet { shopMoney { amount } } } }
          }
        }
      }
    }
  }
`;

type Checkout = {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  customer?: { phone?: string | null } | null;
};

export function elegivelParaDisparo(
  c: Checkout,
  agora: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (c.completedAt) return { ok: false, motivo: "carrinho já convertido em pedido" };

  const idade = agora.getTime() - new Date(c.createdAt).getTime();
  if (idade < MIN_IDADE_MS) return { ok: false, motivo: "carrinho recente (<1h)" };
  if (idade > MAX_IDADE_MS) return { ok: false, motivo: "carrinho antigo (>48h)" };

  if (!normalizarTelefoneBR(c.customer?.phone)) {
    return { ok: false, motivo: "sem telefone utilizável" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/abandoned.test.ts tests/cron-auth.test.ts`
Expected: 7 passed

- [ ] **Step 5: Criar as rotas de cron**

`app/routes/api.cron.abandoned-checkouts.tsx`:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/db.server";
import { unauthenticated } from "~/shopify.server";
import { assertCron } from "~/lib/cron-auth.server";
import { ABANDONED_QUERY, elegivelParaDisparo } from "~/lib/abandoned.server";
import { claimEvent, dedupKeyCart } from "~/lib/dedup.server";
import { decrypt } from "~/lib/crypto.server";
import { buildCanonical } from "~/lib/nextags/payload";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { logFailure, logSkipped, logStart, logSuccess } from "~/lib/eventlog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertCron(request);
  const agora = new Date();
  const resumo = { lojas: 0, candidatos: 0, disparados: 0, ignorados: 0 };

  const lojas = await prisma.store.findMany({
    where: { uninstalledAt: null, config: { enabled: true } },
    include: { config: true },
  });

  for (const loja of lojas) {
    resumo.lojas++;
    const cfg = loja.config!;
    if (!cfg.nextagsTokenEnc) continue;

    const { admin } = await unauthenticated.admin(loja.shopDomain);
    const res = await admin.graphql(ABANDONED_QUERY, { variables: { first: 50 } });
    const json: any = await res.json();
    const nodes: any[] = (json.data?.abandonedCheckouts?.edges ?? []).map((e: any) => e.node);

    for (const c of nodes) {
      resumo.candidatos++;
      const elegivel = elegivelParaDisparo(c, agora);
      if (!elegivel.ok) {
        resumo.ignorados++;
        continue;
      }
      if (!(await claimEvent(loja.shopDomain, dedupKeyCart(c.id)))) {
        resumo.ignorados++;
        continue;
      }

      let canonical;
      try {
        canonical = buildCanonical({
          shop: loja.shopDomain,
          event: "abandoned_cart",
          token: decrypt(cfg.nextagsTokenEnc),
          flowMap: cfg.flowMap as Record<string, string>,
          cufMap: cfg.cufMap as Record<string, string>,
          order: {
            id: c.id,
            name: null,
            total: c.totalPriceSet?.shopMoney?.amount ?? null,
            phone: c.customer?.phone ?? null,
            customerName: [c.customer?.firstName, c.customer?.lastName]
              .filter(Boolean)
              .join(" ") || null,
            lineItems: (c.lineItems?.edges ?? []).map((e: any) => ({
              title: e.node.title,
              quantity: e.node.quantity,
              price: e.node.originalUnitPriceSet?.shopMoney?.amount,
            })),
            tracking: c.abandonedCheckoutUrl ?? null,
            trackingUrl: c.abandonedCheckoutUrl ?? null,
          },
        });
      } catch (e) {
        resumo.ignorados++;
        await logSkipped({
          shop: loja.shopDomain,
          topic: "cron/abandoned",
          event: "abandoned_cart",
          shopifyId: c.id,
          motivo: (e as Error).message,
        });
        continue;
      }

      const id = await logStart({
        shop: loja.shopDomain,
        topic: "cron/abandoned",
        event: "abandoned_cart",
        shopifyId: c.id,
        canonical,
      });
      const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode);
      if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
      else await logFailure(id, `HTTP ${r.status} ${r.body}`, 1);
      resumo.disparados++;

      // Anti-429: NexTags tem rate limit. Um item por vez, com intervalo.
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return Response.json(resumo);
};
```

`app/routes/api.cron.retry-dispatch.tsx`:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/db.server";
import { assertCron } from "~/lib/cron-auth.server";
import { decrypt } from "~/lib/crypto.server";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { dueForRetry, logFailure, logSuccess } from "~/lib/eventlog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertCron(request);
  const pendentes = await dueForRetry(25);
  const resumo = { tentados: 0, ok: 0, falhos: 0 };

  for (const row of pendentes) {
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: row.shopDomain } });
    if (!cfg?.enabled || !cfg.nextagsTokenEnc || !row.canonical) {
      await logFailure(row.id, "loja desabilitada ou payload ausente", 99);
      continue;
    }
    resumo.tentados++;

    // canonical foi gravado com o token redigido; reinjeta o token atual da loja.
    const payload = {
      ...(row.canonical as any),
      nextags: { ...(row.canonical as any).nextags, token: decrypt(cfg.nextagsTokenEnc) },
    };

    const r = await dispatch(payload, cfg.dispatchMode as DispatchMode);
    if (r.ok) {
      await logSuccess(row.id, `retry HTTP ${r.status} ${r.body}`);
      resumo.ok++;
    } else {
      await logFailure(row.id, `retry HTTP ${r.status} ${r.body}`, row.attempts + 1);
      resumo.falhos++;
    }
  }

  return Response.json(resumo);
};
```

- [ ] **Step 6: Registrar os crons**

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/abandoned-checkouts", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/retry-dispatch", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde

- [ ] **Step 8: Commit**

```bash
git add app/lib/abandoned.server.ts app/lib/cron-auth.server.ts app/routes/api.cron.*.tsx vercel.json tests/abandoned.test.ts tests/cron-auth.test.ts
git commit -m "feat: cron de carrinho abandonado com guards e cron de retry de dispatch"
```

---

## Task 16: Tela embedded

**Files:**
- Create: `app/lib/config-service.server.ts`
- Create: `app/routes/app._index.tsx`
- Create: `tests/config-service.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 8, 9, 10, 11
- Produces:
  - `salvarToken(shop, token): Promise<{ ok: boolean; message?: string; flows?: Flow[] }>`
  - `salvarFlowMap(shop, flowMap): Promise<void>`
  - `carregarPainel(shop): Promise<PainelData>`
  - `dispararTeste(shop, event, phone): Promise<{ ok: boolean; detalhe: string }>`

Quatro blocos na UI: conexão NexTags (com o texto de ajuda literal), mapeamento de flows, teste de disparo, status.

- [ ] **Step 1: Escrever o teste que falha**

`tests/config-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  carregarPainel,
  dispararTeste,
  salvarFlowMap,
  salvarToken,
} from "~/lib/config-service.server";
import { decrypt } from "~/lib/crypto.server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "ui-test.myshopify.com";

beforeEach(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.flowCache.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.create({
    data: { shopDomain: SHOP, apiVersion: "test", config: { create: {} } },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("salvarToken", () => {
  it("token válido é cifrado e os flows entram em cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 7, name: "Pago" }] }), { status: 200 }),
      ),
    );
    const r = await salvarToken(SHOP, "tok-novo");
    expect(r.ok).toBe(true);
    expect(r.flows).toEqual([{ flow_id: "7", flow_name: "Pago" }]);

    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.nextagsTokenEnc).not.toBe("tok-novo");
    expect(decrypt(cfg!.nextagsTokenEnc!)).toBe("tok-novo");

    const cache = await prisma.flowCache.findMany({ where: { shopDomain: SHOP } });
    expect(cache).toHaveLength(1);
  });

  it("token inválido não é gravado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    const r = await salvarToken(SHOP, "ruim");
    expect(r.ok).toBe(false);
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.nextagsTokenEnc).toBeNull();
  });
});

describe("salvarFlowMap", () => {
  it("grava o mapa e habilita a loja quando há flow de pedido pago", async () => {
    await salvarFlowMap(SHOP, { order_paid: "111" });
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.flowMap).toMatchObject({ order_paid: "111" });
    expect(cfg?.enabled).toBe(true);
  });

  it("mapa vazio mantém a loja desabilitada", async () => {
    await salvarFlowMap(SHOP, {});
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.enabled).toBe(false);
  });
});

describe("carregarPainel", () => {
  it("nunca devolve o token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await salvarToken(SHOP, "tok-secreto");
    const p = await carregarPainel(SHOP);
    expect(JSON.stringify(p)).not.toContain("tok-secreto");
    expect(p.tokenConfigurado).toBe(true);
  });

  it("devolve os últimos eventos", async () => {
    await prisma.eventLog.create({
      data: { shopDomain: SHOP, topic: "orders/paid", dispatchStatus: "ok" },
    });
    const p = await carregarPainel(SHOP);
    expect(p.eventos).toHaveLength(1);
  });
});

describe("dispararTeste", () => {
  it("dispara e reporta o resultado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await salvarToken(SHOP, "tok");
    await salvarFlowMap(SHOP, { order_paid: "111" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"success":true}', { status: 200 })));
    const r = await dispararTeste(SHOP, "order_paid", "19955556666");
    expect(r.ok).toBe(true);
    expect(r.detalhe).toMatch(/200/);
  });

  it("telefone inválido falha antes de chamar a rede", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const r = await dispararTeste(SHOP, "order_paid", "123");
    expect(r.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/config-service.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar o serviço**

`app/lib/config-service.server.ts`:

```ts
import { prisma } from "~/db.server";
import { decrypt, encrypt } from "~/lib/crypto.server";
import { listFlows, validateToken } from "~/lib/nextags/client.server";
import { buildCanonical } from "~/lib/nextags/payload";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { logFailure, logStart, logSuccess } from "~/lib/eventlog.server";
import type { CanonicalEvent } from "~/lib/events";

export type Flow = { flow_id: string; flow_name: string };

export const CUF_DEFAULT: Record<string, string> = {
  numero: "NumeroPedidoSHP",
  status: "StatusPedidoSHP",
  total: "TotalPedidoSHP",
  rastreio: "RastreioPedidoSHP",
  rastreio_url: "RastreioUrlSHP",
  itens: "ItensPedidoSHP",
};

export async function salvarToken(
  shop: string,
  token: string,
): Promise<{ ok: boolean; message?: string; flows?: Flow[] }> {
  const v = await validateToken(token);
  if (!v.ok) return { ok: false, message: v.message };

  let flows: Flow[] = [];
  try {
    flows = await listFlows(token);
  } catch {
    flows = []; // degrada para input manual
  }

  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      nextagsTokenEnc: encrypt(token),
      cufMap: CUF_DEFAULT,
    },
  });

  await prisma.flowCache.deleteMany({ where: { shopDomain: shop } });
  if (flows.length) {
    await prisma.flowCache.createMany({
      data: flows.map((f) => ({ shopDomain: shop, flowId: f.flow_id, flowName: f.flow_name })),
    });
  }

  return { ok: true, flows };
}

export async function salvarFlowMap(
  shop: string,
  flowMap: Record<string, string>,
): Promise<void> {
  const limpo = Object.fromEntries(
    Object.entries(flowMap).filter(([, v]) => String(v ?? "").trim() !== ""),
  );
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      flowMap: limpo,
      enabled: Boolean(limpo.order_paid) && Boolean(cfg?.nextagsTokenEnc),
    },
  });
}

export type PainelData = {
  tokenConfigurado: boolean;
  enabled: boolean;
  dispatchMode: string;
  flowMap: Record<string, string>;
  flows: Flow[];
  eventos: { id: string; topic: string; event: string | null; status: string; quando: string }[];
};

export async function carregarPainel(shop: string): Promise<PainelData> {
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  const flows = await prisma.flowCache.findMany({
    where: { shopDomain: shop },
    orderBy: { flowName: "asc" },
  });
  const eventos = await prisma.eventLog.findMany({
    where: { shopDomain: shop },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    tokenConfigurado: Boolean(cfg?.nextagsTokenEnc),
    enabled: Boolean(cfg?.enabled),
    dispatchMode: cfg?.dispatchMode ?? "n8n",
    flowMap: (cfg?.flowMap ?? {}) as Record<string, string>,
    flows: flows.map((f) => ({ flow_id: f.flowId, flow_name: f.flowName })),
    eventos: eventos.map((e) => ({
      id: String(e.id),
      topic: e.topic,
      event: e.event,
      status: e.dispatchStatus,
      quando: e.createdAt.toISOString(),
    })),
  };
}

export async function dispararTeste(
  shop: string,
  event: CanonicalEvent,
  phone: string,
): Promise<{ ok: boolean; detalhe: string }> {
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  if (!cfg?.nextagsTokenEnc) return { ok: false, detalhe: "conecte a chave NexTags primeiro" };

  let canonical;
  try {
    canonical = buildCanonical({
      shop,
      event,
      token: decrypt(cfg.nextagsTokenEnc),
      flowMap: cfg.flowMap as Record<string, string>,
      cufMap: cfg.cufMap as Record<string, string>,
      order: {
        id: `teste-${Date.now()}`,
        name: "#TESTE",
        total: "1.00",
        phone,
        customerName: "Teste NexTags",
        lineItems: [{ title: "Produto de teste", quantity: 1, price: "1.00" }],
        tracking: "TESTE123",
        trackingUrl: "https://exemplo.test/TESTE123",
      },
    });
  } catch (e) {
    return { ok: false, detalhe: (e as Error).message };
  }

  const id = await logStart({ shop, topic: "ui/teste", event, canonical });
  const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode, 5000);
  if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
  else await logFailure(id, `HTTP ${r.status} ${r.body}`, 99);

  return {
    ok: r.ok,
    detalhe: `HTTP ${r.status} — ${r.body.slice(0, 200)}. Confirme o recebimento no WhatsApp: resposta de sucesso da API não prova entrega.`,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/config-service.test.ts`
Expected: 8 passed

- [ ] **Step 5: Implementar a rota da UI**

`app/routes/app._index.tsx`:

```tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import {
  Badge,
  BlockStack,
  Banner,
  Button,
  Card,
  DataTable,
  FormLayout,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import {
  carregarPainel,
  dispararTeste,
  salvarFlowMap,
  salvarToken,
} from "~/lib/config-service.server";
import type { CanonicalEvent } from "~/lib/events";

const EVENTOS: { key: CanonicalEvent; label: string }[] = [
  { key: "order_paid", label: "Pedido pago" },
  { key: "order_fulfilled", label: "Pedido enviado" },
  { key: "ready_pickup", label: "Pronto para retirada" },
  { key: "order_delivered", label: "Pedido entregue" },
  { key: "order_cancelled", label: "Pedido cancelado" },
  { key: "abandoned_cart", label: "Carrinho abandonado" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return Response.json(await carregarPainel(session.shop));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "token") {
    return Response.json(await salvarToken(session.shop, String(form.get("token") ?? "").trim()));
  }
  if (intent === "flows") {
    const flowMap: Record<string, string> = {};
    for (const e of EVENTOS) flowMap[e.key] = String(form.get(e.key) ?? "");
    await salvarFlowMap(session.shop, flowMap);
    return Response.json({ ok: true });
  }
  if (intent === "teste") {
    return Response.json(
      await dispararTeste(
        session.shop,
        String(form.get("event")) as CanonicalEvent,
        String(form.get("phone") ?? ""),
      ),
    );
  }
  return Response.json({ ok: false, message: "intent desconhecida" }, { status: 400 });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const tokenFetcher = useFetcher<any>();
  const flowsFetcher = useFetcher<any>();
  const testeFetcher = useFetcher<any>();

  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [evento, setEvento] = useState<CanonicalEvent>("order_paid");
  // flowMap precisa de estado local: campo controlado sem onChange real nao deixa o
  // lojista trocar a selecao.
  const [flowMap, setFlowMap] = useState<Record<string, string>>(data.flowMap ?? {});
  const setFlow = (key: string, value: string) =>
    setFlowMap((atual) => ({ ...atual, [key]: value }));

  const opcoesFlow = [
    { label: "— não notificar —", value: "" },
    ...data.flows.map((f) => ({ label: `${f.flow_name} (${f.flow_id})`, value: f.flow_id })),
  ];

  return (
    <Page title="NexTags">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Conexão NexTags</Text>
              <Text as="p" tone="subdued">
                Para pegar a chave na NexTags: Configurações → Integrações → Chave de API do
                NexTags AI. Gere a chave caso ainda não tenha, copie o valor e cole aqui.
              </Text>
              {data.tokenConfigurado && <Badge tone="success">Chave configurada</Badge>}
              {tokenFetcher.data && !tokenFetcher.data.ok && (
                <Banner tone="critical">{tokenFetcher.data.message}</Banner>
              )}
              <tokenFetcher.Form method="post">
                <input type="hidden" name="intent" value="token" />
                <FormLayout>
                  <TextField
                    label="Chave de API"
                    name="token"
                    value={token}
                    onChange={setToken}
                    autoComplete="off"
                    type="password"
                  />
                  <Button submit variant="primary" loading={tokenFetcher.state !== "idle"}>
                    Salvar e validar
                  </Button>
                </FormLayout>
              </tokenFetcher.Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Notificações por evento</Text>
              {data.flows.length === 0 && data.tokenConfigurado && (
                <Banner tone="warning">
                  Não foi possível listar os flows da sua conta. Cole o ID do flow manualmente e
                  use o teste de disparo para confirmar — um ID errado falha em silêncio.
                </Banner>
              )}
              <flowsFetcher.Form method="post">
                <input type="hidden" name="intent" value="flows" />
                <FormLayout>
                  {EVENTOS.map((e) =>
                    data.flows.length ? (
                      <Select
                        key={e.key}
                        label={e.label}
                        name={e.key}
                        options={opcoesFlow}
                        value={flowMap[e.key] ?? ""}
                        onChange={(v) => setFlow(e.key, v)}
                      />
                    ) : (
                      <TextField
                        key={e.key}
                        label={`${e.label} — ID do flow`}
                        name={e.key}
                        value={flowMap[e.key] ?? ""}
                        onChange={(v) => setFlow(e.key, v)}
                        autoComplete="off"
                      />
                    ),
                  )}
                  <Button submit variant="primary" loading={flowsFetcher.state !== "idle"}>
                    Salvar notificações
                  </Button>
                </FormLayout>
              </flowsFetcher.Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Teste de disparo</Text>
              {testeFetcher.data && (
                <Banner tone={testeFetcher.data.ok ? "success" : "critical"}>
                  {testeFetcher.data.detalhe}
                </Banner>
              )}
              <testeFetcher.Form method="post">
                <input type="hidden" name="intent" value="teste" />
                <FormLayout>
                  <Select
                    label="Evento"
                    name="event"
                    options={EVENTOS.map((e) => ({ label: e.label, value: e.key }))}
                    value={evento}
                    onChange={(v) => setEvento(v as CanonicalEvent)}
                  />
                  <TextField
                    label="WhatsApp de teste"
                    name="phone"
                    value={phone}
                    onChange={setPhone}
                    autoComplete="off"
                    helpText="Ex.: 19955556666"
                  />
                  <Button submit loading={testeFetcher.state !== "idle"}>Disparar teste</Button>
                </FormLayout>
              </testeFetcher.Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Status</Text>
              <Badge tone={data.enabled ? "success" : "attention"}>
                {data.enabled ? "Notificações ativas" : "Notificações inativas"}
              </Badge>
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["Quando", "Topic", "Evento", "Resultado"]}
                rows={data.eventos.map((e) => [e.quando, e.topic, e.event ?? "—", e.status])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

- [ ] **Step 6: Rodar a suíte e o typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: testes verdes, sem erro de tipo

- [ ] **Step 7: Commit**

```bash
git add app/lib/config-service.server.ts app/routes/app._index.tsx tests/config-service.test.ts
git commit -m "feat: tela embedded com conexao, mapeamento de flows, teste e status"
```

---

## Task 17: Deploy e E2E na dev store

**Files:**
- Modify: `shopify.app.toml` (URLs de produção)
- Create: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: todas as tasks anteriores
- Produces: app rodando na Vercel, webhooks registrados, evidência de E2E

Depende dos pré-requisitos 1, 3, 4, 5, 6.

- [ ] **Step 1: Criar o app no Partner Dashboard e linkar**

```bash
npm run shopify -- app config link
```

Anotar `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. **Não** comitar.

- [ ] **Step 2: Configurar env vars na Vercel**

Setar em Production e Preview: `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `ENCRYPTION_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `NEXTAGS_API_BASE`, `CRON_SECRET`, `DISPATCH_MODE_DEFAULT=n8n`.

Gerar a chave de criptografia localmente e colar só na Vercel:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- [ ] **Step 3: Deploy e migração**

```bash
npx vercel --prod
npx prisma migrate deploy   # com DATABASE_URL de produção
npm run shopify -- app deploy
```

- [ ] **Step 4: Criar o workflow n8n multi-tenant**

Um único workflow `Shopify → NexTags`:
1. Webhook node na URL de `N8N_WEBHOOK_URL`, validando o header `X-Webhook-Secret`.
2. Switch por `{{$json.event}}`.
3. HTTP Request `POST {{$json.nextags.token ? NEXTAGS_API_BASE : ''}}/api/contacts` com header `X-ACCESS-TOKEN: {{$json.nextags.token}}`, `specifyBody: 'json'`, `jsonBody` montando `actions[]` com todos os `set_field_value` **antes** do `send_flow`.
4. `retryOnFail: true`, `waitBetweenTries: 5000`, `onError: continueErrorOutput`.

- [ ] **Step 5: Instalar na dev store**

Abrir a URL de instalação, autorizar, colar a chave da conta **NexTags Ajuda**, mapear os flows.

- [ ] **Step 6: Verificar registro de webhooks**

```bash
npm run shopify -- app webhook trigger --topic=orders/paid --address=https://<app>.vercel.app/webhooks/shopify --api-version=<versão>
```

Conferir na tela de Status que o evento apareceu.

- [ ] **Step 7: E2E de verdade**

Na dev store, para cada um dos 5 eventos: criar/alterar pedido de teste → conferir na tela de Status → **conferir a mensagem chegando no WhatsApp**. Registrar em `docs/RUNBOOK.md` qual evento foi validado, quando, e o `flow_id` usado.

- [ ] **Step 8: Testar carrinho abandonado**

Iniciar checkout na dev store sem concluir. Esperar >1h. Chamar o cron manualmente:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/abandoned-checkouts
```

Conferir mensagem no WhatsApp e o resumo retornado.

- [ ] **Step 9: Testar desinstalação**

Desinstalar o app na dev store → conferir `stores.uninstalled_at` preenchido e `store_config.enabled = false`.

- [ ] **Step 10: Escrever o runbook**

`docs/RUNBOOK.md` com: env vars e onde vivem, como rodar migração, como ler `event_log` para diagnosticar disparo que não chegou, como trocar uma loja para `dispatch_mode=direct`, o que fazer se o n8n cair, como rotacionar `ENCRYPTION_KEY` (re-cifrar tokens), e a matriz de eventos validados em E2E.

- [ ] **Step 11: Commit**

```bash
git add shopify.app.toml docs/RUNBOOK.md
git commit -m "chore: configura URLs de producao e documenta runbook operacional"
```

---

## Task 18: Submissão à App Store

**Files:**
- Create: `docs/APP_STORE.md`
- Create: `docs/PRIVACY.md`

**Interfaces:**
- Consumes: Task 17 (app publicado e validado em E2E)
- Produces: submissão enviada

- [ ] **Step 1: Confirmar Protected Customer Data aprovado**

Sem aprovação, `customer.phone` chega vazio e **nada funciona**. Verificar o status no Partner Dashboard. Se pendente, não submeter.

- [ ] **Step 2: Publicar a política de privacidade**

`docs/PRIVACY.md` e uma URL pública com: quais dados são coletados (telefone, nome, dados do pedido), finalidade (notificação transacional pedida pelo lojista), onde ficam (Postgres na Neon, cifrados quando sensíveis), prazo de retenção do `event_log`, como pedir exclusão, e o compartilhamento com a NexTags como subprocessador.

- [ ] **Step 3: Testar os 3 webhooks de privacidade**

```bash
npm run shopify -- app webhook trigger --topic=customers/data_request --address=https://<app>.vercel.app/webhooks/shopify
npm run shopify -- app webhook trigger --topic=customers/redact --address=https://<app>.vercel.app/webhooks/shopify
npm run shopify -- app webhook trigger --topic=shop/redact --address=https://<app>.vercel.app/webhooks/shopify
```

Cada um deve responder 200 e deixar registro em `event_log`.

- [ ] **Step 4: Preparar os assets da listagem**

Ícone, screenshots da tela embedded (4 blocos), descrição em pt-BR e en, categoria, URL de suporte, URL da política de privacidade.

- [ ] **Step 5: Preparar as instruções de review**

`docs/APP_STORE.md` com: credenciais da conta **NexTags Ajuda**, passo a passo do reviewer (instalar → colar chave → mapear flows → disparar teste), aviso de que o app exige conta NexTags (serviço externo, sem cobrança pelo app), e justificativa do uso de Protected Customer Data.

- [ ] **Step 6: Checklist final antes de submeter**

- [ ] app instala e desinstala sem erro na dev store
- [ ] os 5 eventos validados com mensagem recebida no WhatsApp
- [ ] carrinho abandonado validado
- [ ] 3 webhooks de privacidade respondendo 200
- [ ] `app/uninstalled` tratado
- [ ] UI embedded com App Bridge + Polaris web components, sem erro de console
- [ ] versão de API dentro da janela de suporte
- [ ] nenhum secret no git (`git log -p | grep -iE "shpss_|shpat_|ENCRYPTION_KEY="` vazio)
- [ ] política de privacidade pública e acessível
- [ ] Protected Customer Data aprovado

- [ ] **Step 7: Submeter e commitar a documentação**

```bash
git add docs/APP_STORE.md docs/PRIVACY.md
git commit -m "docs: material de submissao para a Shopify App Store"
```

---

## Ordem de execução e paralelismo

- **Sequencial obrigatório:** 1 → 2 → (3..11 em qualquer ordem) → 12 → 13 → 14 → 15 → 16 → 17 → 18
- **Paralelizáveis após a Task 2:** 3, 4, 5, 6, 7, 8 (puras/mockadas), 9, 10, 11
- **Bloqueio externo:** Protected Customer Data (pré-requisito 2) precisa ser solicitado **hoje** — bloqueia a Task 18, não as anteriores.
- **Questão aberta que não bloqueia:** `N8N_WEBHOOK_URL` só é necessária na Task 17; até lá o dispatcher roda mockado nos testes.
