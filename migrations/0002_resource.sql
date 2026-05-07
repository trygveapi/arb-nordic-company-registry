CREATE TABLE IF NOT EXISTS companies (
    company_id TEXT,
    country TEXT,
    national_id TEXT,
    name TEXT,
    legal_form TEXT,
    status TEXT,
    registered_at TEXT,
    industry_code TEXT,
    address_country TEXT,
    postal_code TEXT,
    source_updated_at TEXT,
    PRIMARY KEY (company_id)
);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country);
CREATE INDEX IF NOT EXISTS idx_companies_national_id ON companies(national_id);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_industry_code ON companies(industry_code);
CREATE INDEX IF NOT EXISTS idx_companies_postal_code ON companies(postal_code);
CREATE INDEX IF NOT EXISTS idx_companies_source_updated_at ON companies(source_updated_at);
