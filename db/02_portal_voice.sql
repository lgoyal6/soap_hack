-- Owner: Laksh. Logins, provider sharing, voice agent tables.
-- Loaded after 01_core.sql (references nodes).

-- Logins. Firm users come from Clio; provider users from Clio contacts once the firm shares.
CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  role         text NOT NULL CHECK (role IN ('firm', 'provider')),
  email        text NOT NULL,
  name         text,
  clio_user_id bigint,
  provider_node_id bigint REFERENCES nodes(id),
  last_login   timestamptz,
  prev_login   timestamptz,               -- the login before this one: "what moved since you last looked"
  UNIQUE (role, email)
);
CREATE TABLE access_codes (
  user_id    bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Provider sharing.
CREATE TABLE consent (
  provider_node_id bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  category   text NOT NULL,             -- stage | requests | own_bills | coverage | other_treaters
  granted_by bigint REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (provider_node_id, category)
);
-- The provider portal reads ONLY this table (plus its own replies and lien rows).
CREATE TABLE shared_items (
  id           bigserial PRIMARY KEY,
  matter_id    bigint NOT NULL,
  provider_node_id bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  category     text NOT NULL,
  label        text NOT NULL DEFAULT '',
  patient      text,                    -- who the provider is treating, so the practice can tell its cases apart
  payload      jsonb NOT NULL,
  published_by bigint REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON shared_items (provider_node_id, matter_id, category, published_at DESC);
-- Read by the pipeline's getOpenItems (contract E in BUILD_PLAN.md).
CREATE TABLE provider_replies (
  id           bigserial PRIMARY KEY,
  shared_item_id bigint NOT NULL REFERENCES shared_items(id) ON DELETE CASCADE,
  request_id   text NOT NULL,          -- the open item id from getShareable().requests (e.g. "open-...")
  provider_node_id bigint NOT NULL,
  reply        text NOT NULL,           -- sending_by | waiting_on_patient | balance_holding | not_proceeding
  reply_date   date,
  note         text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE liens (
  id           bigserial PRIMARY KEY,
  matter_id    bigint NOT NULL,
  provider_node_id bigint NOT NULL,
  balance      numeric(12,2),
  status       text NOT NULL DEFAULT 'open',  -- open | balance_confirmed | reduction_requested | accepted | countered
  history      jsonb NOT NULL DEFAULT '[]',
  UNIQUE (matter_id, provider_node_id)
);
CREATE TABLE view_log (
  id        bigserial PRIMARY KEY,
  user_id   bigint REFERENCES users(id),
  matter_id bigint,
  path      text,
  at        timestamptz NOT NULL DEFAULT now()
);

-- Voice agent output that never leaves our database.
CREATE TABLE drafts (
  id        bigserial PRIMARY KEY,
  matter_id bigint NOT NULL,
  kind      text NOT NULL,              -- email | todo | provider_update
  recipient text,
  body      text NOT NULL,
  created_by bigint REFERENCES users(id),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
  id        bigserial PRIMARY KEY,
  matter_id bigint,
  reason    text,                       -- stage_change | settlement | access_code
  recipient text NOT NULL,
  subject   text NOT NULL,
  body      text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
-- Last stage each matter was seen at, so a stage change writes provider emails to the outbox once.
CREATE TABLE stage_seen (
  matter_id bigint PRIMARY KEY,
  stage     text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE voice_turns (
  id             bigserial PRIMARY KEY,
  user_id        bigint,
  matter_id      bigint,
  model          text,
  tool_calls     jsonb NOT NULL DEFAULT '[]',
  question       text,
  answer         text,
  dropped        jsonb NOT NULL DEFAULT '[]',  -- sentences removed by the number/quote check
  first_text_ms  int,                  -- request start to first checked sentence
  first_audio_ms int,                  -- request start to first audio, reported by the browser
  total_ms       int,
  tokens         int,
  input_tokens   int,
  output_tokens  int,
  at             timestamptz NOT NULL DEFAULT now()
);
