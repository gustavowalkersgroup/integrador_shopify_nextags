import type { CanonicalPayload } from "~/lib/nextags/payload";

export async function dispatchN8n(
  payload: CanonicalPayload,
  timeoutMs = 2000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error("N8N_WEBHOOK_URL ausente");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": process.env.N8N_WEBHOOK_SECRET ?? "",
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
