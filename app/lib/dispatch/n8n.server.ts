import type { CanonicalPayload } from "~/lib/nextags/payload";

export type N8nOverride = { url?: string | null; secret?: string | null };

export async function dispatchN8n(
  payload: CanonicalPayload,
  override: N8nOverride = {},
  timeoutMs = 2000,
): Promise<{ ok: boolean; status: number; body: string }> {
  // Override por loja tem prioridade; env var global fica como fallback pra
  // quem ainda nao configurou o proprio n8n na tela do app.
  const url = override.url || process.env.N8N_WEBHOOK_URL;
  if (!url) return { ok: false, status: 0, body: "N8N_WEBHOOK_URL não configurada" };
  const secret = override.secret || process.env.N8N_WEBHOOK_SECRET || "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: `erro de rede: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
