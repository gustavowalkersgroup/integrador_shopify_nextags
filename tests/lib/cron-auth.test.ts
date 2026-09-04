import { describe, it, expect } from "vitest";
import { assertCron } from "~/lib/cron-auth.server";

const req = (auth?: string) =>
  new Request("https://app.test/api/cron/x", {
    headers: auth ? { Authorization: auth } : {},
  });

const SECRET = process.env.CRON_SECRET as string;

describe("assertCron", () => {
  it("aceita o secret correto", () => {
    expect(() => assertCron(req(`Bearer ${SECRET}`))).not.toThrow();
  });

  it("rejeita secret errado ou ausente", () => {
    expect(() => assertCron(req("Bearer errado"))).toThrow();
    expect(() => assertCron(req())).toThrow();
  });

  it("rejeita header do mesmo tamanho com conteúdo diferente", () => {
    // Exercita o timingSafeEqual de fato: um header de tamanho diferente
    // pararia antes, no check de comprimento, e o compare nunca rodaria.
    const mesmoTamanho = `Bearer ${"x".repeat(SECRET.length)}`;
    expect(mesmoTamanho.length).toBe(`Bearer ${SECRET}`.length);
    expect(() => assertCron(req(mesmoTamanho))).toThrow();
  });

  it("rejeita o secret sem o prefixo Bearer", () => {
    expect(() => assertCron(req(SECRET))).toThrow();
  });

  it("responde 500, não 401, quando CRON_SECRET não está configurado", () => {
    // Sem esta distinção, uma env var faltando na Vercel se disfarçaria de
    // problema de credencial do n8n.
    const antes = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect(() => assertCron(req(`Bearer ${antes}`))).toThrow(
        expect.objectContaining({ status: 500 }),
      );
    } finally {
      process.env.CRON_SECRET = antes;
    }
  });

  it("rejeita com 401 quando o secret está configurado", () => {
    expect(() => assertCron(req("Bearer errado"))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });
});
