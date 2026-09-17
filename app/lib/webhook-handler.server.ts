import { prisma } from "~/db.server";
import { decrypt } from "~/lib/crypto.server";
import { claimEvent, dedupKeyOrderStatus, dedupKeyWebhook } from "~/lib/dedup.server";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import {
  logException,
  logFailure,
  logSkipped,
  logStart,
  logSuccess,
} from "~/lib/eventlog.server";
import { mapTopic } from "~/lib/events";
import type { LineItem } from "~/lib/normalize";
import {
  buildCanonical,
  EmptyCufError,
  MissingFlowError,
  MissingPhoneError,
} from "~/lib/nextags/payload";

export type HandleArgs = {
  shop: string;
  topic: string;
  webhookId: string;
  payload: unknown;
};

export type Outcome =
  | "dispatched"
  | "duplicate"
  | "log_only"
  | "skipped"
  | "uninstalled"
  | "compliance"
  | "failed"
  | "unknown";

/** Payload de webhook nao e confiavel: chega como JSON arbitrario. */
function objeto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
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

function primeiroTexto(v: unknown): string | undefined {
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
}

function lineItems(v: unknown): LineItem[] | null {
  return Array.isArray(v) ? (v as LineItem[]) : null;
}

function extrairPedido(topic: string, payload: unknown) {
  const p = objeto(payload) ?? {};

  if (topic.startsWith("fulfillments/")) {
    return {
      id: String(p.order_id ?? p.id),
      name: texto(p, "name") ?? texto(p, "order_name") ?? null,
      total: texto(p, "total_price") ?? null,
      phone: texto(p, "destination", "phone") ?? texto(p, "customer", "phone") ?? null,
      customerName:
        [texto(p, "destination", "first_name"), texto(p, "destination", "last_name")]
          .filter(Boolean)
          .join(" ") || null,
      lineItems: lineItems(p.line_items),
      tracking: texto(p, "tracking_number") ?? null,
      trackingUrl: texto(p, "tracking_url") ?? primeiroTexto(p.tracking_urls) ?? null,
    };
  }

  if (topic === "refunds/create") {
    const refundLineItems: LineItem[] | null = Array.isArray(p.refund_line_items)
      ? (p.refund_line_items as Record<string, unknown>[]).map((r) => r.line_item as LineItem)
      : null;
    return {
      id: String(p.order_id ?? p.id),
      name: texto(p, "order_name") ?? null,
      total: texto(p, "total_price") ?? null,
      phone: texto(p, "customer", "phone") ?? null,
      customerName:
        [texto(p, "customer", "first_name"), texto(p, "customer", "last_name")]
          .filter(Boolean)
          .join(" ") || null,
      lineItems: refundLineItems,
      tracking: null,
      trackingUrl: null,
    };
  }

  const fulfillment = objeto((Array.isArray(p.fulfillments) ? p.fulfillments : [])[0]);
  return {
    id: String(p.id),
    name: texto(p, "name") ?? null,
    total: texto(p, "total_price") ?? texto(p, "current_total_price") ?? null,
    phone: texto(p, "customer", "phone") ?? texto(p, "phone") ?? texto(p, "shipping_address", "phone") ?? null,
    customerName:
      [texto(p, "customer", "first_name"), texto(p, "customer", "last_name")]
        .filter(Boolean)
        .join(" ") || null,
    lineItems: lineItems(p.line_items),
    tracking: fulfillment ? texto(fulfillment, "tracking_number") ?? null : null,
    trackingUrl: fulfillment
      ? texto(fulfillment, "tracking_url") ?? primeiroTexto(fulfillment.tracking_urls) ?? null
      : null,
  };
}

export async function handleWebhook(args: HandleArgs): Promise<{ outcome: Outcome }> {
  const { shop, topic, webhookId, payload } = args;
  const resultado = mapTopic(topic, payload);

  if (resultado.kind === "compliance") return { outcome: "compliance" };
  if (resultado.kind === "unknown") return { outcome: "unknown" };

  if (resultado.kind === "internal") {
    await prisma.store.updateMany({
      where: { shopDomain: shop },
      data: { uninstalledAt: new Date() },
    });
    await prisma.storeConfig.updateMany({ where: { shopDomain: shop }, data: { enabled: false } });
    await logSkipped({ shop, topic, motivo: "app desinstalado" });
    return { outcome: "uninstalled" };
  }

  if (!(await claimEvent(shop, dedupKeyWebhook(webhookId)))) return { outcome: "duplicate" };

  if (resultado.kind === "log_only") {
    await logSkipped({ shop, topic, motivo: "topic sem disparo em v1" });
    return { outcome: "log_only" };
  }

  const event = resultado.event;

  // O dedup ja foi reivindicado acima, e isso torna esta janela critica: a
  // Shopify NAO vai reentregar este evento. A rota responde 200 mesmo em erro
  // (senao a Shopify desativa o webhook da loja apos falhas repetidas) e, se
  // reentregasse, bateria no dedup ja consumido e seria descartada como
  // duplicata. Logo, daqui pra frente TODA excecao precisa virar linha em
  // event_log — sem isso o pedido se perde deixando so um console.error, que
  // nao aparece na tela de Status e ninguem le.
  //
  // Falhas reais nesta janela, antes mesmo do logStart: o findUnique com o
  // Postgres fora do ar, e o decrypt() quando a ENCRYPTION_KEY foi rotacionada
  // sem re-encriptar os tokens (ver docs/RUNBOOK.md) — esta ultima derruba
  // todos os webhooks da loja de uma vez.
  let idAberto: bigint | null = null;
  try {
    const pedido = extrairPedido(topic, payload);

    if (!(await claimEvent(shop, dedupKeyOrderStatus(pedido.id, event)))) {
      return { outcome: "duplicate" };
    }

    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
    if (!cfg?.enabled || !cfg.nextagsTokenEnc) {
      await logSkipped({
        shop,
        topic,
        event,
        shopifyId: pedido.id,
        motivo: "loja desabilitada ou sem token",
      });
      return { outcome: "skipped" };
    }

    let canonical;
    try {
      canonical = buildCanonical({
        shop,
        event,
        token: decrypt(cfg.nextagsTokenEnc),
        flowMap: cfg.flowMap as Record<string, string>,
        cufMap: cfg.cufMap as Record<string, string>,
        order: pedido,
      });
    } catch (e) {
      // Estas tres sao decisao de negocio, nao falha: pedido sem telefone,
      // evento sem flow mapeado, CUF vazio. Viram "skipped" e param aqui.
      if (
        e instanceof MissingPhoneError ||
        e instanceof MissingFlowError ||
        e instanceof EmptyCufError
      ) {
        await logSkipped({
          shop,
          topic,
          event,
          shopifyId: pedido.id,
          motivo: `${e.constructor.name}: ${e.message}`,
        });
        return { outcome: "skipped" };
      }
      throw e;
    }

    const id = await logStart({ shop, topic, event, shopifyId: pedido.id, canonical });
    idAberto = id;

    const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode, {
      url: cfg.n8nWebhookUrl,
      secret: cfg.n8nWebhookSecretEnc ? decrypt(cfg.n8nWebhookSecretEnc) : null,
    });
    if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
    else await logFailure(id, `HTTP ${r.status} ${r.body}`, 1);

    return { outcome: "dispatched" };
  } catch (e) {
    const msg = (e as Error).message;
    if (idAberto !== null) {
      // attempts=1 => "retrying" com nextAttemptAt, entao o cron de retry
      // reprocessa em vez de a linha virar lixo silencioso.
      await logFailure(idAberto, `excecao no dispatch: ${msg}`, 1);
    } else {
      // Quebrou antes do logStart: nao ha linha pra fechar e nao ha canonical
      // pro retry reaproveitar. Registrar como "failed" e o que torna a perda
      // visivel na tela em vez de silenciosa.
      await logException({ shop, topic, event, erro: `excecao antes do dispatch: ${msg}` });
    }
    return { outcome: "failed" };
  }
}
