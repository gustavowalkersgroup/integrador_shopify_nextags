import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/db.server";
import { assertCron } from "~/lib/cron-auth.server";

export const RETENCAO_DIAS = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertCron(request);
  const corte = new Date(Date.now() - RETENCAO_DIAS * 24 * 3600_000);

  // Linhas em retry ficam: purgar mataria a fila de reenvio.
  const { count } = await prisma.eventLog.deleteMany({
    where: { createdAt: { lt: corte }, dispatchStatus: { not: "retrying" } },
  });

  return Response.json({ purgados: count, corte: corte.toISOString() });
};
