import type { CanonicalPayload } from "~/lib/nextags/payload";
import { dispatchN8n } from "./n8n.server";
import { dispatchDirect } from "./direct.server";

export type DispatchMode = "n8n" | "direct";
export type DispatchResult = { ok: boolean; status: number; body: string };

export function dispatch(
  payload: CanonicalPayload,
  mode: DispatchMode,
  timeoutMs = 2000,
): Promise<DispatchResult> {
  if (mode === "n8n") return dispatchN8n(payload, timeoutMs);
  if (mode === "direct") return dispatchDirect(payload, timeoutMs);
  return Promise.reject(new Error(`modo de dispatch desconhecido: ${mode}`));
}
