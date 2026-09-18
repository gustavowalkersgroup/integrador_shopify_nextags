import { describe, it, expect, vi, afterEach } from "vitest";

// BASE_PATH e avaliado no import, entao cada caso precisa de um modulo novo.
async function carregar(valor: string | undefined) {
  vi.resetModules();
  if (valor === undefined) delete process.env.APP_BASE_PATH;
  else process.env.APP_BASE_PATH = valor;
  return import("~/lib/base-path");
}

afterEach(() => {
  delete process.env.APP_BASE_PATH;
  vi.resetModules();
});

describe("BASE_PATH", () => {
  const ausentes: Array<[string, string | undefined]> = [
    ["undefined", undefined],
    ["string vazia", ""],
    ["só espaço", "   "],
    ["só a barra", "/"],
  ];
  it.each(ausentes)("%s vira string vazia (app na raiz)", async (_r, entrada) => {
    const { BASE_PATH } = await carregar(entrada);
    expect(BASE_PATH).toBe("");
  });

  // Aceitar sem a barra inicial nao e capricho: no Git Bash do Windows, uma
  // env var que comeca com "/" sofre path conversion do MSYS e chega ao
  // processo como "/C:/Program Files/Git/notificacoes". Passar "notificacoes"
  // contorna isso, e o resultado e o mesmo nos dois casos.
  const formas: Array<[string, string]> = [
    ["sem barra", "notificacoes"],
    ["com barra inicial", "/notificacoes"],
    ["com barra final", "notificacoes/"],
    ["com as duas", "/notificacoes/"],
    ["com barras duplicadas", "//notificacoes//"],
    ["com espaço em volta", "  /notificacoes  "],
  ];
  it.each(formas)("%s normaliza para /notificacoes", async (_r, entrada) => {
    const { BASE_PATH } = await carregar(entrada);
    expect(BASE_PATH).toBe("/notificacoes");
  });
});

describe("comBase", () => {
  it("prefixa quando ha base", async () => {
    const { comBase } = await carregar("notificacoes");
    expect(comBase("/auth")).toBe("/notificacoes/auth");
    expect(comBase("/app?x=1")).toBe("/notificacoes/app?x=1");
  });

  it("devolve o caminho intacto quando nao ha base (Vercel)", async () => {
    const { comBase } = await carregar("");
    expect(comBase("/auth")).toBe("/auth");
    expect(comBase("/app?x=1")).toBe("/app?x=1");
  });

  it("nunca produz barra dupla na junção", async () => {
    const { comBase } = await carregar("/notificacoes/");
    expect(comBase("/auth")).toBe("/notificacoes/auth");
    expect(comBase("/auth")).not.toContain("//");
  });
});
