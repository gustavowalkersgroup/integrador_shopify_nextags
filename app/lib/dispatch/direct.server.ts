import { sendContact } from "~/lib/nextags/client.server";
import type { CanonicalPayload } from "~/lib/nextags/payload";

export function dispatchDirect(payload: CanonicalPayload, timeoutMs = 2000) {
  return sendContact(payload, timeoutMs);
}
