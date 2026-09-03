import { describe, it, expect } from "vitest";
import {
  verificarDado,
  separarNomeSobrenome,
  formatarItens,
  limparNumeroPedido,
  formatarMoeda,
} from "~/lib/normalize";

describe("verificarDado", () => {
  it("substitui vazio pelo fallback", () => {
    expect(verificarDado(null)).toBe("Não informado");
    expect(verificarDado(undefined)).toBe("Não informado");
    expect(verificarDado("")).toBe("Não informado");
    expect(verificarDado("   ")).toBe("Não informado");
    expect(verificarDado(null, "-")).toBe("-");
  });

  it("preserva valor presente e converte número", () => {
    expect(verificarDado("ok")).toBe("ok");
    expect(verificarDado(0)).toBe("0");
  });
});

describe("separarNomeSobrenome", () => {
  it("separa nome composto", () => {
    expect(separarNomeSobrenome("Maria Silva Souza")).toEqual({
      first_name: "Maria",
      last_name: "Silva Souza",
    });
  });

  it("nome único vira first_name com last_name vazio-fallback", () => {
    expect(separarNomeSobrenome("Maria")).toEqual({
      first_name: "Maria",
      last_name: "Não informado",
    });
  });

  it("entrada vazia cai no fallback", () => {
    expect(separarNomeSobrenome(null)).toEqual({
      first_name: "Não informado",
      last_name: "Não informado",
    });
  });
});

describe("limparNumeroPedido", () => {
  it("remove o # do order.name", () => {
    expect(limparNumeroPedido("#1234")).toBe("1234");
  });

  it("corta sufixo depois do ponto", () => {
    expect(limparNumeroPedido("#1234.1")).toBe("1234");
  });

  it("aceita entrada sem #", () => {
    expect(limparNumeroPedido("1234")).toBe("1234");
  });

  it("vazio cai no fallback", () => {
    expect(limparNumeroPedido(null)).toBe("Não informado");
  });
});

describe("formatarItens", () => {
  it("concatena itens legíveis", () => {
    const itens = [
      { title: "Camiseta", quantity: 2, price: "49.90" },
      { title: "Boné", quantity: 1, price: "39.00" },
    ];
    expect(formatarItens(itens)).toBe(
      "Camiseta (Qtd: 2, R$ 49,90), Boné (Qtd: 1, R$ 39,00)",
    );
  });

  it("lista vazia cai no fallback", () => {
    expect(formatarItens([])).toBe("Não informado");
    expect(formatarItens(undefined)).toBe("Não informado");
  });
});

describe("formatarMoeda", () => {
  it("formata no padrão BR", () => {
    expect(formatarMoeda("199.9")).toBe("R$ 199,90");
    expect(formatarMoeda(1234.5)).toBe("R$ 1.234,50");
  });

  it("valor inválido cai no fallback", () => {
    expect(formatarMoeda(null)).toBe("Não informado");
  });
});
