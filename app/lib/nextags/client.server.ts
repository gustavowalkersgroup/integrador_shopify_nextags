import { buildActions, type CanonicalPayload } from "./payload";

// `||`, nao `??`: uma env var cadastrada vazia na Vercel (comum quando se
// copia .env.example sem preencher) passa de "" pro fallback do mesmo jeito
// que uma env var ausente — sem isso, fetch("" + "/api/accounts/flows") vira
// uma URL relativa sem base e explode com "Failed to parse URL from".
const BASE = () => process.env.NEXTAGS_API_BASE || "https://app.nextagsai.com.br";
const FLOWS_PATH = () => process.env.NEXTAGS_FLOWS_PATH || "/api/accounts/flows";
const CONTACTS_PATH = "/api/contacts";

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    "X-ACCESS-TOKEN": token,
  } as Record<string, string>;
}

// `fetch` do Node (undici) joga um TypeError com message fixa "fetch failed"
// pra qualquer erro de rede — DNS, TLS, conexao recusada, timeout — e guarda
// o motivo de verdade em `.cause`. Sem isso a UI/log so mostra "fetch
// failed" e fica impossivel saber se e DNS, certificado ou porta fechada.
function describeNetworkError(e: unknown): string {
  const err = e as Error & { cause?: unknown };
  const cause = err.cause as (Error & { code?: string }) | undefined;
  if (cause) {
    const code = cause.code ? ` [${cause.code}]` : "";
    return `${err.message}${code}: ${cause.message}`;
  }
  return err.message;
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
    return { ok: false, message: `Falha ao contatar a NexTags: ${describeNetworkError(e)}` };
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
    return { ok: false, status: 0, body: `erro de rede: ${describeNetworkError(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
