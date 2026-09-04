import { describe, it, expect } from "vitest";
import { elegivelParaDisparo, ABANDONED_QUERY } from "~/lib/abandoned.server";

/**
 * Extrai o motivo da recusa fazendo o narrowing pelo discriminante `ok`.
 * Se o resultado vier `ok: true` o helper falha — que e exatamente o que
 * cada teste abaixo quer assegurar. Evita `(r as any).motivo`, que o lint
 * rejeita e que esconderia um `ok: true` inesperado.
 */
function motivoDaRecusa(r: ReturnType<typeof elegivelParaDisparo>): string {
  if (r.ok) throw new Error("esperava recusa, recebeu ok: true");
  return r.motivo;
}

const agora = new Date("2026-08-27T12:00:00Z");
const hAtras = (h: number) => new Date(agora.getTime() - h * 3600_000).toISOString();

const base = {
  id: "gid://shopify/AbandonedCheckout/1",
  createdAt: hAtras(3),
  completedAt: null as string | null,
  customer: { phone: "19955556666" },
};

describe("elegivelParaDisparo", () => {
  it("aceita carrinho de 3h não convertido com telefone", () => {
    expect(elegivelParaDisparo(base, agora)).toEqual({ ok: true });
  });

  it("recusa mais novo que 1h", () => {
    const r = elegivelParaDisparo({ ...base, createdAt: hAtras(0.5) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect(motivoDaRecusa(r)).toMatch(/recente/i);
  });

  it("recusa mais velho que 48h", () => {
    const r = elegivelParaDisparo({ ...base, createdAt: hAtras(60) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect(motivoDaRecusa(r)).toMatch(/antigo/i);
  });

  it("recusa carrinho convertido", () => {
    const r = elegivelParaDisparo({ ...base, completedAt: hAtras(1) }, agora);
    expect(r).toMatchObject({ ok: false });
    expect(motivoDaRecusa(r)).toMatch(/convertid/i);
  });

  it("recusa createdAt inválido em vez de deixar passar por NaN", () => {
    // `undefined` viola o tipo de proposito: e o input invalido que a
    // guarda tem de barrar. O cast passa por `unknown` em vez de `any`.
    const invalidos = ["", "nao-e-data", undefined as unknown as string];
    for (const createdAt of invalidos) {
      const r = elegivelParaDisparo({ ...base, createdAt }, agora);
      expect(r).toMatchObject({ ok: false });
      expect(motivoDaRecusa(r)).toMatch(/inválido|ausente/i);
    }
  });

  it("recusa sem telefone utilizável", () => {
    const r = elegivelParaDisparo({ ...base, customer: { phone: "123" } }, agora);
    expect(r).toMatchObject({ ok: false });
    expect(motivoDaRecusa(r)).toMatch(/telefone/i);
  });
});

describe("ABANDONED_QUERY", () => {
  it("pede os campos que os guards usam", () => {
    for (const campo of ["createdAt", "completedAt", "phone", "abandonedCheckoutUrl"]) {
      expect(ABANDONED_QUERY).toContain(campo);
    }
  });
});
