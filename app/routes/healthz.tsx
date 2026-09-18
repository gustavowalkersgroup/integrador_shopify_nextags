import { prisma } from "~/db.server";

/**
 * Liveness/readiness pro host (HEALTHCHECK do Docker, load balancer da VPS).
 *
 * Toca o banco de proposito: um processo que responde mas perdeu o Postgres
 * nao consegue gravar `event_log` nem ler `store_config`, entao aceitar
 * webhook nesse estado significa perder pedido. 503 aqui faz o host reiniciar
 * ou tirar a instancia do balanceamento em vez de deixa-la engolir trafego.
 *
 * Sem `assertCron`: o healthcheck roda de dentro do container, antes de
 * qualquer secret estar em jogo, e nao expoe nada — a resposta e so ok
 * true/false. O detalhe do erro NAO vai no corpo: a mensagem do Prisma
 * carrega a connection string, e esta rota e publica.
 */
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
};
