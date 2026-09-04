import { describe, it, expect } from "vitest";
import {
  buildActions,
  buildCanonical,
  redactCanonical,
  EmptyCufError,
  MissingPhoneError,
  MissingFlowError,
} from "~/lib/nextags/payload";

const base = {
  shop: "loja.myshopify.com",
  event: "order_paid" as const,
  token: "tok-1",
  flowMap: { order_paid: "111", order_fulfilled: "222", order_cancelled: "333" },
  cufMap: { numero: "NumeroPedidoSHP", status: "StatusPedidoSHP" },
  order: {
    id: "gid://shopify/Order/9001",
    name: "#1234",
    total: "199.9",
    phone: "+55 (19) 99876-5432",
    customerName: "Maria Silva",
    lineItems: [{ title: "Camiseta", quantity: 2, price: "49.90" }],
    tracking: null as string | null,
    trackingUrl: null as string | null,
  },
};

describe("buildActions", () => {
  it("põe todos os set_field_value antes do send_flow", () => {
    const actions = buildActions({ A: "1", B: "2" }, ["pedido-pago"], "111");
    const tipos = actions.map((a) => a.action);
    expect(tipos[tipos.length - 1]).toBe("send_flow");
    const ultimoSet = tipos.lastIndexOf("set_field_value");
    expect(ultimoSet).toBeLessThan(tipos.indexOf("send_flow"));
  });

  it("emite um send_flow único com o flow_id recebido", () => {
    const actions = buildActions({ A: "1" }, [], "999");
    const flows = actions.filter((a) => a.action === "send_flow");
    expect(flows).toHaveLength(1);
    expect(flows[0]).toEqual({ action: "send_flow", flow_id: "999" });
  });

  it("recusa CUF com valor vazio", () => {
    expect(() => buildActions({ A: "" }, [], "111")).toThrow(EmptyCufError);
    expect(() => buildActions({ A: "   " }, [], "111")).toThrow(EmptyCufError);
  });
});

describe("buildCanonical", () => {
  it("monta payload com telefone normalizado e nome separado", () => {
    const p = buildCanonical(base);
    expect(p.schema).toBe(1);
    expect(p.event).toBe("order_paid");
    expect(p.customer.phone).toBe("5519998765432");
    expect(p.customer.first_name).toBe("Maria");
    expect(p.customer.last_name).toBe("Silva");
    expect(p.order.number).toBe("1234");
    expect(p.order.items).toContain("Camiseta (Qtd: 2, R$ 49,90)");
    expect(p.nextags.flow_id).toBe("111");
    expect(p.nextags.token).toBe("tok-1");
  });

  it("nunca deixa CUF vazio no payload", () => {
    const p = buildCanonical(base);
    for (const v of Object.values(p.nextags.cuf)) expect(String(v).trim()).not.toBe("");
  });

  it("falha sem telefone válido", () => {
    expect(() =>
      buildCanonical({ ...base, order: { ...base.order, phone: "123" } }),
    ).toThrow(MissingPhoneError);
  });

  it("falha sem flow mapeado", () => {
    expect(() =>
      buildCanonical({ ...base, event: "abandoned_cart", flowMap: {} }),
    ).toThrow(MissingFlowError);
  });

  it("ready_pickup sem flow próprio cai em order_fulfilled", () => {
    const p = buildCanonical({ ...base, event: "ready_pickup" });
    expect(p.nextags.flow_id).toBe("222");
  });

  it("order_refunded sem flow próprio cai em order_cancelled", () => {
    const p = buildCanonical({ ...base, event: "order_refunded" });
    expect(p.nextags.flow_id).toBe("333");
  });
});

describe("redactCanonical", () => {
  it("remove o token antes de gravar em log", () => {
    const p = buildCanonical(base);
    const r = redactCanonical(p);
    expect(r.nextags.token).toBe("[REDACTED]");
    expect(p.nextags.token).toBe("tok-1");
  });
});
