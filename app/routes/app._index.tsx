import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "~/shopify.server";
import {
  carregarPainel,
  criarCufsPadrao,
  CUF_DEFAULT,
  dispararTeste,
  salvarFlowMap,
  salvarN8n,
  salvarToken,
  type PainelData,
  type ResultadoCuf,
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

type LoaderData = PainelData & { shop: string; accessToken: string | null };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const painel = await carregarPainel(session.shop);
  return Response.json({
    ...painel,
    shop: session.shop,
    accessToken: session.accessToken ?? null,
  });
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
  if (intent === "cufs") {
    return Response.json(await criarCufsPadrao(session.shop));
  }
  if (intent === "n8n") {
    await salvarN8n(
      session.shop,
      String(form.get("n8nWebhookUrl") ?? ""),
      String(form.get("n8nWebhookSecret") ?? ""),
    );
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, message: "intent desconhecida" }, { status: 400 });
};

/** Campo somente-leitura com botão de copiar — usado pra credenciais/URLs que o cliente cola em outro lugar (n8n, etc). */
function CampoCopiavel({
  label,
  value,
  mascarado,
}: {
  label: string;
  value: string;
  mascarado?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const Campo = mascarado ? "s-password-field" : "s-text-field";
  return (
    <s-stack gap="base">
      <Campo label={label} value={value} readOnly autocomplete="off" />
      <s-button
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
      >
        {copiado ? "Copiado!" : "Copiar"}
      </s-button>
    </s-stack>
  );
}

export default function Index() {
  const data = useLoaderData<LoaderData>();
  const tokenFetcher = useFetcher<{ ok: boolean; message?: string }>();
  const flowsFetcher = useFetcher<{ ok: boolean }>();
  const testeFetcher = useFetcher<{ ok: boolean; detalhe: string }>();
  const n8nFetcher = useFetcher<{ ok: boolean }>();
  const cufsFetcher = useFetcher<{ ok: boolean; message?: string; resultados?: ResultadoCuf[] }>();

  const storefrontMcpUrl = `https://${data.shop}/api/mcp`;
  const customerAccountDiscoveryUrl = `https://${data.shop}/.well-known/openid-configuration`;

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

      <s-section heading="Campos personalizados (CUFs)">
        <s-stack gap="base">
          <s-paragraph>
            Os eventos disparados por esse app preenchem estes campos na
            NexTags — usa os nomes abaixo entre chaves duplas (ex.:{" "}
            {"{{NumeroPedidoSHP}}"}) no texto do flow pra aparecer o dado do
            pedido na mensagem. Clique em "Criar campos" pra garantir que
            todos existam na sua conta NexTags (os que já existirem não são
            duplicados).
          </s-paragraph>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header>Campo</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {Object.values(CUF_DEFAULT).map((nome) => {
                const resultado = cufsFetcher.data?.resultados?.find((r) => r.nome === nome);
                return (
                  <s-table-row key={nome}>
                    <s-table-cell>{nome}</s-table-cell>
                    <s-table-cell>{resultado?.status ?? "—"}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {cufsFetcher.data && !cufsFetcher.data.ok && (
            <s-banner tone="critical">{cufsFetcher.data.message}</s-banner>
          )}
          <cufsFetcher.Form method="post">
            <input type="hidden" name="intent" value="cufs" />
            <s-button type="submit" loading={cufsFetcher.state !== "idle" || undefined}>
              Criar campos
            </s-button>
          </cufsFetcher.Form>
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

      <s-section heading="Webhook n8n">
        <s-stack gap="base">
          <s-paragraph>
            Por padrão os disparos vão pro workflow n8n compartilhado. Se essa loja tem um workflow
            próprio, cole a URL do webhook (e o secret, se o workflow validar) — passa a valer só
            pra ela.
          </s-paragraph>
          {data.n8nWebhookUrl && <s-badge tone="success">Webhook próprio configurado</s-badge>}
          <n8nFetcher.Form method="post">
            <input type="hidden" name="intent" value="n8n" />
            <s-stack gap="base">
              <s-text-field
                label="URL do webhook n8n"
                name="n8nWebhookUrl"
                autocomplete="off"
                value={data.n8nWebhookUrl ?? ""}
                placeholder="https://seu-n8n.exemplo.com/webhook/shopify"
              />
              <s-password-field
                label={
                  data.n8nSecretConfigurado
                    ? "Secret do webhook (configurado — deixe em branco pra manter)"
                    : "Secret do webhook (opcional)"
                }
                name="n8nWebhookSecret"
                autocomplete="off"
              />
              <s-button type="submit" variant="primary" loading={n8nFetcher.state !== "idle" || undefined}>
                Salvar webhook n8n
              </s-button>
            </s-stack>
          </n8nFetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading="Credencial Shopify pro n8n">
        <s-stack gap="base">
          <s-paragraph>
            Pra montar no n8n uma credencial de Header Auth (ou HTTP Request) que fale direto com a
            Admin API dessa loja, use o domínio e o token abaixo. O token vale os escopos do app
            enquanto ele estiver instalado — trate como senha, não cole em lugar nenhum fora do n8n.
          </s-paragraph>
          <CampoCopiavel label="Domínio da loja" value={data.shop} />
          <CampoCopiavel
            label="Admin API access token"
            value={data.accessToken ?? "indisponível"}
            mascarado
          />
        </s-stack>
      </s-section>

      <s-section heading="MCP da loja (agentes de IA)">
        <s-stack gap="base">
          <s-paragraph>
            Endpoints MCP (Model Context Protocol) da própria Shopify, pra plugar num agente de IA
            (ex.: node MCP Client no n8n) sem passar pela API NexTags.
          </s-paragraph>
          <s-paragraph>
            <strong>Storefront MCP</strong> — catálogo, busca de produtos e políticas da loja.
            Público, sem autenticação.
          </s-paragraph>
          <CampoCopiavel label="Storefront MCP" value={storefrontMcpUrl} />
          <s-paragraph>
            <strong>Customer Accounts MCP</strong> — ações em nome de um cliente logado (pedidos,
            dados da conta). Exige OAuth 2.0: o endpoint real é descoberto a partir do documento
            abaixo (configuração OpenID Connect da loja), não é uma URL fixa.
          </s-paragraph>
          <CampoCopiavel label="Descoberta OAuth (Customer Accounts)" value={customerAccountDiscoveryUrl} />
          <s-paragraph>
            Documentação oficial:{" "}
            <s-link href="https://shopify.dev/docs/apps/build/storefront-mcp" target="_blank">
              shopify.dev/docs/apps/build/storefront-mcp
            </s-link>
          </s-paragraph>
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
