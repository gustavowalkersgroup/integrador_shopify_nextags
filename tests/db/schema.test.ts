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
    // ATENCAO: o beforeAll usa `config: { create: {} }`, que OMITE dispatchMode
    // e por isso aciona o @default do schema. Producao NAO faz isso — passa o
    // campo explicito (app/shopify.server.ts). Este teste sozinho da falsa
    // confianca; o de baixo cobre o caminho real.
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.dispatchMode).toBe("n8n");
    expect(cfg?.enabled).toBe(false);
  });

  it("default NÃO protege quando o create passa string vazia explícita", async () => {
    // Regressao do incidente de 2026-09-10: com DISPATCH_MODE_DEFAULT existindo
    // vazia na Vercel, `process.env.X ?? "n8n"` gravou "" e o @default nao
    // impediu — default de coluna so vale quando o campo e OMITIDO do INSERT.
    // Este teste fixa essa semantica para que ninguem volte a confiar no default.
    const shopVazio = "schema-test-vazio.myshopify.com";
    await prisma.store.create({
      data: {
        shopDomain: shopVazio,
        apiVersion: "test",
        config: { create: { dispatchMode: "" } },
      },
    });

    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shopVazio } });
    expect(cfg?.dispatchMode).toBe("");

    await prisma.store.delete({ where: { shopDomain: shopVazio } });
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
