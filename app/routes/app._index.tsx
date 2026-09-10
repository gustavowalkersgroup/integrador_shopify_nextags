import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "~/shopify.server";
import {
  carregarPainel,
  dispararTeste,
  salvarFlowMap,
  salvarToken,
  type PainelData,
} from "~/lib/config-service.server";
import type { CanonicalEvent } from "~/lib/events";

const EVENTOS: { key: CanonicalEvent; label: string }[] = [
  { key: "order_paid", label: "Pedido pago" },
  { key: "order_fulfilled", label: "Pedido enviado" },
  { key: "ready_pickup", label: "Pronto para retirada" },
  { key: "order_delivered", label: "Pedido entregue" },
  { key: "order_cancelled", label: "Pedido cancelado" },
  { key: "abandoned_cart", label: "Carrinho abandonado" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return Response.json(await carregarPainel(session.shop));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "token") {
    return Response.json(await salvarToken(session.shop, String(form.get("token") ?? "").trim()));
  }
  if (intent === "flows") {
    const flowMap: Record<string, string> = {};
    for (const e of EVENTOS) flowMap[e.key] = String(form.get(e.key) ?? "");
    await salvarFlowMap(session.shop, flowMap);
    return Response.json({ ok: true });
  }
  if (intent === "teste") {
    return Response.json(
      await dispararTeste(
        session.shop,
        String(form.get("event")) as CanonicalEvent,
        String(form.get("phone") ?? ""),
      ),
    );
  }
  return Response.json({ ok: false, message: "intent desconhecida" }, { status: 400 });
};

export default function Index() {
  const data = useLoaderData<PainelData>();
  const tokenFetcher = useFetcher<{ ok: boolean; message?: string }>();
  const flowsFetcher = useFetcher<{ ok: boolean }>();
  const testeFetcher = useFetcher<{ ok: boolean; detalhe: string }>();

  return (
    <s-page heading="NexTags">
      <s-section heading="Conexão NexTags">
        <s-stack gap="base">
          <s-paragraph>
            Para pegar a chave na NexTags: Configurações → Integrações → Chave de API do NexTags
            AI. Gere a chave caso ainda não tenha, copie o valor e cole aqui.
          </s-paragraph>
          {data.tokenConfigurado && <s-badge tone="success">Chave configurada</s-badge>}
          {tokenFetcher.data && !tokenFetcher.data.ok && (
            <s-banner tone="critical" heading="Não foi possível validar a chave">
              {tokenFetcher.data.message}
            </s-banner>
          )}
          <tokenFetcher.Form method="post">
            <input type="hidden" name="intent" value="token" />
            <s-stack gap="base">
              <s-password-field label="Chave de API" name="token" autocomplete="off" />
              <s-button type="submit" variant="primary" loading={tokenFetcher.state !== "idle" || undefined}>
                Salvar e validar
              </s-button>
            </s-stack>
          </tokenFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading="Notificações por evento">
        <s-stack gap="base">
          {data.flows.length === 0 && data.tokenConfigurado && (
            <s-banner tone="warning" heading="Lista de flows indisponível">
              Não foi possível listar os flows da sua conta. Cole o ID do flow manualmente e use o
              teste de disparo para confirmar — um ID errado falha em silêncio.
            </s-banner>
          )}
          <flowsFetcher.Form method="post">
            <input type="hidden" name="intent" value="flows" />
            <s-stack gap="base">
              {EVENTOS.map((e) =>
                data.flows.length ? (
                  <s-select key={e.key} label={e.label} name={e.key} value={data.flowMap[e.key] ?? ""}>
                    <s-option value="">— não notificar —</s-option>
                    {data.flows.map((f) => (
                      <s-option key={f.flow_id} value={f.flow_id}>
                        {f.flow_name} ({f.flow_id})
                      </s-option>
                    ))}
                  </s-select>
                ) : (
                  <s-text-field
                    key={e.key}
                    label={`${e.label} — ID do flow`}
                    name={e.key}
                    value={data.flowMap[e.key] ?? ""}
                    autocomplete="off"
                  />
                ),
              )}
              <s-button type="submit" variant="primary" loading={flowsFetcher.state !== "idle" || undefined}>
                Salvar notificações
              </s-button>
            </s-stack>
          </flowsFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading="Teste de disparo">
        <s-stack gap="base">
          {testeFetcher.data && (
            <s-banner tone={testeFetcher.data.ok ? "success" : "critical"}>
              {testeFetcher.data.detalhe}
            </s-banner>
          )}
          <testeFetcher.Form method="post">
            <input type="hidden" name="intent" value="teste" />
            <s-stack gap="base">
              <s-select label="Evento" name="event" value="order_paid">
                {EVENTOS.map((e) => (
                  <s-option key={e.key} value={e.key}>
                    {e.label}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label="WhatsApp de teste"
                name="phone"
                autocomplete="off"
                placeholder="Ex.: 19955556666"
              />
              <s-button type="submit" loading={testeFetcher.state !== "idle" || undefined}>
                Disparar teste
              </s-button>
            </s-stack>
          </testeFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading="Status">
        <s-stack gap="base">
          <s-badge tone={data.enabled ? "success" : "warning"}>
            {data.enabled ? "Notificações ativas" : "Notificações inativas"}
          </s-badge>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Quando</s-table-header>
              <s-table-header>Topic</s-table-header>
              <s-table-header>Evento</s-table-header>
              <s-table-header>Resultado</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.eventos.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.quando}</s-table-cell>
                  <s-table-cell>{e.topic}</s-table-cell>
                  <s-table-cell>{e.event ?? "—"}</s-table-cell>
                  <s-table-cell>{e.status}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>
    </s-page>
  );
}
