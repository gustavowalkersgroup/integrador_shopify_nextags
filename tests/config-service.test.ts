import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  carregarPainel,
  criarCufsPadrao,
  CUF_DEFAULT,
  dispararTeste,
  salvarFlowMap,
  salvarN8n,
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

describe("salvarN8n", () => {
  it("grava a URL e cifra o secret", async () => {
    await salvarN8n(SHOP, "https://n8n.exemplo.com/webhook/loja", "seg-redo");
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.n8nWebhookUrl).toBe("https://n8n.exemplo.com/webhook/loja");
    expect(cfg?.n8nWebhookSecretEnc).not.toBe("seg-redo");
    expect(decrypt(cfg!.n8nWebhookSecretEnc!)).toBe("seg-redo");
  });

  it("secret em branco mantém o valor já salvo", async () => {
    await salvarN8n(SHOP, "https://n8n.exemplo.com/webhook/loja", "seg-redo");
    await salvarN8n(SHOP, "https://n8n.exemplo.com/webhook/loja-nova", "");
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.n8nWebhookUrl).toBe("https://n8n.exemplo.com/webhook/loja-nova");
    expect(decrypt(cfg!.n8nWebhookSecretEnc!)).toBe("seg-redo");
  });

  it("URL em branco limpa o webhook próprio", async () => {
    await salvarN8n(SHOP, "https://n8n.exemplo.com/webhook/loja", "seg-redo");
    await salvarN8n(SHOP, "", "");
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: SHOP } });
    expect(cfg?.n8nWebhookUrl).toBeNull();
  });
});

describe("criarCufsPadrao", () => {
  it("sem chave configurada retorna erro", async () => {
    const r = await criarCufsPadrao(SHOP);
    expect(r.ok).toBe(false);
  });

  it("cria os campos que faltam e mantém os que já existem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    await salvarToken(SHOP, "tok");

    const [primeiroNome] = Object.values(CUF_DEFAULT);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) => {
        if (init?.method === "GET" || !init?.method) {
          return new Response(JSON.stringify([{ id: 1, name: primeiroNome }]), { status: 200 });
        }
        return new Response('{"id":99}', { status: 201 });
      }),
    );

    const r = await criarCufsPadrao(SHOP);
    expect(r.ok).toBe(true);
    expect(r.resultados).toHaveLength(Object.keys(CUF_DEFAULT).length);
    expect(r.resultados?.find((x) => x.nome === primeiroNome)?.status).toBe("já existia");
    expect(r.resultados?.every((x) => x.status === "já existia" || x.status === "criado agora")).toBe(
      true,
    );
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
