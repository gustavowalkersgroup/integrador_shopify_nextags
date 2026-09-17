import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { handleWebhook } from "~/lib/webhook-handler.server";
import { loader as retryLoader } from "~/routes/api.cron.retry-dispatch";
import { encrypt } from "~/lib/crypto.server";
import ordersPaid from "./fixtures/orders-paid.json";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});

// Loja cujo token nao abre: simula ENCRYPTION_KEY rotacionada sem
// re-encriptar os tokens, ou valor truncado no banco. `decrypt` lanca.
const QUEBRADA = "wh-token-quebrado.myshopify.com";
const SADIA = "wh-token-ok.myshopify.com";

const configBase = {
  enabled: true,
  dispatchMode: "n8n",
  flowMap: { order_paid: "111" },
  cufMap: { numero: "NumeroPedidoSHP", status: "StatusPedidoSHP" },
};

beforeAll(async () => {
  await prisma.store.create({
    data: {
      shopDomain: QUEBRADA,
      apiVersion: "test",
      config: { create: { ...configBase, nextagsTokenEnc: "isto-nao-e-ciphertext" } },
    },
  });
  await prisma.store.create({
    data: {
      shopDomain: SADIA,
      apiVersion: "test",
      config: { create: { ...configBase, nextagsTokenEnc: encrypt("tok-ok") } },
    },
  });
});

afterAll(async () => {
  for (const shop of [QUEBRADA, SADIA]) {
    await prisma.eventLog.deleteMany({ where: { shopDomain: shop } });
    await prisma.eventDedup.deleteMany({ where: { shopDomain: shop } });
    await prisma.store.delete({ where: { shopDomain: shop } });
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  for (const shop of [QUEBRADA, SADIA]) {
    await prisma.eventLog.deleteMany({ where: { shopDomain: shop } });
    await prisma.eventDedup.deleteMany({ where: { shopDomain: shop } });
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("excecao entre o dedup e o logStart nao pode perder o pedido", () => {
  // O dedup e reivindicado antes do logStart. A rota responde 200 mesmo em
  // erro (senao a Shopify desativa o webhook), entao a Shopify nao reentrega
  // — e uma reentrega bateria no dedup consumido. Antes deste fix a excecao
  // subia ate a rota, que so fazia console.error: zero linha em event_log,
  // pedido perdido sem rastro na tela de Status.
  it("registra a falha em event_log em vez de deixar o evento sumir", async () => {
    const r = await handleWebhook({
      shop: QUEBRADA,
      topic: "orders/paid",
      webhookId: "perda-1",
      payload: ordersPaid,
    });

    expect(r.outcome).toBe("failed");

    const rows = await prisma.eventLog.findMany({ where: { shopDomain: QUEBRADA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatchStatus).toBe("failed");
    expect(rows[0].nextagsResponse).toMatch(/excecao antes do dispatch/i);
  });

  it("nao lanca para fora do handler", async () => {
    await expect(
      handleWebhook({
        shop: QUEBRADA,
        topic: "orders/paid",
        webhookId: "perda-2",
        payload: ordersPaid,
      }),
    ).resolves.toBeDefined();
  });
});

describe("cron de retry: uma loja com token ilegivel nao pode travar o lote", () => {
  // O `decrypt` ficava FORA do try/catch do loop. Uma unica linha de loja com
  // token irrecuperavel abortava o loader inteiro: as linhas seguintes do lote
  // nem eram tentadas, e a propria linha continuava "retrying" com o
  // nextAttemptAt antigo — como dueForRetry ordena por nextAttemptAt asc, ela
  // voltava ao topo em toda execucao e travava a fila para sempre.
  it("fecha a linha ruim e ainda processa a boa do mesmo lote", async () => {
    const ontem = new Date(Date.now() - 86_400_000);
    const canonical = { schema: 1, nextags: { token: "REDIGIDO", actions: [] } };

    // A ruim entra primeiro na ordenacao (nextAttemptAt mais antigo).
    await prisma.eventLog.create({
      data: {
        shopDomain: QUEBRADA,
        topic: "orders/paid",
        event: "order_paid",
        dispatchStatus: "retrying",
        attempts: 1,
        nextAttemptAt: ontem,
        canonical,
      },
    });
    await prisma.eventLog.create({
      data: {
        shopDomain: SADIA,
        topic: "orders/paid",
        event: "order_paid",
        dispatchStatus: "retrying",
        attempts: 1,
        nextAttemptAt: new Date(ontem.getTime() + 1000),
        canonical,
      },
    });

    const url = "https://app.test/api/cron/retry-dispatch";
    const request = new Request(url, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const res = await retryLoader({
      request,
      params: {},
      url: new URL(url),
      pattern: "/api/cron/retry-dispatch",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: {} as any,
    });
    expect(res.status).toBe(200);

    const ruim = await prisma.eventLog.findFirst({ where: { shopDomain: QUEBRADA } });
    const boa = await prisma.eventLog.findFirst({ where: { shopDomain: SADIA } });

    // A ruim avancou (nao ficou parada no nextAttemptAt antigo).
    expect(ruim!.attempts).toBeGreaterThan(1);
    // E a boa do MESMO lote foi processada, em vez de ficar para tras.
    expect(boa!.dispatchStatus).toBe("ok");
  });
});
