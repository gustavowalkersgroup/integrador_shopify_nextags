import { describe, it, expect, vi, afterEach } from "vitest";
import { stubFetch, type FetchInit } from "../support/fetch-stub";
import { validateToken, listFlows, sendContact } from "~/lib/nextags/client.server";
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

describe("validateToken", () => {
  it("token válido retorna ok", async () => {
    stubFetch(async () => new Response("[]", { status: 200 }));
    expect(await validateToken("tok")).toEqual({ ok: true });
  });

  it("401 retorna erro legível", async () => {
    stubFetch(async () => new Response("unauthorized", { status: 401 }));
    const r = await validateToken("ruim");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/inválid|401/i);
  });
});

describe("listFlows", () => {
  it("normaliza a lista de flows", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 7, name: "Pedido pago" }] }), {
          status: 200,
        }),
    );
    expect(await listFlows("tok")).toEqual([{ flow_id: "7", flow_name: "Pedido pago" }]);
  });

  it("erro HTTP propaga exceção", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    await expect(listFlows("tok")).rejects.toThrow();
  });
});

describe("sendContact", () => {
  it("envia token no header X-ACCESS-TOKEN e não no corpo", async () => {
    const fn = stubFetch(async () => new Response('{"success":true}', { status: 200 }));
    const r = await sendContact(payload);
    expect(r.ok).toBe(true);
    const [, init] = fn.mock.calls[0];
    expect(init.headers["X-ACCESS-TOKEN"]).toBe("tok-1");
    expect(init.body).not.toContain("tok-1");
  });

  it("corpo tem actions com send_flow por último", async () => {
    const fn = stubFetch(async () => new Response("{}", { status: 200 }));
    await sendContact(payload);
    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body.actions[body.actions.length - 1].action).toBe("send_flow");
    expect(body.phone).toBe(payload.customer.phone);
  });

  it("HTTP de erro retorna ok:false com status e corpo", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));
    const r = await sendContact(payload);
    expect(r).toMatchObject({ ok: false, status: 429, body: "rate limited" });
  });

  it("timeout retorna ok:false status 0", async () => {
    stubFetch(
      (_url: string, init: FetchInit) =>
        new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const r = await sendContact(payload, 10);
    expect(r).toMatchObject({ ok: false, status: 0 });
  });
});
