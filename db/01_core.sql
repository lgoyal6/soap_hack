-- Owner: Tijil. Pipeline tables.
-- Applied on first `docker compose up`. Reset: docker compose down -v && docker compose up -d
CREATE EXTENSION IF NOT EXISTS vector;

-- Clio OAuth tokens for the connected firm account (one row).
CREATE TABLE clio_tokens (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz NOT NULL
);

-- Every synced Clio record, untouched.
CREATE TABLE raw_records (
  resource    text NOT NULL,            -- matters, notes, communications, ...
  clio_id     bigint NOT NULL,
  matter_id   bigint,
  etag        text,
  record_date timestamptz,              -- the record's own date (note date, email date, due date)
  data        jsonb NOT NULL,
  body_hash   text,                     -- for deduping identical emails
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource, clio_id)
);
CREATE INDEX ON raw_records (matter_id, resource);

-- One page of a scanned document.
CREATE TABLE scan_pages (
  document_id bigint NOT NULL,
  page_no     int NOT NULL,
  page_hash   text NOT NULL,
  extracted   jsonb,                    -- provider, date, type, diagnoses, charges
  text        text,
  status      text NOT NULL DEFAULT 'pending',  -- pending | done | failed
  PRIMARY KEY (document_id, page_no)
);

-- One extracted fact with where it came from.
CREATE TABLE facts (
  id          bigserial PRIMARY KEY,
  matter_id   bigint NOT NULL,
  type        text NOT NULL,            -- coverage_limit, injury, bill_total, count, commitment, ...
  subject     text,                     -- what the fact is about (normalised)
  value       jsonb NOT NULL,
  quote       text NOT NULL,            -- verbatim from the source
  resource    text NOT NULL,
  clio_id     bigint NOT NULL,
  page_no     int,
  fact_date   timestamptz,
  status      text NOT NULL DEFAULT 'unverified',  -- unverified | confirmed
  source_hash text NOT NULL             -- hash of the source text; re-extract only when it changes
);
CREATE INDEX ON facts (matter_id, type);


-- Case graph.
CREATE TABLE nodes (
  id        bigserial PRIMARY KEY,
  matter_id bigint NOT NULL,
  type      text NOT NULL,              -- person, provider, insurer, injury, request, document
  name      text NOT NULL,
  norm_name text NOT NULL,              -- lowercased, punctuation stripped; used for merging
  clio_contact_id bigint,
  props     jsonb NOT NULL DEFAULT '{}',
  UNIQUE (matter_id, type, norm_name)
);
CREATE TABLE edges (
  id        bigserial PRIMARY KEY,
  src       bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst       bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type      text NOT NULL,              -- treats, insures, employs, asked, mentions, ...
  resource  text,
  clio_id   bigint,
  quote     text
);

-- Cached output of each page section and the inputs it used.
CREATE TABLE sections (
  matter_id  bigint NOT NULL,
  name       text NOT NULL,             -- summary, conflicts, money, open_items, not_done, top_ten, changes
  data       jsonb NOT NULL,
  input_hash text NOT NULL,             -- rebuild only when this changes
  built_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, name)
);

-- Search over records and scan pages. Embedding is optional.
CREATE TABLE search_index (
  id        bigserial PRIMARY KEY,
  matter_id bigint NOT NULL,
  resource  text NOT NULL,
  clio_id   bigint NOT NULL,
  page_no   int NOT NULL DEFAULT 0,
  title     text,
  body      text NOT NULL,
  tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || body)) STORED,
  embedding vector(1536),
  UNIQUE (resource, clio_id, page_no)
);
CREATE INDEX ON search_index USING gin (tsv);

-- Top-ten ranking: feedback and current weights.
CREATE TABLE feedback (
  id        bigserial PRIMARY KEY,
  user_id   bigint,
  resource  text NOT NULL,
  clio_id   bigint NOT NULL,
  action    text NOT NULL,              -- pin | dismiss | open
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ranker_weights (
  feature text PRIMARY KEY,
  weight  double precision NOT NULL
);

-- When each firm user last opened each matter ("recent changes" default).
CREATE TABLE firm_visits (
  user_id   bigint NOT NULL,
  matter_id bigint NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, matter_id)
);

-- Cost and duration of every model call, for the submission form.
CREATE TABLE llm_calls (
  id            bigserial PRIMARY KEY,
  purpose       text NOT NULL,
  model         text NOT NULL,
  input_tokens  int,
  output_tokens int,
  ms            int,
  at            timestamptz NOT NULL DEFAULT now()
);
