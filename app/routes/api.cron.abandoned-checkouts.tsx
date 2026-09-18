import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/db.server";
import { unauthenticated } from "~/shopify.server";
import { assertCron } from "~/lib/cron-auth.server";
import { ABANDONED_QUERY, elegivelParaDisparo } from "~/lib/abandoned.server";
import { claimEvent, dedupKeyCart } from "~/lib/dedup.server";
import { decrypt } from "~/lib/crypto.server";
import { buildCanonical } from "~/lib/nextags/payload";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import {
  logFailure,
  logSkipped,
  logStart,
  logSuccess,
} from "~/lib/eventlog.server";

// Forma da resposta do ABANDONED_QUERY (ver app/lib/abandoned.server.ts).
type AbandonedCheckoutNode = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  abandonedCheckoutUrl: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string } };
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  lineItems?: {
    edges?: {
      node: {
        title: string;
        quantity: number;
        originalUnitPriceSet?: { shopMoney?: { amount?: string } };
      };
    }[];
  };
};

type AbandonedCheckoutsResponse = {
  data?: { abandonedCheckouts?: { edges?: { node: AbandonedCheckoutNode }[] } };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertCron(request);
  const agora = new Date();
  const resumo = {
    lojas: 0,
    candidatos: 0,
    disparados: 0,
    ignorados: 0,
    lojasComFalha: 0,
  };

  const lojas = await prisma.store.findMany({
    where: { uninstalledAt: null, config: { enabled: true } },
    include: { config: true },
  });

  for (const loja of lojas) {
    resumo.lojas++;
    const cfg = loja.config!;
    if (!cfg.nextagsTokenEnc) continue;

    // Todo o processamento DESTA loja vai dentro do try. O catch la embaixo
    // existe porque as tres chamadas seguintes falham por motivo alheio a
    // qualquer configuracao: `unauthenticated.admin` lanca quando a sessao
    // offline sumiu ou expirou (e o app roda com
    // `expiringOfflineAccessTokens: true`), e o `graphql` lanca em 429 ou 5xx
    // da Shopify. Sem o catch, UMA loja nesse estado abortava o loader inteiro
    // e as lojas seguintes do lote nunca eram processadas — como a ordem do
    // findMany e estavel, eram sempre as mesmas lojas, em toda execucao do
    // cron. O try que ja existia mais abaixo so cobre o dispatch, depois de
    // essas chamadas terem dado certo.
    try {
      const { admin } = await unauthenticated.admin(loja.shopDomain);
      const res = await admin.graphql(ABANDONED_QUERY, {
        variables: { first: 50 },
      });
      const json = (await res.json()) as AbandonedCheckoutsResponse;
      const nodes = (json.data?.abandonedCheckouts?.edges ?? []).map(
        (e) => e.node,
      );

      for (const c of nodes) {
        resumo.candidatos++;
        const elegivel = elegivelParaDisparo(c, agora);
        if (!elegivel.ok) {
          resumo.ignorados++;
          continue;
        }
        if (!(await claimEvent(loja.shopDomain, dedupKeyCart(c.id)))) {
          resumo.ignorados++;
          continue;
        }

        let canonical;
        try {
          canonical = buildCanonical({
            shop: loja.shopDomain,
            event: "abandoned_cart",
            token: decrypt(cfg.nextagsTokenEnc),
            flowMap: cfg.flowMap as Record<string, string>,
            cufMap: cfg.cufMap as Record<string, string>,
            order: {
              id: c.id,
              name: null,
              total: c.totalPriceSet?.shopMoney?.amount ?? null,
              phone: c.customer?.phone ?? null,
              customerName:
                [c.customer?.firstName, c.customer?.lastName]
                  .filter(Boolean)
                  .join(" ") || null,
              lineItems: (c.lineItems?.edges ?? []).map((e) => ({
                title: e.node.title,
                quantity: e.node.quantity,
                price: e.node.originalUnitPriceSet?.shopMoney?.amount,
              })),
              tracking: c.abandonedCheckoutUrl ?? null,
              trackingUrl: c.abandonedCheckoutUrl ?? null,
            },
          });
        } catch (e) {
          resumo.ignorados++;
          await logSkipped({
            shop: loja.shopDomain,
            topic: "cron/abandoned",
            event: "abandoned_cart",
            shopifyId: c.id,
            motivo: (e as Error).message,
          });
          continue;
        }

        const id = await logStart({
          shop: loja.shopDomain,
          topic: "cron/abandoned",
          event: "abandoned_cart",
          shopifyId: c.id,
          canonical,
        });
        // Loop multi-tenant: sem este catch, uma unica loja com configuracao ruim
        // abortava a execucao inteira e as lojas seguintes nem eram processadas —
        // e o dedup dos carrinhos ja reivindicados ficava queimado.
        try {
          const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode);
          if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
          else await logFailure(id, `HTTP ${r.status} ${r.body}`, 1);
        } catch (e) {
          await logFailure(
            id,
            `excecao no dispatch: ${(e as Error).message}`,
            1,
          );
        }
        resumo.disparados++;

        // Anti-429: NexTags tem rate limit. Um item por vez, com intervalo.
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      // Esta loja fica para a proxima execucao do cron; as demais do lote
      // seguem. Nada de dedup foi queimado aqui: o claimEvent so acontece
      // dentro do loop interno, ja depois da Admin API ter respondido.
      resumo.lojasComFalha++;
      await logSkipped({
        shop: loja.shopDomain,
        topic: "cron/abandoned",
        motivo: `falha ao consultar a loja: ${(e as Error).message}`,
      });
    }
  }

  return Response.json(resumo);
};
