import type { CanonicalPayload } from "~/lib/nextags/payload";
import { dispatchN8n, type N8nOverride } from "./n8n.server";
import { dispatchDirect } from "./direct.server";

export type DispatchMode = "n8n" | "direct";
export type DispatchResult = { ok: boolean; status: number; body: string };

export function dispatch(
  payload: CanonicalPayload,
  mode: DispatchMode,
  n8nOverride: N8nOverride = {},
  timeoutMs = 2000,
): Promise<DispatchResult> {
  if (mode === "n8n") return dispatchN8n(payload, n8nOverride, timeoutMs);
  if (mode === "direct") return dispatchDirect(payload, timeoutMs);
  return Promise.reject(new Error(`modo de dispatch desconhecido: ${mode}`));
}
