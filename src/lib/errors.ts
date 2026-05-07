import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export class ApiError extends HTTPException {
  code: string;
  constructor(status: 400 | 401 | 403 | 404 | 429 | 500, code: string, message: string) {
    super(status, { message });
    this.code = code;
  }
}

export const notFound = (resource: string) =>
  new ApiError(404, "not_found", `${resource} not found`);
export const badRequest = (msg: string) => new ApiError(400, "bad_request", msg);
export const unauthorized = () => new ApiError(401, "unauthorized", "missing or invalid api key");
export const rateLimited = (retryAfter: number) =>
  new ApiError(429, "rate_limited", `rate limit exceeded; retry after ${retryAfter}s`);

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal", message: "internal error" } }, 500);
}
