import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO api_keys (key, tier, monthly_quota) VALUES (?, 'free', 5)",
  )
    .bind("test-key")
    .run();
});

describe("template basics", () => {
  it("healthz returns ok", async () => {
    const r = await SELF.fetch("https://x/healthz");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("openapi.json is served", async () => {
    const r = await SELF.fetch("https://x/openapi.json");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { openapi: string };
    expect(body.openapi).toMatch(/^3\./);
  });

  it("v1 routes require an api key", async () => {
    const r = await SELF.fetch("https://x/v1/anything");
    expect([401, 404]).toContain(r.status);
  });
});
