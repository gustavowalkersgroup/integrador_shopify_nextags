export function assertCron(request: Request): void {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) throw new Response("CRON_SECRET ausente", { status: 500 });
  if (request.headers.get("Authorization") !== `Bearer ${esperado}`) {
    throw new Response("não autorizado", { status: 401 });
  }
}
