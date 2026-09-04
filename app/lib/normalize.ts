export const FALLBACK = "Não informado";

export function verificarDado(v: unknown, fallback: string = FALLBACK): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

export function separarNomeSobrenome(
  nome: string | null | undefined,
): { first_name: string; last_name: string } {
  const limpo = verificarDado(nome, "");
  if (!limpo) return { first_name: FALLBACK, last_name: FALLBACK };
  const partes = limpo.split(/\s+/);
  const first = partes.shift() as string;
  return {
    first_name: first,
    last_name: partes.length ? partes.join(" ") : FALLBACK,
  };
}

export function limparNumeroPedido(name: string | null | undefined): string {
  const limpo = verificarDado(name, "");
  if (!limpo) return FALLBACK;
  return limpo.replace(/^#/, "").split(".")[0];
}

export function formatarMoeda(v: unknown): string {
  if (v === null || v === undefined || v === "") return FALLBACK;
  const n = Number(v);
  if (!Number.isFinite(n)) return FALLBACK;
  return `R$ ${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type LineItem = { title?: string; name?: string; quantity?: number; price?: string | number };

export function formatarItens(itens: LineItem[] | null | undefined): string {
  if (!itens || itens.length === 0) return FALLBACK;
  return itens
    .map((i) => {
      const titulo = verificarDado(i.title ?? i.name);
      const qtd = verificarDado(i.quantity, "1");
      return `${titulo} (Qtd: ${qtd}, ${formatarMoeda(i.price)})`;
    })
    .join(", ");
}
