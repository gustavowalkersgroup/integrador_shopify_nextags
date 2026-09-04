import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatch } from "~/lib/dispatch/index.server";
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
    const fn = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fn);

    const r = await dispatch(payload, "n8n");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0] as any[];
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
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: any) =>
          new Promise((_res, rej) =>
            init.signal.addEventListener("abort", () => rej(new Error("aborted"))),
          ),
      ),
    );
    expect(await dispatch(payload, "n8n", 10)).toMatchObject({ ok: false, status: 0 });
  });
});

describe("dispatch direct", () => {
  it("chama a API NexTags com o token no header", async () => {
    const fn = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal("fetch", fn);

    const r = await dispatch(payload, "direct");
    expect(r.ok).toBe(true);

    const [url, init] = fn.mock.calls[0] as any[];
    expect(String(url)).toContain("/api/contacts");
    expect(init.headers["X-ACCESS-TOKEN"]).toBe("tok-1");
  });
});

describe("modo inválido", () => {
  it("lança erro", async () => {
    await expect(dispatch(payload, "banana" as any)).rejects.toThrow(/modo/i);
  });
});
