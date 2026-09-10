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
        canonical: { customer: { phone: "5519999999999" } },
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
