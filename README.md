# Nordic Company Registry Aggregator (NO/FI/DK)

Unified REST API over the Norwegian Brreg, Finnish PRH, and Danish CVR open company registries. Returns a normalized company record keyed by a country-prefixed identifier so fintech onboarding, KYB, and credit-risk workflows can query all three Nordic jurisdictions through a single endpoint and schema.

## Quick start

```bash
curl -H "Authorization: Bearer YOUR_KEY" https://nordic-company-registry.trygve-api.workers.dev/v1/companies
```

## Endpoints

- `GET /healthz` — liveness check (no auth)
- `GET /openapi.json` — machine-readable spec
- `GET /docs` — interactive Swagger UI
- `GET /v1/companies` — list with pagination
- `GET /v1/companies/:id` — single record

Full schema: see `/openapi.json`.

## Pricing

| Tier    | Requests / month | Price |
|---------|------------------|-------|
| Free    | 100              | $0    |
| Starter | 10,000           | $9    |
| Pro     | 100,000          | $29   |

Get a key: https://nordic-company-registry.trygve-api.workers.dev/docs

## Source data

This API is a clean wrapper of the public source at https://www.brreg.no/en/use-of-data-from-the-bronnoysund-register-centre/datasets-and-api/data-on-nordic-businesses/.
We refresh the cache on a `0 3 * * *` schedule.

## License

The wrapped API itself is MIT. Underlying data: see https://www.brreg.no/en/use-of-data-from-the-bronnoysund-register-centre/datasets-and-api/data-on-nordic-businesses/.
