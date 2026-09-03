import { describe, it, expect } from "vitest";

describe("trilhos", () => {
  it("roda vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("carrega o setup de ambiente", () => {
    expect(Buffer.from(process.env.ENCRYPTION_KEY!, "base64")).toHaveLength(32);
    expect(process.env.N8N_WEBHOOK_URL).toBeTruthy();
  });
});
