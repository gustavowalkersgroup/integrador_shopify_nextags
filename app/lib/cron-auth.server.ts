import { timingSafeEqual } from "node:crypto";

/**
 * Valida o Bearer dos endpoints de cron (quem agenda e o n8n, via Header Auth).
 *
 * A comparacao e constant-time de proposito. `!==` de string em JS aborta no
 * primeiro byte diferente, e este e o unico portao de autenticacao das rotas
 * de cron — um atacante que consiga medir a latencia recupera o segredo byte
 * a byte. O jitter de rede e o cold start do serverless tornam o ataque
 * pouco pratico, mas o custo de fechar e uma linha.
 */
export function assertCron(request: Request): void {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) throw new Response("CRON_SECRET ausente", { status: 500 });

  const recebido = Buffer.from(request.headers.get("Authorization") ?? "");
  const alvo = Buffer.from(`Bearer ${esperado}`);

  // timingSafeEqual exige buffers do mesmo tamanho. O check de tamanho em si
  // nao e constant-time, mas o comprimento do segredo nao e o segredo.
  if (recebido.length !== alvo.length || !timingSafeEqual(recebido, alvo)) {
    throw new Response("não autorizado", { status: 401 });
  }
}
