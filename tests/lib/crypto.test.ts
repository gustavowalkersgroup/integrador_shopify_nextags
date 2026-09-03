import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "~/lib/crypto.server";

describe("crypto", () => {
  it("round-trip preserva o valor", () => {
    const secret = "token-abc-123";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("cifra o mesmo valor de formas diferentes (IV aleatório)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });

  it("rejeita payload adulterado", () => {
    const enc = encrypt("token");
    const [iv, tag, ct] = enc.split(".");
    const tampered = [iv, tag, Buffer.from("outro").toString("base64")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejeita chave de tamanho errado", () => {
    const old = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = old;
  });
});
