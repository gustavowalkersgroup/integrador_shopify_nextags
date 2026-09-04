import type { CanonicalEvent } from "~/lib/events";
import { normalizarTelefoneBR } from "~/lib/phone";
import type { LineItem } from "~/lib/normalize";
import {
  formatarItens,
  formatarMoeda,
  limparNumeroPedido,
  separarNomeSobrenome,
  verificarDado,
} from "~/lib/normalize";

export class EmptyCufError extends Error {}
export class MissingPhoneError extends Error {}
export class MissingFlowError extends Error {}

export type Action =
  | { action: "set_field_value"; field_name: string; value: string }
  | { action: "add_tag"; tag_name: string }
  | { action: "send_flow"; flow_id: string };

export type CanonicalPayload = {
  schema: 1;
  event: CanonicalEvent;
  shop: string;
  customer: { first_name: string; last_name: string; phone: string };
  order: {
    id: string;
    number: string;
    total: string;
    items: string;
    tracking: string;
    tracking_url: string;
  };
  nextags: { token: string; flow_id: string; cuf: Record<string, string>; tags: string[] };
};

export type BuildInput = {
  shop: string;
  event: CanonicalEvent;
  token: string;
  flowMap: Record<string, string | undefined>;
  cufMap: Record<string, string>;
  order: {
    id: string;
    name?: string | null;
    total?: string | number | null;
    phone?: string | null;
    customerName?: string | null;
    lineItems?: LineItem[] | null;
    tracking?: string | null;
    trackingUrl?: string | null;
  };
};

const FLOW_FALLBACK: Partial<Record<CanonicalEvent, CanonicalEvent>> = {
  ready_pickup: "order_fulfilled",
  order_refunded: "order_cancelled",
};

const STATUS_LABEL: Record<CanonicalEvent, string> = {
  order_paid: "Pago",
  order_fulfilled: "Enviado",
  ready_pickup: "Pronto para retirada",
  order_delivered: "Entregue",
  order_cancelled: "Cancelado",
  order_refunded: "Reembolsado",
  abandoned_cart: "Carrinho abandonado",
};

const TAG: Record<CanonicalEvent, string> = {
  order_paid: "pedido-pago",
  order_fulfilled: "pedido-enviado",
  ready_pickup: "pedido-retirada",
  order_delivered: "pedido-entregue",
  order_cancelled: "pedido-cancelado",
  order_refunded: "pedido-reembolsado",
  abandoned_cart: "carrinho-abandonado",
};

export function resolveFlowId(
  event: CanonicalEvent,
  flowMap: Record<string, string | undefined>,
): string {
  const direto = flowMap[event];
  if (direto && String(direto).trim()) return String(direto).trim();
  const fb = FLOW_FALLBACK[event];
  const alternativo = fb ? flowMap[fb] : undefined;
  if (alternativo && String(alternativo).trim()) return String(alternativo).trim();
  throw new MissingFlowError(`sem flow_id configurado para ${event}`);
}

export function buildActions(
  cuf: Record<string, string>,
  tags: string[],
  flowId: string,
): Action[] {
  const actions: Action[] = [];
  for (const [field_name, value] of Object.entries(cuf)) {
    if (!String(value ?? "").trim()) {
      throw new EmptyCufError(`CUF vazio: ${field_name}`);
    }
    actions.push({ action: "set_field_value", field_name, value: String(value) });
  }
  for (const tag_name of tags) actions.push({ action: "add_tag", tag_name });
  actions.push({ action: "send_flow", flow_id: flowId });
  return actions;
}

export function buildCanonical(input: BuildInput): CanonicalPayload {
  const phone = normalizarTelefoneBR(input.order.phone);
  if (!phone) throw new MissingPhoneError("telefone ausente ou inválido");

  const flowId = resolveFlowId(input.event, input.flowMap);
  const { first_name, last_name } = separarNomeSobrenome(input.order.customerName);
  const numero = limparNumeroPedido(input.order.name);

  const valores: Record<string, string> = {
    numero,
    status: STATUS_LABEL[input.event],
    total: formatarMoeda(input.order.total),
    rastreio: verificarDado(input.order.tracking),
    rastreio_url: verificarDado(input.order.trackingUrl),
    itens: formatarItens(input.order.lineItems),
  };

  const cuf: Record<string, string> = {};
  for (const [chave, fieldName] of Object.entries(input.cufMap)) {
    if (!fieldName) continue;
    cuf[fieldName] = verificarDado(valores[chave]);
  }

  return {
    schema: 1,
    event: input.event,
    shop: input.shop,
    customer: { first_name, last_name, phone },
    order: {
      id: String(input.order.id),
      number: numero,
      total: formatarMoeda(input.order.total),
      items: formatarItens(input.order.lineItems),
      tracking: verificarDado(input.order.tracking),
      tracking_url: verificarDado(input.order.trackingUrl),
    },
    nextags: { token: input.token, flow_id: flowId, cuf, tags: [TAG[input.event]] },
  };
}

export function redactCanonical(p: CanonicalPayload): CanonicalPayload {
  return { ...p, nextags: { ...p.nextags, token: "[REDACTED]" } };
}
