import { describe, it, expect } from "vitest";
import { assertCron } from "~/lib/cron-auth.server";

const req = (auth?: string) =>
  new Request("https://app.test/api/cron/x", {
    headers: auth ? { Authorization: auth } : {},
  });

describe("assertCron", () => {
  it("aceita o secret correto", () => {
    expect(() => assertCron(req(`Bearer ${process.env.CRON_SECRET}`))).not.toThrow();
  });

  it("rejeita secret errado ou ausente", () => {
    expect(() => assertCron(req("Bearer errado"))).toThrow();
    expect(() => assertCron(req())).toThrow();
  });
});
