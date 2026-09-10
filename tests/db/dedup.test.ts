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
