import { prisma } from "~/db.server";

/** Payload de webhook nao e confiavel: chega como JSON arbitrario. */
function objeto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export async function handleCompliance(args: {
  shop: string;
  topic: string;
  payload: unknown;
}): Promise<void> {
  const { shop, topic, payload } = args;

  if (topic === "shop/redact") {
    await prisma.eventLog.deleteMany({ where: { shopDomain: shop } });
    await prisma.eventDedup.deleteMany({ where: { shopDomain: shop } });
    await prisma.flowCache.deleteMany({ where: { shopDomain: shop } });
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.store.deleteMany({ where: { shopDomain: shop } });
    return;
  }

  if (topic === "customers/redact") {
    const bruto = objeto(payload)?.orders_to_redact;
    const ids: string[] = Array.isArray(bruto) ? bruto.map(String) : [];
    if (ids.length) {
      await prisma.eventLog.deleteMany({ where: { shopDomain: shop, shopifyId: { in: ids } } });
    }
    await prisma.eventLog.create({
      data: {
        shopDomain: shop,
        topic,
        dispatchStatus: "skipped",
        nextagsResponse: `redigidos: ${ids.length} evento(s)`,
      },
    });
    return;
  }

  // customers/data_request: o app nao guarda dados de cliente alem do event_log.
  await prisma.eventLog.create({
    data: {
      shopDomain: shop,
      topic,
      dispatchStatus: "skipped",
      nextagsResponse: "pedido de dados registrado; nenhum dado de cliente armazenado fora do log",
    },
  });
}
