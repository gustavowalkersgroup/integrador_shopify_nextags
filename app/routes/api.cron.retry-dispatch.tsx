import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/db.server";
import { assertCron } from "~/lib/cron-auth.server";
import { decrypt } from "~/lib/crypto.server";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { dueForRetry, logFailure, logSuccess } from "~/lib/eventlog.server";
import type { CanonicalPayload } from "~/lib/nextags/payload";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertCron(request);
  const pendentes = await dueForRetry(25);
  const resumo = { tentados: 0, ok: 0, falhos: 0 };

  for (const row of pendentes) {
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: row.shopDomain } });
    if (!cfg?.enabled || !cfg.nextagsTokenEnc || !row.canonical) {
      await logFailure(row.id, "loja desabilitada ou payload ausente", 99);
      continue;
    }
    resumo.tentados++;

    // Uma excecao aqui era duplamente ruim: abortava o loader inteiro (as linhas
    // seguintes do lote nem eram tentadas) e deixava ESTA linha em "retrying"
    // com o nextAttemptAt antigo — como dueForRetry ordena por nextAttemptAt
    // asc, ela voltava ao topo em toda execucao e travava a fila para sempre.
    // Fechar a linha com attempts+1 garante que ela sempre avanca.
    //
    // O `decrypt` fica DENTRO do try: ele lanca quando o ciphertext nao abre
    // com a ENCRYPTION_KEY atual (chave rotacionada sem re-encriptar os tokens,
    // valor truncado no banco). Fora do try, uma unica loja nesse estado
    // derrubava o lote inteiro de TODAS as lojas e se reagendava no topo da
    // fila — o mesmo poison pill que o paragrafo acima descreve, por outra
    // porta.
    try {
      // canonical foi gravado com o token redigido; reinjeta o token atual.
      const canonicalSalvo = row.canonical as unknown as CanonicalPayload;
      const payload: CanonicalPayload = {
        ...canonicalSalvo,
        nextags: { ...canonicalSalvo.nextags, token: decrypt(cfg.nextagsTokenEnc) },
      };

      const r = await dispatch(payload, cfg.dispatchMode as DispatchMode);
      if (r.ok) {
        await logSuccess(row.id, `retry HTTP ${r.status} ${r.body}`);
        resumo.ok++;
      } else {
        await logFailure(row.id, `retry HTTP ${r.status} ${r.body}`, row.attempts + 1);
        resumo.falhos++;
      }
    } catch (e) {
      await logFailure(row.id, `retry excecao: ${(e as Error).message}`, row.attempts + 1);
      resumo.falhos++;
    }
  }

  return Response.json(resumo);
};
