import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { handleWebhook } from "~/lib/webhook-handler.server";
import { handleCompliance } from "~/lib/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook valida o HMAC e rejeita payload adulterado com 401.
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const normalizado = topic.toLowerCase().replace(/_/g, "/");

  try {
    if (normalizado.startsWith("customers/") || normalizado === "shop/redact") {
      await handleCompliance({ shop, topic: normalizado, payload });
      return new Response(null, { status: 200 });
    }
    await handleWebhook({ shop, topic: normalizado, webhookId, payload });
  } catch (e) {
    // 200 mesmo em erro interno: a Shopify desativa webhooks apos falhas repetidas.
    // O erro fica em event_log / logs da Vercel e o cron de retry reprocessa.
    console.error("webhook falhou", { shop, topic: normalizado, erro: (e as Error).message });
  }

  return new Response(null, { status: 200 });
};
