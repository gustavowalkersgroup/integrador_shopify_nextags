import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WEBHOOK_TOPICS } from "~/lib/events";

describe("shopify.app.toml", () => {
  const toml = readFileSync("shopify.app.toml", "utf8");

  it("declara os 3 topics de compliance apontando para o receptor", () => {
    for (const t of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect(toml).toContain(`compliance_topics = ["${t}"]`);
    }
    expect(toml).toContain('uri = "/webhooks/shopify"');
  });

  it("declara os topics transacionais", () => {
    for (const t of [
      "orders/paid",
      "orders/fulfilled",
      "fulfillments/update",
      "orders/cancelled",
      "refunds/create",
      "app/uninstalled",
    ]) {
      expect(toml).toContain(`"${t}"`);
    }
  });

  it("declara exatamente os scopes do v1", () => {
    for (const s of [
      "read_orders",
      "read_fulfillments",
      "read_checkouts",
      "read_products",
      "read_inventory",
      "read_customers",
    ]) {
      expect(toml).toContain(s);
    }
    expect(toml).not.toContain("read_all_orders");
    expect(toml).not.toMatch(/write_/);
  });

  it("é embedded", () => {
    expect(toml).toMatch(/embedded\s*=\s*true/);
  });
});

describe("cobertura de topics", () => {
  it("todo topic de WEBHOOK_TOPICS está declarado no toml", () => {
    const toml = readFileSync("shopify.app.toml", "utf8");
    for (const t of WEBHOOK_TOPICS) {
      expect(toml).toContain(`"${t}"`);
    }
  });
});
