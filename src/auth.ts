import type { MiddlewareHandler } from "hono";
import { getKey, incrementAndCheck } from "./lib/db";
import { rateLimited, unauthorized } from "./lib/errors";
import type { Env } from "./lib/db";

export const apiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const auth = c.req.header("authorization") ?? c.req.header("x-api-key") ?? "";
  const raw = auth.replace(/^Bearer\s+/i, "").trim();
  if (!raw) throw unauthorized();

  const row = await getKey(c.env.DB, raw);
  if (!row || row.revoked_at) throw unauthorized();

  const { ok, count } = await incrementAndCheck(c.env.DB, raw, row.monthly_quota);
  c.header("X-RateLimit-Limit", String(row.monthly_quota));
  c.header("X-RateLimit-Remaining", String(Math.max(0, row.monthly_quota - count)));
  if (!ok) throw rateLimited(60 * 60 * 24);

  c.set("apiKey", raw);
  c.set("tier", row.tier);
  await next();
};
