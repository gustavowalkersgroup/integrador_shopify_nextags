import { describe, it, expect } from "vitest";
import { normalizarTelefoneBR } from "~/lib/phone";

describe("normalizarTelefoneBR", () => {
  it("preserva fixo de 8 dígitos sem adicionar 9", () => {
    expect(normalizarTelefoneBR("551933334444")).toBe("551933334444");
    expect(normalizarTelefoneBR("1933334444")).toBe("551933334444");
  });

  it("preserva celular que já tem 9 dígitos", () => {
    expect(normalizarTelefoneBR("5519955554444")).toBe("5519955554444");
    expect(normalizarTelefoneBR("19955554444")).toBe("5519955554444");
  });

  it("adiciona o 9 em celular antigo de 8 dígitos", () => {
    expect(normalizarTelefoneBR("1995554444")).toBe("5519995554444");
    expect(normalizarTelefoneBR("551995554444")).toBe("5519995554444");
  });

  it("limpa máscara e prefixo internacional", () => {
    expect(normalizarTelefoneBR("+55 (19) 3333-4444")).toBe("551933334444");
    expect(normalizarTelefoneBR(" 19 95555-4444 ")).toBe("5519955554444");
  });

  it("retorna null para entrada inválida", () => {
    expect(normalizarTelefoneBR(null)).toBeNull();
    expect(normalizarTelefoneBR("")).toBeNull();
    expect(normalizarTelefoneBR("123")).toBeNull();
    expect(normalizarTelefoneBR("abc")).toBeNull();
    expect(normalizarTelefoneBR("5519333344440000")).toBeNull();
  });

  it("rejeita DDD inexistente", () => {
    expect(normalizarTelefoneBR("0133334444")).toBeNull();
  });
});
