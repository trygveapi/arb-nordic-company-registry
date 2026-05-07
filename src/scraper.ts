/**
 * Nordic Company Registry Aggregator scraper.
 *
 * Pulls from three free open registries and normalizes into the `companies` table:
 *   - NO: Brreg Enhetsregisteret  (https://data.brreg.no/enhetsregisteret/api/enheter)
 *   - FI: PRH avoindata YTJ v3    (https://avoindata.prh.fi/opendata-ytj-api/v3/companies)
 *   - DK: Virk CVR distribution   (http://distribution.virk.dk/cvr-permanent/virksomhed/_search)
 *           — requires HTTP basic auth credentials in env.CVR_USER / env.CVR_PASS.
 *             If absent, the DK leg is skipped (not fatal) so the cron still runs.
 *
 * One D1 batch per page. 50-page total budget shared across the three sources.
 */

export interface Env {
  DB: D1Database;
  CVR_USER?: string;
  CVR_PASS?: string;
}

interface NormalizedCompany {
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
  source_updated_at: string | null;
}

interface PageResult {
  rows: NormalizedCompany[];
  hasMore: boolean;
  cursor?: string;
}

const UPSERT_SQL = `
INSERT INTO companies (
  company_id, country, national_id, name, legal_form, status,
  registered_at, industry_code, address_country, postal_code, source_updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(company_id) DO UPDATE SET
  country = excluded.country,
  national_id = excluded.national_id,
  name = excluded.name,
  legal_form = excluded.legal_form,
  status = excluded.status,
  registered_at = excluded.registered_at,
  industry_code = excluded.industry_code,
  address_country = excluded.address_country,
  postal_code = excluded.postal_code,
  source_updated_at = excluded.source_updated_at
`;

const TOTAL_PAGE_BUDGET = 50;
const PER_SOURCE_BUDGET = Math.floor(TOTAL_PAGE_BUDGET / 3); // 16 each, last absorbs remainder

// ---------- Brreg (NO) ----------------------------------------------------

interface BrregEnhet {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { kode?: string };
  registreringsdatoEnhetsregisteret?: string;
  naeringskode1?: { kode?: string };
  forretningsadresse?: { postnummer?: string; landkode?: string };
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  slettedato?: string;
  sisteInnsendteAarsregnskap?: string;
}

interface BrregPage {
  _embedded?: { enheter?: BrregEnhet[] };
  page?: { totalPages?: number; number?: number };
}

function normalizeBrregStatus(e: BrregEnhet): NormalizedCompany["status"] {
  if (e.slettedato) return "dissolved";
  if (e.konkurs === true) return "bankrupt";
  if (e.underAvvikling === true || e.underTvangsavviklingEllerTvangsopplosning === true) {
    return "liquidating";
  }
  return "active";
}

async function fetchBrregPage(page: number): Promise<PageResult> {
  const url = `https://data.brreg.no/enhetsregisteret/api/enheter?page=${page}&size=200`;
  const res = await fetch(url, {
    headers: { accept: "application/vnd.brreg.enhetsregisteret.enhet.v2+json" },
  });
  if (!res.ok) throw new Error(`brreg ${res.status}`);
  const body = (await res.json()) as BrregPage;
  const enheter = body._embedded?.enheter ?? [];
  const totalPages = body.page?.totalPages ?? 0;
  const current = body.page?.number ?? page;

  const rows: NormalizedCompany[] = [];
  for (const e of enheter) {
    const orgnr = e.organisasjonsnummer;
    const name = e.navn;
    if (!orgnr || !name) continue;
    rows.push({
      company_id: `NO-${orgnr}`,
      country: "NO",
      national_id: orgnr,
      name,
      legal_form: e.organisasjonsform?.kode ?? null,
      status: normalizeBrregStatus(e),
      registered_at: e.registreringsdatoEnhetsregisteret ?? null,
      industry_code: e.naeringskode1?.kode ?? null,
      address_country: e.forretningsadresse?.landkode ?? null,
      postal_code: e.forretningsadresse?.postnummer ?? null,
      source_updated_at: null, // Brreg does not expose a per-record updated timestamp on this endpoint
    });
  }

  return { rows, hasMore: current + 1 < totalPages };
}

// ---------- PRH (FI) ------------------------------------------------------

interface PrhName {
  name?: string;
  type?: string;
  registrationDate?: string;
  endDate?: string | null;
}

interface PrhCompanyForm {
  type?: string;
  registrationDate?: string;
  endDate?: string | null;
}

interface PrhAddress {
  type?: number;
  street?: string;
  postCode?: string;
  country?: string;
  registrationDate?: string;
  endDate?: string | null;
}

interface PrhMainBusinessLine {
  type?: string;
  registrationDate?: string;
}

interface PrhStatus {
  status?: string;
  registrationDate?: string;
}

interface PrhCompany {
  businessId?: { value?: string; registrationDate?: string };
  names?: PrhName[];
  companyForms?: PrhCompanyForm[];
  mainBusinessLine?: PrhMainBusinessLine;
  addresses?: PrhAddress[];
  status?: string | PrhStatus;
  endOfOperationDate?: string | null;
  registrationDate?: string;
  lastModified?: string;
}

interface PrhPage {
  companiesList?: PrhCompany[];
  totalResults?: number;
  pageSize?: number;
  previousPage?: string | null;
  nextPage?: string | null;
}

function pickCurrent<T extends { endDate?: string | null }>(items: T[] | undefined): T | undefined {
  if (!items || items.length === 0) return undefined;
  return items.find((i) => !i.endDate) ?? items[0];
}

function normalizePrhStatus(c: PrhCompany): NormalizedCompany["status"] {
  if (c.endOfOperationDate) return "dissolved";
  const raw = typeof c.status === "string" ? c.status : c.status?.status;
  if (!raw) return "active";
  const s = raw.toUpperCase();
  if (s.includes("KONKURS") || s.includes("BANKRUPT")) return "bankrupt";
  if (s.includes("LIQUID") || s.includes("SELVITY") || s.includes("AVVIK")) return "liquidating";
  if (s === "2" || s.includes("LOPETT") || s.includes("PASSIIV") || s.includes("DISSOL")) {
    return "dissolved";
  }
  return "active";
}

async function fetchPrhPage(page: number): Promise<PageResult> {
  // PRH v3 uses 1-based page numbers and returns up to 100 per page.
  const url = `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?page=${page}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`prh ${res.status}`);
  const body = (await res.json()) as PrhPage;
  const list = body.companiesList ?? [];

  const rows: NormalizedCompany[] = [];
  for (const c of list) {
    const bid = c.businessId?.value;
    const currentName = pickCurrent(c.names)?.name;
    if (!bid || !currentName) continue;
    const form = pickCurrent(c.companyForms);
    const visiting = pickCurrent(c.addresses?.filter((a) => a.type === 1));
    const postal = pickCurrent(c.addresses?.filter((a) => a.type === 2));
    const addr = visiting ?? postal ?? pickCurrent(c.addresses);
    rows.push({
      company_id: `FI-${bid}`,
      country: "FI",
      national_id: bid,
      name: currentName,
      legal_form: form?.type ?? null,
      status: normalizePrhStatus(c),
      registered_at: c.registrationDate ?? c.businessId?.registrationDate ?? null,
      industry_code: c.mainBusinessLine?.type ?? null,
      address_country: addr?.country ?? null,
      postal_code: addr?.postCode ?? null,
      source_updated_at: c.lastModified ?? null,
    });
  }

  // PRH signals more pages via nextPage URL
  return { rows, hasMore: Boolean(body.nextPage) };
}

// ---------- CVR (DK) ------------------------------------------------------

interface CvrSearchHit<T> {
  _id?: string;
  _source?: T;
}

interface CvrSearchResponse<T> {
  hits?: { hits?: CvrSearchHit<T>[]; total?: { value?: number } | number };
  _scroll_id?: string;
}

interface CvrAddress {
  landekode?: string;
  postnummer?: number;
  gyldigFra?: string;
  gyldigTil?: string | null;
}

interface CvrName {
  navn?: string;
  gyldigFra?: string;
  gyldigTil?: string | null;
}

interface CvrFormPeriod {
  virksomhedsform?: { kortBeskrivelse?: string; langBeskrivelse?: string };
  periode?: { gyldigFra?: string; gyldigTil?: string | null };
}

interface CvrStatusPeriod {
  status?: string;
  periode?: { gyldigFra?: string; gyldigTil?: string | null };
}

interface CvrIndustry {
  branchekode?: string;
  periode?: { gyldigFra?: string; gyldigTil?: string | null };
}

interface CvrVirksomhed {
  cvrNummer?: number;
  navne?: CvrName[];
  virksomhedsform?: CvrFormPeriod[];
  virksomhedMetadata?: {
    nyesteNavn?: { navn?: string };
    nyesteVirksomhedsform?: { kortBeskrivelse?: string };
    nyesteHovedbranche?: { branchekode?: string };
    nyesteBeliggenhedsadresse?: { landekode?: string; postnummer?: number };
    stiftelsesDato?: string;
    nyesteStatus?: string;
  };
  hovedbranche?: CvrIndustry[];
  beliggenhedsadresse?: CvrAddress[];
  virksomhedsstatus?: CvrStatusPeriod[];
  livsforloeb?: Array<{ periode?: { gyldigFra?: string; gyldigTil?: string | null } }>;
  sidstOpdateret?: string;
}

interface CvrEnvelope {
  Vrvirksomhed?: CvrVirksomhed;
}

function normalizeCvrStatus(s?: string): NormalizedCompany["status"] {
  if (!s) return "active";
  const u = s.toUpperCase();
  if (u.includes("KONKURS") || u.includes("BANKRUPT")) return "bankrupt";
  if (u.includes("LIKVID") || u.includes("LIQUID") || u.includes("TVANGSOPL")) return "liquidating";
  if (u.includes("OPLØST") || u.includes("OPLOEST") || u.includes("OPHØRT") || u.includes("OPHORT")) {
    return "dissolved";
  }
  return "active";
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

async function fetchCvrPage(
  page: number,
  size: number,
  auth: string,
): Promise<PageResult> {
  const url = "http://distribution.virk.dk/cvr-permanent/virksomhed/_search";
  const body = {
    from: page * size,
    size,
    sort: [{ "Vrvirksomhed.cvrNummer": { order: "asc" } }],
    query: { match_all: {} },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: auth,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`cvr ${res.status}`);
  const json = (await res.json()) as CvrSearchResponse<CvrEnvelope>;
  const hits = json.hits?.hits ?? [];

  const rows: NormalizedCompany[] = [];
  for (const h of hits) {
    const v = h._source?.Vrvirksomhed;
    if (!v) continue;
    const cvr = v.cvrNummer;
    const meta = v.virksomhedMetadata;
    const name = meta?.nyesteNavn?.navn ?? v.navne?.find((n) => !n.gyldigTil)?.navn;
    if (!cvr || !name) continue;
    const addr =
      v.beliggenhedsadresse?.find((a) => !a.gyldigTil) ?? v.beliggenhedsadresse?.[0];
    const branch =
      v.hovedbranche?.find((b) => !b.periode?.gyldigTil)?.branchekode ??
      meta?.nyesteHovedbranche?.branchekode ??
      null;
    const formCode =
      v.virksomhedsform?.find((f) => !f.periode?.gyldigTil)?.virksomhedsform?.kortBeskrivelse ??
      meta?.nyesteVirksomhedsform?.kortBeskrivelse ??
      null;
    const statusRaw =
      meta?.nyesteStatus ??
      v.virksomhedsstatus?.find((s) => !s.periode?.gyldigTil)?.status;
    const registeredAt =
      meta?.stiftelsesDato ??
      v.livsforloeb?.[0]?.periode?.gyldigFra ??
      null;
    const postal =
      addr?.postnummer != null ? String(addr.postnummer).padStart(4, "0") : null;
    rows.push({
      company_id: `DK-${cvr}`,
      country: "DK",
      national_id: String(cvr),
      name,
      legal_form: formCode,
      status: normalizeCvrStatus(statusRaw),
      registered_at: registeredAt,
      industry_code: branch,
      address_country: addr?.landekode ?? meta?.nyesteBeliggenhedsadresse?.landekode ?? null,
      postal_code: postal,
      source_updated_at: v.sidstOpdateret ?? null,
    });
  }

  return { rows, hasMore: hits.length === size };
}

// ---------- Batch upsert --------------------------------------------------

async function upsertBatch(
  env: Env,
  rows: NormalizedCompany[],
): Promise<{ upserted: number; changed: number }> {
  if (rows.length === 0) return { upserted: 0, changed: 0 };
  const stmt = env.DB.prepare(UPSERT_SQL);
  const stmts = rows.map((r) =>
    stmt.bind(
      r.company_id,
      r.country,
      r.national_id,
      r.name,
      r.legal_form,
      r.status,
      r.registered_at,
      r.industry_code,
      r.address_country,
      r.postal_code,
      r.source_updated_at,
    ),
  );

  try {
    const results = await env.DB.batch(stmts);
    let changed = 0;
    let upserted = 0;
    for (const r of results) {
      const meta = r.meta as { changes?: number; rows_written?: number } | undefined;
      if (meta?.changes != null) changed += meta.changes;
      if (meta?.rows_written != null) upserted += meta.rows_written;
    }
    if (upserted === 0) upserted = rows.length;
    return { upserted, changed };
  } catch (err) {
    console.error("batch upsert failed", err);
    return { upserted: 0, changed: 0 };
  }
}

// ---------- Per-source drivers --------------------------------------------

interface SourceStats {
  fetched: number;
  upserted: number;
  changed: number;
  pages: number;
  errors: number;
}

async function runSource(
  env: Env,
  label: string,
  pageBudget: number,
  fetchPage: (page: number) => Promise<PageResult>,
): Promise<SourceStats> {
  const stats: SourceStats = { fetched: 0, upserted: 0, changed: 0, pages: 0, errors: 0 };
  let page = 0;
  while (page < pageBudget) {
    let result: PageResult;
    try {
      // PRH is 1-based; the others are 0-based. Drivers handle that themselves.
      result = await fetchPage(page);
    } catch (err) {
      stats.errors++;
      console.error(`${label} page ${page} fetch failed`, err);
      break;
    }
    stats.pages++;
    stats.fetched += result.rows.length;
    const { upserted, changed } = await upsertBatch(env, result.rows);
    stats.upserted += upserted;
    stats.changed += changed;
    if (!result.hasMore || result.rows.length === 0) break;
    page++;
  }
  return stats;
}

// ---------- Entry point ---------------------------------------------------

export async function runScraper(env: Env): Promise<void> {
  const started = Date.now();

  const noStats = await runSource(env, "NO/brreg", PER_SOURCE_BUDGET, (p) => fetchBrregPage(p));
  const fiStats = await runSource(env, "FI/prh", PER_SOURCE_BUDGET, (p) => fetchPrhPage(p + 1));

  let dkStats: SourceStats = { fetched: 0, upserted: 0, changed: 0, pages: 0, errors: 0 };
  if (env.CVR_USER && env.CVR_PASS) {
    const auth = basicAuthHeader(env.CVR_USER, env.CVR_PASS);
    const dkBudget = TOTAL_PAGE_BUDGET - noStats.pages - fiStats.pages;
    if (dkBudget > 0) {
      dkStats = await runSource(env, "DK/cvr", dkBudget, (p) => fetchCvrPage(p, 100, auth));
    }
  } else {
    console.warn("DK/cvr skipped: CVR_USER / CVR_PASS not configured");
  }

  const totalFetched = noStats.fetched + fiStats.fetched + dkStats.fetched;
  const totalUpserted = noStats.upserted + fiStats.upserted + dkStats.upserted;
  const totalChanged = noStats.changed + fiStats.changed + dkStats.changed;

  console.log(
    JSON.stringify({
      scraper: "nordic-company-registry",
      duration_ms: Date.now() - started,
      fetched: totalFetched,
      upserted: totalUpserted,
      changed: totalChanged,
      sources: { NO: noStats, FI: fiStats, DK: dkStats },
    }),
  );
}