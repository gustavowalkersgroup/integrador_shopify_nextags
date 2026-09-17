import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";
import { redactCanonical, type CanonicalPayload } from "~/lib/nextags/payload";

export const BACKOFF_MS = [30_000, 300_000, 1_800_000];

type StartArgs = {
  shop: string;
  topic: string;
  event?: string | null;
  shopifyId?: string | null;
  canonical?: CanonicalPayload | null;
};

export async function logStart(args: StartArgs): Promise<bigint> {
  const row = await prisma.eventLog.create({
    data: {
      shopDomain: args.shop,
      topic: args.topic,
      event: args.event ?? null,
      shopifyId: args.shopifyId ?? null,
      dispatchStatus: "pending",
      canonical: args.canonical
        ? (redactCanonical(args.canonical) as unknown as Prisma.InputJsonValue)
        : undefined,
      payloadHash: args.canonical
        ? createHash("sha256").update(JSON.stringify(redactCanonical(args.canonical))).digest("hex")
        : null,
    },
    select: { id: true },
  });
  return row.id;
}

export async function logSuccess(id: bigint, response: string): Promise<void> {
  await prisma.eventLog.update({
    where: { id },
    data: {
      dispatchStatus: "ok",
      nextagsResponse: response.slice(0, 2000),
      nextAttemptAt: null,
      attempts: { increment: 1 },
    },
  });
}

export async function logFailure(id: bigint, response: string, attempts: number): Promise<void> {
  const delay = BACKOFF_MS[attempts - 1];
  await prisma.eventLog.update({
    where: { id },
    data: {
      dispatchStatus: delay ? "retrying" : "failed",
      nextagsResponse: response.slice(0, 2000),
      attempts,
      nextAttemptAt: delay ? new Date(Date.now() + delay) : null,
    },
  });
}

/**
 * Registra uma falha que aconteceu ANTES de existir linha aberta.
 *
 * `logFailure` exige o id de uma linha que o `logStart` ja criou. Quando a
 * excecao acontece antes disso — e no handler de webhook ela pode, porque o
 * dedup ja foi reivindicado la em cima — nao ha id nenhum, e sem esta funcao
 * o evento sumia sem deixar registro: a Shopify recebe 200 e nao reentrega, a
 * reentrega bateria no dedup consumido, e a tela de Status nao mostra nada.
 *
 * Grava direto como "failed", e nao "skipped": "skipped" significa decisao
 * deliberada de nao disparar (loja desabilitada, pedido sem telefone) e some
 * no meio das linhas normais. Sem `canonical` o cron de retry nao teria como
 * reprocessar, entao a linha nao entra na fila — ela existe pra que a falha
 * apareca e alguem possa agir.
 */
export async function logException(args: StartArgs & { erro: string }): Promise<void> {
  await prisma.eventLog.create({
    data: {
      shopDomain: args.shop,
      topic: args.topic,
      event: args.event ?? null,
      shopifyId: args.shopifyId ?? null,
      dispatchStatus: "failed",
      attempts: 1,
      nextagsResponse: args.erro.slice(0, 2000),
    },
  });
}

export async function logSkipped(args: StartArgs & { motivo: string }): Promise<void> {
  await prisma.eventLog.create({
    data: {
      shopDomain: args.shop,
      topic: args.topic,
      event: args.event ?? null,
      shopifyId: args.shopifyId ?? null,
      dispatchStatus: "skipped",
      nextagsResponse: args.motivo.slice(0, 2000),
    },
  });
}

export async function dueForRetry(limit = 25) {
  return prisma.eventLog.findMany({
    where: { dispatchStatus: "retrying", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
}
