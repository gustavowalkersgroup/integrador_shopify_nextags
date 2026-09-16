import type { CanonicalPayload } from "~/lib/nextags/payload";
import { dispatchN8n, type N8nOverride } from "./n8n.server";
import { dispatchDirect } from "./direct.server";

export type DispatchMode = "n8n" | "direct";
export type DispatchResult = { ok: boolean; status: number; body: string };

export const MODO_PADRAO: DispatchMode = "n8n";
const MODOS: readonly string[] = ["n8n", "direct"];

/**
 * Normaliza o valor de `StoreConfig.dispatchMode` lido do banco.
 *
 * Devolve `null` so para um modo que existe mas nao conhecemos ("banana"):
 * isso e configuracao errada de verdade e deve aparecer como falha.
 *
 * Ausencia de valor ("", null, undefined, so espaco) NAO e erro — significa
 * "nunca foi configurado" — e cai no padrao. Isso importa porque o valor vem
 * do banco, nao do codigo: em 2026-09-10 o app passou a gravar
 * `dispatchMode: process.env.DISPATCH_MODE_DEFAULT ?? "n8n"`, e com a env var
 * existindo vazia na Vercel o `??` nao aplicou o fallback (`??` so cobre
 * null/undefined, nunca ""). Toda loja instalada nasceu com `dispatchMode: ""`
 * e ficou permanentemente incapaz de disparar. Normalizar na LEITURA repara
 * essas linhas sem depender de migration de dados.
 */
export function normalizarModo(raw: string | null | undefined): DispatchMode | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return MODO_PADRAO;
  return (MODOS.includes(v) ? v : null) as DispatchMode | null;
}

export function dispatch(
  payload: CanonicalPayload,
  mode: DispatchMode | string | null | undefined,
  n8nOverride: N8nOverride = {},
  timeoutMs = 2000,
): Promise<DispatchResult> {
  const modo = normalizarModo(mode);
  if (modo === "n8n") return dispatchN8n(payload, n8nOverride, timeoutMs);
  if (modo === "direct") return dispatchDirect(payload, timeoutMs);

  // NUNCA rejeita. Os call sites chamam esta funcao depois de `logStart()` e,
  // nos webhooks, depois do dedup ja ter sido reivindicado. Uma rejeicao aqui
  // deixava a linha presa em "pending" — status que nenhum retry enxerga e que
  // o purge apaga em 30 dias — e subia ate a rota como 500. A Shopify reenviava
  // o webhook, a reentrega batia no dedup ja consumido e era descartada como
  // duplicata: o pedido se perdia em definitivo. Devolver ok:false faz o call
  // site gravar "failed"/"retrying", que e visivel na tela e recuperavel.
  //
  // `JSON.stringify` de proposito: com interpolacao crua, um modo vazio
  // produzia "modo de dispatch desconhecido: " e escondia o proprio sintoma.
  return Promise.resolve({
    ok: false,
    status: 0,
    body: `modo de dispatch desconhecido: ${JSON.stringify(mode)}`,
  });
}
