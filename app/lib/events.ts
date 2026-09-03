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

// Nomes de campo confirmados na versao fixada da API (ver Task 12, Step 5). [Provavel]
function ehPickup(f: any): boolean {
  if (!f) return false;
  const metodo = f.delivery_method?.method_type ?? f.deliveryMethod?.methodType;
  if (typeof metodo === "string" && metodo.toLowerCase().includes("pick")) return true;
  return f.shipment_status === "ready_for_pickup";
}

export function mapTopic(topic: string, payload: any): TopicOutcome {
  if (COMPLIANCE.has(topic)) return { kind: "compliance" };
  if (topic === "app/uninstalled") return { kind: "internal" };
  if (LOG_ONLY.has(topic)) return { kind: "log_only" };

  switch (topic) {
    case "orders/paid":
      return { kind: "dispatch", event: "order_paid" };

    case "orders/fulfilled": {
      const fulfillments: any[] = payload?.fulfillments ?? [];
      const pickup = fulfillments.some(ehPickup);
      return { kind: "dispatch", event: pickup ? "ready_pickup" : "order_fulfilled" };
    }

    case "fulfillments/create":
      return { kind: "dispatch", event: ehPickup(payload) ? "ready_pickup" : "order_fulfilled" };

    case "fulfillments/update":
      return payload?.shipment_status === "delivered"
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
