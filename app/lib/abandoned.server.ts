import { normalizarTelefoneBR } from "~/lib/phone";

export const MIN_IDADE_MS = 3600_000; // 1h
export const MAX_IDADE_MS = 48 * 3600_000; // 48h

// Campos a confirmar na versao fixada da API (Task 12, Step 5). [Provavel]
export const ABANDONED_QUERY = `
  query AbandonedCheckouts($first: Int!) {
    abandonedCheckouts(first: $first, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          createdAt
          completedAt
          abandonedCheckoutUrl
          totalPriceSet { shopMoney { amount } }
          customer { firstName lastName phone }
          lineItems(first: 20) {
            edges { node { title quantity originalUnitPriceSet { shopMoney { amount } } } }
          }
        }
      }
    }
  }
`;

type Checkout = {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  customer?: { phone?: string | null } | null;
};

export function elegivelParaDisparo(
  c: Checkout,
  agora: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (c.completedAt) return { ok: false, motivo: "carrinho já convertido em pedido" };

  // createdAt invalido produz NaN, e toda comparacao com NaN e falsa: sem esta
  // guarda os dois limites de idade passariam batido e o carrinho seria julgado
  // elegivel so pelo telefone.
  const criadoEm = new Date(c.createdAt).getTime();
  if (!Number.isFinite(criadoEm)) {
    return { ok: false, motivo: "createdAt ausente ou inválido" };
  }

  const idade = agora.getTime() - criadoEm;
  if (idade < MIN_IDADE_MS) return { ok: false, motivo: "carrinho recente (<1h)" };
  if (idade > MAX_IDADE_MS) return { ok: false, motivo: "carrinho antigo (>48h)" };

  if (!normalizarTelefoneBR(c.customer?.phone)) {
    return { ok: false, motivo: "sem telefone utilizável" };
  }
  return { ok: true };
}
