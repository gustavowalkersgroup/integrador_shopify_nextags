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
