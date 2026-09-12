import { prisma } from "~/db.server";
import { decrypt, encrypt } from "~/lib/crypto.server";
import {
  createCustomField,
  listCustomFields,
  listFlows,
  validateToken,
} from "~/lib/nextags/client.server";
import { buildCanonical } from "~/lib/nextags/payload";
import { dispatch, type DispatchMode } from "~/lib/dispatch/index.server";
import { logFailure, logStart, logSuccess } from "~/lib/eventlog.server";
import { CUF_DEFAULT } from "~/lib/cufs";
import type { CanonicalEvent } from "~/lib/events";

export type Flow = { flow_id: string; flow_name: string };

// Reexportado para nao quebrar quem ja importa daqui (tests/config-service).
// A fonte e ~/lib/cufs — ver o porque la.
export { CUF_DEFAULT };

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
  // O gate real de disparo e o token: handleWebhook e as rotas de cron
  // conferem cfg.nextagsTokenEnc de novo antes de montar o payload, mesmo
  // com enabled=true. Aqui "enabled" so reflete se ha pra onde notificar.
  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      flowMap: limpo,
      enabled: Boolean(limpo.order_paid),
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
  n8nWebhookUrl: string | null;
  n8nSecretConfigurado: boolean;
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
    n8nWebhookUrl: cfg?.n8nWebhookUrl ?? null,
    n8nSecretConfigurado: Boolean(cfg?.n8nWebhookSecretEnc),
  };
}

export async function salvarN8n(shop: string, url: string, secret: string): Promise<void> {
  const urlLimpa = url.trim();
  await prisma.storeConfig.update({
    where: { shopDomain: shop },
    data: {
      n8nWebhookUrl: urlLimpa || null,
      // Mantem o secret anterior se o campo vier vazio (evita apagar por
      // engano ao so trocar a URL); troca so quando um valor novo e colado.
      ...(secret.trim() ? { n8nWebhookSecretEnc: encrypt(secret.trim()) } : {}),
    },
  });
}

export type ResultadoCuf = { nome: string; status: string };

// Os CUFs precisam existir na conta NexTags do lojista antes do primeiro
// disparo (set_field_value falha em silêncio se o campo nao existir la).
// Cria so os que faltarem e devolve a lista completa dos nomes pra
// aparecer na tela, mesmo quando ja existiam — e o que o cliente cola no
// texto do flow (ex.: {{NumeroPedidoSHP}}).
export async function criarCufsPadrao(
  shop: string,
): Promise<{ ok: boolean; message?: string; resultados?: ResultadoCuf[] }> {
  const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
  if (!cfg?.nextagsTokenEnc) return { ok: false, message: "conecte a chave NexTags primeiro" };
  const token = decrypt(cfg.nextagsTokenEnc);

  let existentes: { name: string }[];
  try {
    existentes = await listCustomFields(token);
  } catch (e) {
    return { ok: false, message: `Não consegui listar os campos existentes: ${(e as Error).message}` };
  }
  const nomesExistentes = new Set(existentes.map((f) => f.name));

  const resultados: ResultadoCuf[] = [];
  for (const nome of Object.values(CUF_DEFAULT)) {
    if (nomesExistentes.has(nome)) {
      resultados.push({ nome, status: "já existia" });
      continue;
    }
    const r = await createCustomField(token, nome);
    resultados.push({
      nome,
      status: r.ok ? "criado agora" : `erro (HTTP ${r.status}): ${r.body.slice(0, 200)}`,
    });
  }
  return { ok: true, resultados };
}

export async function dispararTeste(
  shop: string,
  event: CanonicalEvent,
  phone: string,
): Promise<{ ok: boolean; detalhe: string }> {
  // Ponto de entrada acionado por clique na tela embedded: nunca pode
  // deixar um erro escapar sem tratar. A rota (app._index.tsx) so tem
  // ErrorBoundary generico (via app.tsx), entao uma excecao aqui vira
  // "Application Error" pro lojista em vez de uma mensagem util.
  try {
    const cfg = await prisma.storeConfig.findUnique({ where: { shopDomain: shop } });
    if (!cfg?.nextagsTokenEnc) return { ok: false, detalhe: "conecte a chave NexTags primeiro" };

    const canonical = buildCanonical({
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

    const id = await logStart({ shop, topic: "ui/teste", event, canonical });
    const r = await dispatch(
      canonical,
      cfg.dispatchMode as DispatchMode,
      { url: cfg.n8nWebhookUrl, secret: cfg.n8nWebhookSecretEnc ? decrypt(cfg.n8nWebhookSecretEnc) : null },
      5000,
    );
    if (r.ok) await logSuccess(id, `HTTP ${r.status} ${r.body}`);
    else await logFailure(id, `HTTP ${r.status} ${r.body}`, 99);

    return {
      ok: r.ok,
      detalhe: `HTTP ${r.status} — ${r.body.slice(0, 200)}. Confirme o recebimento no WhatsApp: resposta de sucesso da API não prova entrega.`,
    };
  } catch (e) {
    return { ok: false, detalhe: `Erro inesperado ao disparar o teste: ${(e as Error).message}` };
  }
}
