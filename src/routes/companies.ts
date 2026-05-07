import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../lib/db";

const CompanySchema = z
  .object({
    company_id: z.string().openapi({
      example: "NO-923609016",
      description:
        "Stable composite key in the form '{country}-{national_id}'.",
    }),
    country: z.enum(["NO", "FI", "DK"]).openapi({
      example: "NO",
      description: "ISO 3166-1 alpha-2 country code of the source registry.",
    }),
    national_id: z.string().openapi({
      example: "923609016",
      description:
        "Registry-native identifier: Brreg organisasjonsnummer (NO), PRH business ID (FI), or CVR-nummer (DK).",
    }),
    name: z.string().openapi({
      example: "Equinor ASA",
      description: "Registered legal name of the entity.",
    }),
    legal_form: z.string().nullable().openapi({
      example: "AS",
      description: "Normalized legal form code.",
    }),
    status: z
      .enum(["active", "dissolved", "bankrupt", "liquidating"])
      .openapi({
        example: "active",
        description: "Normalized lifecycle status.",
      }),
    registered_at: z.string().nullable().openapi({
      example: "1972-09-18",
      description:
        "ISO-8601 date the entity was first registered in its national registry.",
    }),
    industry_code: z.string().nullable().openapi({
      example: "06.100",
      description: "NACE Rev. 2 primary activity code.",
    }),
    address_country: z.string().nullable().openapi({
      example: "NO",
      description:
        "ISO 3166-1 alpha-2 country code of the registered business address.",
    }),
    postal_code: z.string().nullable().openapi({
      example: "4035",
      description: "Postal code of the registered business address.",
    }),
    source_updated_at: z.string().openapi({
      example: "2026-04-02T11:23:45Z",
      description:
        "ISO-8601 timestamp of the most recent change reported by the upstream registry.",
    }),
  })
  .openapi("Company");

const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "Resource not found." }),
    }),
  })
  .openapi("Error");

const ListResponseSchema = z
  .object({
    data: z.array(CompanySchema),
    pagination: z.object({
      next_cursor: z.string().nullable().openapi({
        example: "NO-923609016",
        description:
          "Cursor to fetch the next page; null when there are no more results.",
      }),
      limit: z.number().int().openapi({ example: 25 }),
    }),
  })
  .openapi("CompanyListResponse");

const ListQuerySchema = z.object({
  country: z
    .enum(["NO", "FI", "DK"])
    .optional()
    .openapi({ param: { name: "country", in: "query" }, example: "NO" }),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      param: { name: "name", in: "query" },
      example: "Equinor",
      description: "Case-insensitive substring match on the legal name.",
    }),
  status: z
    .enum(["active", "dissolved", "bankrupt", "liquidating"])
    .optional()
    .openapi({ param: { name: "status", in: "query" }, example: "active" }),
  industry_code: z
    .string()
    .min(1)
    .max(16)
    .optional()
    .openapi({
      param: { name: "industry_code", in: "query" },
      example: "06.100",
    }),
  postal_code: z
    .string()
    .min(1)
    .max(16)
    .optional()
    .openapi({ param: { name: "postal_code", in: "query" }, example: "4035" }),
  source_updated_since: z
    .string()
    .datetime()
    .optional()
    .openapi({
      param: { name: "source_updated_since", in: "query" },
      example: "2026-01-01T00:00:00Z",
      description:
        "Return only companies whose source_updated_at is greater than or equal to this ISO-8601 timestamp.",
    }),
  cursor: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      example: "NO-923609016",
      description:
        "Opaque cursor; pass back the value of pagination.next_cursor to fetch the next page.",
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .openapi({ param: { name: "limit", in: "query" }, example: 25 }),
});

const IdParamSchema = z.object({
  id: z
    .string()
    .regex(/^(NO|FI|DK)-[A-Za-z0-9-]+$/)
    .openapi({
      param: { name: "id", in: "path" },
      example: "NO-923609016",
      description:
        "Composite company_id in the form '{country}-{national_id}'.",
    }),
});

const RateLimitResponse = {
  description: "Too Many Requests",
  content: { "application/json": { schema: ErrorSchema } },
} as const;

const NotFoundResponse = {
  description: "Not Found",
  content: { "application/json": { schema: ErrorSchema } },
} as const;

type CompanyRow = {
  company_id: string;
  country: "NO" | "FI" | "DK";
  national_id: string;
  name: string;
  legal_form: string | null;
  status: "active" | "dissolved" | "bankrupt" | "liquidating";
  registered_at: string | null;
  industry_code: string | null;
  address_country: string | null;
  postal_code: string | null;
  source_updated_at: string;
};

const listRoute = createRoute({
  method: "get",
  path: "/v1/companies",
  tags: ["Companies"],
  summary:
    "List and filter companies across NO/FI/DK by country, name, status, industry_code, postal_code, or source_updated_at; supports cursor pagination.",
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: "A page of companies.",
      content: { "application/json": { schema: ListResponseSchema } },
    },
    429: RateLimitResponse,
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/v1/companies/{id}",
  tags: ["Companies"],
  summary:
    "Fetch a single normalized company record by composite company_id (e.g. 'NO-923609016').",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "The company record.",
      content: { "application/json": { schema: CompanySchema } },
    },
    404: NotFoundResponse,
    429: RateLimitResponse,
  },
});

export function registerCompaniesRoutes(
  app: OpenAPIHono<{ Bindings: Env }>,
): void {
  app.openapi(listRoute, async (c) => {
    const {
      country,
      name,
      status,
      industry_code,
      postal_code,
      source_updated_since,
      cursor,
      limit,
    } = c.req.valid("query");

    const where: string[] = [];
    const binds: Array<string | number> = [];

    if (country) {
      where.push("country = ?");
      binds.push(country);
    }
    if (name) {
      where.push("LOWER(name) LIKE ?");
      binds.push(`%${name.toLowerCase()}%`);
    }
    if (status) {
      where.push("status = ?");
      binds.push(status);
    }
    if (industry_code) {
      where.push("industry_code = ?");
      binds.push(industry_code);
    }
    if (postal_code) {
      where.push("postal_code = ?");
      binds.push(postal_code);
    }
    if (source_updated_since) {
      where.push("source_updated_at >= ?");
      binds.push(source_updated_since);
    }
    if (cursor) {
      where.push("company_id > ?");
      binds.push(cursor);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT company_id, country, national_id, name, legal_form, status,
             registered_at, industry_code, address_country, postal_code,
             source_updated_at
      FROM companies
      ${whereClause}
      ORDER BY company_id ASC
      LIMIT ?
    `;
    binds.push(limit + 1);

    const result = await c.env.DB.prepare(sql)
      .bind(...binds)
      .all<CompanyRow>();

    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0 ? page[page.length - 1].company_id : null;

    return c.json(
      {
        data: page,
        pagination: { next_cursor: nextCursor, limit },
      },
      200,
    );
  });

  app.openapi(detailRoute, async (c) => {
    const { id } = c.req.valid("param");

    const row = await c.env.DB.prepare(
      `SELECT company_id, country, national_id, name, legal_form, status,
              registered_at, industry_code, address_country, postal_code,
              source_updated_at
         FROM companies
        WHERE company_id = ?
        LIMIT 1`,
    )
      .bind(id)
      .first<CompanyRow>();

    if (!row) {
      return c.json(
        {
          error: {
            code: "not_found",
            message: `Company '${id}' not found.`,
          },
        },
        404,
      );
    }

    return c.json(row, 200);
  });
}