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
