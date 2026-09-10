import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});
const SHOP = "purge-test.myshopify.com";

const RETENCAO_DIAS = 30;

async function purgar() {
  const corte = new Date(Date.now() - RETENCAO_DIAS * 24 * 3600_000);
  return prisma.eventLog.deleteMany({
    where: { shopDomain: SHOP, createdAt: { lt: corte }, dispatchStatus: { not: "retrying" } },
  });
}

beforeAll(async () => {
  await prisma.store.create({ data: { shopDomain: SHOP, apiVersion: "test" } });
});

afterAll(async () => {
  await prisma.eventLog.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.store.delete({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("purga do event_log", () => {
  it("apaga só linhas antigas que não estão em retry", async () => {
    const antigo = new Date(Date.now() - 31 * 24 * 3600_000);
    const recente = new Date(Date.now() - 1 * 24 * 3600_000);

    const okAntigo = await prisma.eventLog.create({
      data: { shopDomain: SHOP, topic: "orders/paid", dispatchStatus: "ok" },
    });
    await prisma.eventLog.update({ where: { id: okAntigo.id }, data: { createdAt: antigo } });

    const retryingAntigo = await prisma.eventLog.create({
      data: { shopDomain: SHOP, topic: "orders/paid", dispatchStatus: "retrying" },
    });
    await prisma.eventLog.update({
      where: { id: retryingAntigo.id },
      data: { createdAt: antigo },
    });

    const okRecente = await prisma.eventLog.create({
      data: { shopDomain: SHOP, topic: "orders/paid", dispatchStatus: "ok" },
    });
    await prisma.eventLog.update({ where: { id: okRecente.id }, data: { createdAt: recente } });

    const { count } = await purgar();
    expect(count).toBe(1);

    const restantes = await prisma.eventLog.findMany({
      where: { shopDomain: SHOP },
      select: { id: true },
    });
    expect(restantes.map((r) => r.id).sort()).toEqual(
      [retryingAntigo.id, okRecente.id].sort(),
    );
  });
});
