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
