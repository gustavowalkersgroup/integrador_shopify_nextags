import { describe, it, expect, vi, afterEach } from "vitest";
import { stubFetch, type FetchInit } from "../support/fetch-stub";
import {
  dispatch,
  normalizarModo,
  MODO_PADRAO,
  type DispatchMode,
} from "~/lib/dispatch/index.server";
import { buildCanonical } from "~/lib/nextags/payload";

const payload = buildCanonical({
  shop: "loja.myshopify.com",
  event: "order_paid",
  token: "tok-1",
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

afterEach(() => vi.unstubAllGlobals());

describe("dispatch n8n", () => {
  it("POSTa no N8N_WEBHOOK_URL com header de secret", async () => {
    const fn = stubFetch(async () => new Response("ok", { status: 200 }));

    const r = await dispatch(payload, "n8n");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(process.env.N8N_WEBHOOK_URL);
    expect(init.headers["X-Webhook-Secret"]).toBe(process.env.N8N_WEBHOOK_SECRET);
    const body = JSON.parse(init.body);
    expect(body.schema).toBe(1);
    expect(body.nextags.token).toBe("tok-1");
  });

  it("HTTP de erro vira ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect(await dispatch(payload, "n8n")).toMatchObject({ ok: false, status: 502 });
  });

  it("timeout vira ok:false status 0", async () => {
    stubFetch(
      (_u: string, init: FetchInit) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener("abort", () => rej(new Error("aborted"))),
        ),
    );
    expect(await dispatch(payload, "n8n", {}, 10)).toMatchObject({ ok: false, status: 0 });
  });

  it("N8N_WEBHOOK_URL ausente vira ok:false em vez de lançar (evita 'Application Error' na UI)", async () => {
    const original = process.env.N8N_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_URL;
    try {
      await expect(dispatch(payload, "n8n")).resolves.toMatchObject({ ok: false, status: 0 });
    } finally {
      process.env.N8N_WEBHOOK_URL = original;
    }
  });
});

describe("dispatch direct", () => {
  it("chama a API NexTags com o token no header", async () => {
    const fn = stubFetch(async () => new Response('{"success":true}', { status: 200 }));

    const r = await dispatch(payload, "direct");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toContain("/api/contacts");
    expect(init.headers["X-ACCESS-TOKEN"]).toBe("tok-1");
  });
});

describe("normalizarModo", () => {
  // Regressao do incidente de 2026-09-10/11: DISPATCH_MODE_DEFAULT existia
  // VAZIA na Vercel, `??` nao aplicou o fallback e toda loja nasceu com
  // dispatchMode "". Ausencia de valor precisa virar o padrao, nunca falha.
  const ausentes: Array<[string, string | null | undefined]> = [
    ["string vazia", ""],
    ["só espaço", " "],
    ["null", null],
    ["undefined", undefined],
  ];
  it.each(ausentes)("trata %s como o modo padrão", (_rotulo, entrada) => {
    expect(normalizarModo(entrada)).toBe(MODO_PADRAO);
  });

  it("aceita modo válido com caixa e espaço variados", () => {
    expect(normalizarModo(" N8N ")).toBe("n8n");
    expect(normalizarModo("Direct")).toBe("direct");
  });

  it("devolve null para modo genuinamente desconhecido", () => {
    expect(normalizarModo("banana")).toBeNull();
  });
});

describe("modo inválido", () => {
  // Antes esta funcao rejeitava. Rejeitar era o pior comportamento possivel:
  // os call sites chamam dispatch() DEPOIS do logStart e, nos webhooks, depois
  // do dedup ja reivindicado — a rejeicao deixava a linha presa em "pending",
  // devolvia 500 pra Shopify, e a reentrega batia no dedup consumido. Pedido
  // perdido em definitivo. Agora devolve ok:false, que vira "failed"/"retrying".
  it("não rejeita: devolve ok:false para modo desconhecido", async () => {
    const invalido = "banana" as unknown as DispatchMode;
    const r = await dispatch(payload, invalido);
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.body).toMatch(/modo de dispatch desconhecido/i);
  });

  it("mostra o valor recebido mesmo quando é vazio", async () => {
    // Com interpolacao crua a mensagem terminava em "desconhecido: " e escondia
    // o proprio sintoma — foi o que atrasou o diagnostico.
    const r = await dispatch(payload, "banana" as unknown as DispatchMode);
    expect(r.body).toContain('"banana"');
  });

  it("modo vazio cai no padrão e dispara de fato, em vez de falhar", async () => {
    const fn = stubFetch(async () => new Response("ok", { status: 200 }));

    const r = await dispatch(payload, "" as unknown as DispatchMode);

    expect(r.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // Confere o DESTINO, nao so que algum fetch aconteceu: o padrao e `direct`,
    // entao tem que bater na API da NexTags, sem hop por n8n.
    expect(fn.mock.calls[0][0]).toContain("/api/contacts");
  });
});
