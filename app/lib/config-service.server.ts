import { prisma } from "~/db.server";
import { decrypt, encrypt } from "~/lib/crypto.server";
import { listFlows, validateToken } from "~/lib/nextags/client.server";
import { buildCanonical } from "~/lib/nextags/payload";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { logFailure, logStart, logSuccess } from "~/lib/eventlog.server";
import type { CanonicalEvent } from "~/lib/events";

export type Flow = { flow_id: string; flow_name: string };

export const CUF_DEFAULT: Record<string, string> = {
  numero: "NumeroPedidoSHP",
  status: "StatusPedidoSHP",
  total: "TotalPedidoSHP",
  rastreio: "RastreioPedidoSHP",
  rastreio_url: "RastreioUrlSHP",
  itens: "ItensPedidoSHP",
};

export async function salvarToken(
  shop: string,
  token: string,
): Promise<{ ok: boolean; message?: string; flows?: Flow[] }> {
  const v = await validateToken(token);
  if (!v.ok) return { ok: false, message: v.message };

  let flows: Flow[] = [];
  try {
    flows = await listFlows(token);
  } catch {
    flows = []; // degrada para input manual
  }

  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      nextagsTokenEnc: encrypt(token),
      cufMap: CUF_DEFAULT,
    },
  });

  await prisma.flowCache.deleteMany({ where: { shopDomain: shop } });
  if (flows.length) {
    await prisma.flowCache.createMany({
      data: flows.map((f) => ({ shopDomain: shop, flowId: f.flow_id, flowName: f.flow_name })),
    });
  }

  return { ok: true, flows };
}

export async function salvarFlowMap(
  shop: string,
  flowMap: Record<string, string>,
): Promise<void> {
  const limpo = Object.fromEntries(
    Object.entries(flowMap).filter(([, v]) => String(v ?? "").trim() !== ""),
  );
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      flowMap: limpo,
      enabled: Boolean(limpo.order_paid) && Boolean(cfg?.nextagsTokenEnc),
    },
  });
}

export type PainelData = {
  tokenConfigurado: boolean;
  enabled: boolean;
  dispatchMode: string;
  flowMap: Record<string, string>;
  flows: Flow[];
  eventos: { id: string; topic: string; event: string | null; status: string; quando: string }[];
};

export async function carregarPainel(shop: string): Promise<PainelData> {
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  const flows = await prisma.flowCache.findMany({
    where: { shopDomain: shop },
    orderBy: { flowName: "asc" },
  });
  const eventos = await prisma.eventLog.findMany({
    where: { shopDomain: shop },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    tokenConfigurado: Boolean(cfg?.nextagsTokenEnc),
    enabled: Boolean(cfg?.enabled),
    dispatchMode: cfg?.dispatchMode ?? "n8n",
    flowMap: (cfg?.flowMap ?? {}) as Record<string, string>,
    flows: flows.map((f) => ({ flow_id: f.flowId, flow_name: f.flowName })),
    eventos: eventos.map((e) => ({
      id: String(e.id),
      topic: e.topic,
      event: e.event,
      status: e.dispatchStatus,
      quando: e.createdAt.toISOString(),
    })),
  };
}

export async function dispararTeste(
  shop: string,
  event: CanonicalEvent,
  phone: string,
): Promise<{ ok: boolean; detalhe: string }> {
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  if (!cfg?.nextagsTokenEnc) return { ok: false, detalhe: "conecte a chave NexTags primeiro" };

  let canonical;
  try {
    canonical = buildCanonical({
      shop,
      event,
      token: decrypt(cfg.nextagsTokenEnc),
      flowMap: cfg.flowMap as Record<string, string>,
      cufMap: cfg.cufMap as Record<string, string>,
      order: {
        id: `teste-${Date.now()}`,
        name: "#TESTE",
        total: "1.00",
        phone,
        customerName: "Teste NexTags",
        lineItems: [{ title: "Produto de teste", quantity: 1, price: "1.00" }],
        tracking: "TESTE123",
        trackingUrl: "https://exemplo.test/TESTE123",
      },
    });
  } catch (e) {
    return { ok: false, detalhe: (e as Error).message };
  }

  const id = await logStart({ shop, topic: "ui/teste", event, canonical });
  const r = await dispatch(canonical, cfg.dispatchMode as DispatchMode, 5000);
  if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
  else await logFailure(id, `HTTP ${r.status} ${r.body}`, 99);

  return {
    ok: r.ok,
    detalhe: `HTTP ${r.status} — ${r.body.slice(0, 200)}. Confirme o recebimento no WhatsApp: resposta de sucesso da API não prova entrega.`,
  };
}
