import { describe, it, expect } from "vitest";
import { mapTopic, WEBHOOK_TOPICS } from "~/lib/events";

describe("mapTopic", () => {
  it("orders/paid vira order_paid", () => {
    expect(mapTopic("orders/paid", {})).toEqual({ kind: "dispatch", event: "order_paid" });
  });

  it("orders/fulfilled com entrega normal vira order_fulfilled", () => {
    const payload = { fulfillments: [{ shipment_status: null }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "order_fulfilled",
    });
  });

  it("orders/fulfilled com pickup vira ready_pickup", () => {
    const payload = { fulfillments: [{ delivery_method: { method_type: "pick_up" } }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "ready_pickup",
    });
  });

  it("shipment_status ready_for_pickup também vira ready_pickup", () => {
    const payload = { fulfillments: [{ shipment_status: "ready_for_pickup" }] };
    expect(mapTopic("orders/fulfilled", payload)).toEqual({
      kind: "dispatch",
      event: "ready_pickup",
    });
  });

  it("fulfillments/update entregue vira order_delivered", () => {
    expect(mapTopic("fulfillments/update", { shipment_status: "delivered" })).toEqual({
      kind: "dispatch",
      event: "order_delivered",
    });
  });

  it("fulfillments/update em trânsito não dispara", () => {
    expect(mapTopic("fulfillments/update", { shipment_status: "in_transit" })).toEqual({
      kind: "log_only",
    });
  });

  it("cancelamento e reembolso", () => {
    expect(mapTopic("orders/cancelled", {})).toEqual({
      kind: "dispatch",
      event: "order_cancelled",
    });
    expect(mapTopic("refunds/create", {})).toEqual({
      kind: "dispatch",
      event: "order_refunded",
    });
  });

  it("catálogo e orders/updated só logam", () => {
    expect(mapTopic("products/update", {})).toEqual({ kind: "log_only" });
    expect(mapTopic("inventory_levels/update", {})).toEqual({ kind: "log_only" });
    expect(mapTopic("orders/updated", {})).toEqual({ kind: "log_only" });
  });

  it("app/uninstalled é interno", () => {
    expect(mapTopic("app/uninstalled", {})).toEqual({ kind: "internal" });
  });

  it("topics de GDPR são compliance", () => {
    for (const t of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect(mapTopic(t, {})).toEqual({ kind: "compliance" });
    }
  });

  it("topic desconhecido é unknown", () => {
    expect(mapTopic("banana/split", {})).toEqual({ kind: "unknown" });
  });
});

describe("WEBHOOK_TOPICS", () => {
  it("inclui os obrigatórios e os transacionais", () => {
    for (const t of [
      "orders/paid",
      "orders/fulfilled",
      "fulfillments/update",
      "orders/cancelled",
      "refunds/create",
      "app/uninstalled",
    ]) {
      expect(WEBHOOK_TOPICS).toContain(t);
    }
  });

  it("não inclui topics de GDPR (declarados no shopify.app.toml)", () => {
    expect(WEBHOOK_TOPICS).not.toContain("customers/redact");
  });
});
