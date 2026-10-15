-- Owner: Laksh. Consent-checked, idempotent publishing to providers. Loaded after 02_portal_voice.sql.
-- Rollback (drops only what this file adds; shared_items rows stay readable by the old code):
--   DROP TABLE publish_jobs; DROP TABLE publish_heads;
--   ALTER TABLE shared_items DROP COLUMN source_revision, DROP COLUMN request_id;

-- Which snapshot a shared item is: sha256 of its canonical label + payload.
ALTER TABLE shared_items ADD COLUMN source_revision text;
-- Correlation id of the request that published it.
ALTER TABLE shared_items ADD COLUMN request_id text;

-- The latest published revision per provider, case and category. Publishing updates this row in the same
-- transaction as the insert; its row lock is what makes two concurrent publishes of one snapshot write one item.
CREATE TABLE publish_heads (
  matter_id        bigint NOT NULL,
  provider_node_id bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  category         text NOT NULL,
  source_revision  text NOT NULL,
  shared_item_id   bigint REFERENCES shared_items(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, provider_node_id, category)
);

-- One row per category per publish attempt that reached the database: what was decided and why.
-- outcome: published | unchanged. Refusals (no consent, stale preview, not on case) roll back and are not stored here;
-- they are returned to the caller and logged with the same request id.
CREATE TABLE publish_jobs (
  id               bigserial PRIMARY KEY,
  idempotency_key  text NOT NULL,           -- sha256(matter|provider|category|source_revision)
  request_id       text NOT NULL,
  matter_id        bigint NOT NULL,
  provider_node_id bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  category         text NOT NULL,
  source_revision  text NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('published', 'unchanged')),
  shared_item_id   bigint REFERENCES shared_items(id) ON DELETE SET NULL,
  published_by     bigint REFERENCES users(id),
  at               timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON publish_jobs (matter_id, provider_node_id, at DESC);
CREATE INDEX ON publish_jobs (request_id);
