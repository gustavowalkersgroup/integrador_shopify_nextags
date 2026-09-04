import { buildActions, type CanonicalPayload } from "./payload";

const BASE = () => process.env.NEXTAGS_API_BASE ?? "https://api.nextags.app.br";
const FLOWS_PATH = () => process.env.NEXTAGS_FLOWS_PATH ?? "/api/flows";
const CONTACTS_PATH = "/api/contacts";

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    "X-ACCESS-TOKEN": token,
  } as Record<string, string>;
}

export async function validateToken(token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${BASE()}${FLOWS_PATH()}`, { method: "GET", headers: headers(token) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "Chave inválida ou sem permissão (HTTP " + res.status + ")" };
    }
    if (!res.ok) return { ok: false, message: `NexTags respondeu HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Falha ao contatar a NexTags: ${(e as Error).message}` };
  }
}

export async function listFlows(token: string): Promise<{ flow_id: string; flow_name: string }[]> {
  const res = await fetch(`${BASE()}${FLOWS_PATH()}`, { method: "GET", headers: headers(token) });
  if (!res.ok) throw new Error(`listFlows HTTP ${res.status}`);
  // A forma da resposta varia; nao confiar nela. Um `data`/`flows` que nao
  // seja array cai no array vazio em vez de estourar no .map.
  const json: unknown = await res.json();
  let arr: unknown[] = [];
  if (Array.isArray(json)) {
    arr = json;
  } else if (typeof json === "object" && json !== null) {
    const o = json as Record<string, unknown>;
    const cand = o.data ?? o.flows;
    if (Array.isArray(cand)) arr = cand;
  }
  return arr.map((item) => {
    const f = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return {
      flow_id: String(f.flow_id ?? f.id),
      flow_name: String(f.flow_name ?? f.name ?? f.title ?? f.id),
    };
  });
}

export async function sendContact(
  payload: CanonicalPayload,
  timeoutMs = 2000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const actions = buildActions(payload.nextags.cuf, payload.nextags.tags, payload.nextags.flow_id);
  const body = JSON.stringify({
    phone: payload.customer.phone,
    first_name: payload.customer.first_name,
    last_name: payload.customer.last_name,
    actions,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}${CONTACTS_PATH}`, {
      method: "POST",
      headers: headers(payload.nextags.token),
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    // success:true nao prova entrega — quem audita e o event_log.
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: `erro de rede: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
