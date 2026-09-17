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

describe("shopify.app.nextagsai.toml (app publico)", () => {
  const publico = readFileSync("shopify.app.nextagsai.toml", "utf8");
  const custom = readFileSync("shopify.app.toml", "utf8");

  // Os dois tomls descrevem o MESMO codigo em deploys diferentes. Divergir nos
  // topics significa um evento que dispara no custom e some no publico (ou o
  // contrario), e nada no build acusa. Por isso o teste compara os dois.
  it("cobre todo topic de WEBHOOK_TOPICS", () => {
    for (const t of WEBHOOK_TOPICS) {
      expect(publico).toContain(`"${t}"`);
    }
  });

  it("declara os 3 topics de compliance", () => {
    for (const t of ["customers/data_request", "customers/redact", "shop/redact"]) {
      expect(publico).toContain(`compliance_topics = ["${t}"]`);
    }
  });

  it("tem exatamente os mesmos scopes do app custom", () => {
    const scopes = (t: string) => t.match(/^scopes\s*=\s*"(.*)"$/m)?.[1]?.split(",").sort();
    expect(scopes(publico)).toEqual(scopes(custom));
  });

  it("usa um client_id diferente do app custom", () => {
    const id = (t: string) => t.match(/^client_id\s*=\s*"(.*)"$/m)?.[1];
    expect(id(publico)).toBeTruthy();
    expect(id(publico)).not.toBe(id(custom));
  });

  // O app publico roda sob subpath na VPS. Um `uri` relativo seria resolvido
  // contra o application_url, e com um application_url que ja tem path o
  // resultado e ambiguo: o webhook poderia ser entregue na raiz do dominio,
  // onde vive outra aplicacao, e o pedido sumiria sem linha no event_log.
  it("aponta os webhooks para URI absoluto, com o mesmo prefixo do application_url", () => {
    const appUrl = publico.match(/^application_url\s*=\s*"(.*)"$/m)?.[1];
    expect(appUrl).toBeTruthy();

    const uris = [...publico.matchAll(/^\s*uri\s*=\s*"(.*)"$/gm)].map((m) => m[1]);
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) {
      expect(uri).toMatch(/^https:\/\//);
      expect(uri.startsWith(`${appUrl}/`)).toBe(true);
    }
  });

  it("o redirect de auth fica sob o mesmo prefixo", () => {
    const appUrl = publico.match(/^application_url\s*=\s*"(.*)"$/m)?.[1];
    expect(publico).toContain(`redirect_urls = ["${appUrl}/auth/callback"]`);
  });

  // A Shopify recusa URLs de listagem que contenham "shopify", inclusive no
  // path — o campo Privacy policy URL rejeitou ".../shopify/privacy".
  it("nao usa a palavra shopify no path do application_url", () => {
    const appUrl = publico.match(/^application_url\s*=\s*"(.*)"$/m)?.[1] ?? "";
    const path = new URL(appUrl).pathname;
    expect(path.toLowerCase()).not.toContain("shopify");
  });
});
