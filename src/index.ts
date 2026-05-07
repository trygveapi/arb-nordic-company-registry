import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { apiKey } from "./auth";
import { errorHandler, type ApiError } from "./lib/errors";
import { ensureSchema, type Env } from "./lib/db";
// Routes are appended below this line by the Builder agent. Do not edit manually.
import { registerCompaniesRoutes } from "./routes/companies";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.onError((err, c) => errorHandler(err as Error & ApiError, c));

app.get("/healthz", async (c) => {
  await ensureSchema(c.env.DB);
  return c.json({ ok: true, slug: c.env.PRODUCT_SLUG, time: new Date().toISOString() });
});

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "API key issued by the API operator. On RapidAPI, this is injected by the gateway as a Secret Header — developers authenticate with X-RapidAPI-Key only.",
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Nordic Company Registry Aggregator (NO/FI/DK)", version: "0.1.0", description: "Unified REST API over the Norwegian Brreg, Finnish PRH, and Danish CVR open company registries. Returns a normalized company record keyed by a country-prefixed identifier so fintech onboarding, KYB, and credit-risk workflows can query all three Nordic jurisdictions through a single endpoint and schema." },
  servers: [{ url: "https://nordic-company-registry.trygve-api.workers.dev" }],
  security: [{ bearerAuth: [] }],
});
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

// Public routes require an API key
app.use("/v1/*", apiKey);

// Manual scrape trigger — same auth as the rest of /v1/*. Useful before the
// first cron fires, or for force-refreshing after upstream schema changes.
app.post("/v1/_admin/run-scrape", async (c) => {
  const { runScraper } = await import("./scraper");
  const summary = await runScraper(c.env);
  return c.json(summary);
});

registerCompaniesRoutes(app);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Builder writes the scraper entry here.
    const { runScraper } = await import("./scraper");
    ctx.waitUntil(runScraper(env));
  },
} satisfies ExportedHandler<Env>;
