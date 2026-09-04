export type CanonicalEvent =
  | "order_paid"
  | "order_fulfilled"
  | "ready_pickup"
  | "order_delivered"
  | "order_cancelled"
  | "order_refunded"
  | "abandoned_cart";

export type TopicOutcome =
  | { kind: "dispatch"; event: CanonicalEvent }
  | { kind: "log_only" }
  | { kind: "internal" }
  | { kind: "compliance" }
  | { kind: "unknown" };

export const WEBHOOK_TOPICS = [
  "orders/paid",
  "orders/fulfilled",
  "fulfillments/create",
  "fulfillments/update",
  "orders/cancelled",
  "refunds/create",
  "orders/updated",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "app/uninstalled",
];

const COMPLIANCE = new Set(["customers/data_request", "customers/redact", "shop/redact"]);
const LOG_ONLY = new Set([
  "orders/updated",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
]);

/** Payload de webhook nao e confiavel: chega como JSON arbitrario. */
type Json = Record<string, unknown>;

function objeto(v: unknown): Json | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined;
}

/** Le uma string aninhada sem assumir a forma do payload. */
function texto(raiz: unknown, ...caminho: string[]): string | undefined {
  let atual: unknown = raiz;
  for (const chave of caminho) {
    const o = objeto(atual);
    if (!o) return undefined;
    atual = o[chave];
  }
  return typeof atual === "string" ? atual : undefined;
}

// Nomes de campo confirmados na versao fixada da API (ver Task 12, Step 5). [Provavel]
function ehPickup(f: unknown): boolean {
  if (!objeto(f)) return false;
  const metodo =
    texto(f, "delivery_method", "method_type") ?? texto(f, "deliveryMethod", "methodType");
  if (metodo && metodo.toLowerCase().includes("pick")) return true;
  return texto(f, "shipment_status") === "ready_for_pickup";
}

export function mapTopic(topic: string, payload: unknown): TopicOutcome {
  if (COMPLIANCE.has(topic)) return { kind: "compliance" };
  if (topic === "app/uninstalled") return { kind: "internal" };
  if (LOG_ONLY.has(topic)) return { kind: "log_only" };

  switch (topic) {
    case "orders/paid":
      return { kind: "dispatch", event: "order_paid" };

    case "orders/fulfilled": {
      const bruto = objeto(payload)?.fulfillments;
      const fulfillments: unknown[] = Array.isArray(bruto) ? bruto : [];
      const pickup = fulfillments.some(ehPickup);
      return { kind: "dispatch", event: pickup ? "ready_pickup" : "order_fulfilled" };
    }

    case "fulfillments/create":
      return { kind: "dispatch", event: ehPickup(payload) ? "ready_pickup" : "order_fulfilled" };

    case "fulfillments/update":
      return texto(payload, "shipment_status") === "delivered"
        ? { kind: "dispatch", event: "order_delivered" }
        : { kind: "log_only" };

    case "orders/cancelled":
      return { kind: "dispatch", event: "order_cancelled" };

    case "refunds/create":
      return { kind: "dispatch", event: "order_refunded" };

    default:
      return { kind: "unknown" };
  }
}
