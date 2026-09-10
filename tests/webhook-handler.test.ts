import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach, type Mock } from "vitest";
import { PrismaClient } from "@prisma/client";
import { handleWebhook } from "~/lib/webhook-handler.server";
import { encrypt } from "~/lib/crypto.server";
import ordersPaid from "./fixtures/orders-paid.json";
import ordersFulfilledPickup from "./fixtures/orders-fulfilled-pickup.json";
import fulfillmentDelivered from "./fixtures/fulfillments-update-delivered.json";

const fetchMock = () => globalThis.fetch as unknown as Mock;

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
    expect(fetchMock().mock.calls).toHaveLength(1);
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
    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
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
    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
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
    expect(fetchMock().mock.calls).toHaveLength(0);
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
