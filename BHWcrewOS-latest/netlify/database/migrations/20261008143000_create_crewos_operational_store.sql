CREATE TABLE IF NOT EXISTS crewos_operational_records (
  namespace TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, record_id)
);

CREATE INDEX IF NOT EXISTS crewos_operational_records_namespace_idx
  ON crewos_operational_records (namespace, updated_at DESC);

CREATE TABLE IF NOT EXISTS crewos_operational_sources (
  namespace TEXT PRIMARY KEY,
  source_database_id TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  imported_count INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  schema_properties JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL,
  imported_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crewos_cutover_state (
  state_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('notion', 'cutover', 'database')),
  cutover_started_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO crewos_cutover_state (state_key, mode)
VALUES ('notion-exit', 'notion')
ON CONFLICT (state_key) DO NOTHING;
