import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { encrypt } from "~/lib/crypto.server";

// A loja "quebrada" e a primeira que o findMany devolve (ordem de insercao) e
// faz `unauthenticated.admin` lancar — e o que acontece quando a sessao
// offline sumiu ou expirou (o app roda com expiringOfflineAccessTokens: true).
// A "sadia" vem depois: e ela que prova que o lote nao foi abortado.
const QUEBRADA = "ab-admin-quebrado.myshopify.com";
const SADIA = "ab-admin-ok.myshopify.com";

vi.mock("~/shopify.server", () => ({
  unauthenticated: {
    admin: async (shop: string) => {
      if (shop === QUEBRADA) {
        throw new Error("Session not found / token expirado");
      }
      return {
        admin: {
          graphql: async () => ({
            json: async () => ({
              data: {
                abandonedCheckouts: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/AbandonedCheckout/9001",
                        // 2h atras: entre MIN_IDADE_MS (1h) e MAX_IDADE_MS (48h).
                        createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
                        completedAt: null,
                        abandonedCheckoutUrl: "https://loja.test/cart/c/9001",
                        totalPriceSet: { shopMoney: { amount: "99.90" } },
                        customer: { firstName: "Teste", lastName: "Sintetico", phone: "11987654321" },
                        lineItems: {
                          edges: [
                            {
                              node: {
                                title: "Produto",
                                quantity: 1,
                                originalUnitPriceSet: { shopMoney: { amount: "99.90" } },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            }),
          }),
        },
      };
    },
  },
}));

const { loader } = await import("~/routes/api.cron.abandoned-checkouts");

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});

const configBase = {
  enabled: true,
  dispatchMode: "n8n",
  flowMap: { abandoned_cart: "777" },
  cufMap: { numero: "NumeroPedidoSHP", status: "StatusPedidoSHP" },
};

beforeAll(async () => {
  for (const shopDomain of [QUEBRADA, SADIA]) {
    await prisma.store.create({
      data: {
        shopDomain,
        apiVersion: "test",
        config: { create: { ...configBase, nextagsTokenEnc: encrypt("tok") } },
      },
    });
  }
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

describe("cron de abandonados: uma loja inacessivel nao pode abortar o lote", () => {
  // O try que ja existia cobre so o dispatch — depois de `unauthenticated.admin`
  // e `admin.graphql` terem dado certo. Sao justamente essas duas que falham
  // por motivo alheio a configuracao da loja, e a excecao subia ate o loader:
  // as lojas seguintes do lote nunca eram processadas. Como a ordem do findMany
  // e estavel, eram sempre as mesmas, em toda execucao do cron.
  it("processa a loja seguinte mesmo com a anterior inacessivel", async () => {
    const url = "https://app.test/api/cron/abandoned-checkouts";
    const request = new Request(url, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });

    const res = await loader({
      request,
      params: {},
      url: new URL(url),
      pattern: "/api/cron/abandoned-checkouts",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: {} as any,
    });
    expect(res.status).toBe(200);

    const resumo = (await res.json()) as { disparados: number; lojasComFalha: number };
    expect(resumo.lojasComFalha).toBeGreaterThanOrEqual(1);
    // O que o bug impedia: a loja sadia sequer era alcancada.
    expect(resumo.disparados).toBeGreaterThanOrEqual(1);

    const daSadia = await prisma.eventLog.findFirst({
      where: { shopDomain: SADIA, event: "abandoned_cart" },
    });
    expect(daSadia?.dispatchStatus).toBe("ok");

    // A falha da loja quebrada fica visivel, nao so engolida.
    const daQuebrada = await prisma.eventLog.findFirst({ where: { shopDomain: QUEBRADA } });
    expect(daQuebrada?.nextagsResponse).toMatch(/falha ao consultar a loja/i);
  });
});
