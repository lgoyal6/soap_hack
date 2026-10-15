// Owner: Laksh. A throwaway Postgres database per test file: created on a server you point at, loaded with
// db/*.sql in order, dropped afterwards. Never point this at the real case database.
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5433/postgres node --experimental-strip-types --test tests/portal/publish-race.test.ts
// Without TEST_DATABASE_URL the tests that need it skip themselves (and say so).
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export type TestDb = { pool: pg.Pool; url: string; name: string; drop: () => Promise<void> };

const ROOT = join(import.meta.dirname, "..", "..");

export async function makeTestDb(opts: { files?: string[]; max?: number } = {}): Promise<TestDb | null> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return null;
  const name = `casebrief_t_${randomBytes(5).toString("hex")}`;
  const a = new pg.Client({ connectionString: admin });
  await a.connect();
  await a.query(`CREATE DATABASE ${name}`);
  await a.end();
  const u = new URL(admin);
  u.pathname = `/${name}`;
  const url = u.toString();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const files = opts.files ?? readdirSync(join(ROOT, "db")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) await c.query(readFileSync(join(ROOT, "db", f), "utf8"));
  await c.end();
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 20 });
  return {
    pool, url, name,
    drop: async () => {
      await pool.end();
      const d = new pg.Client({ connectionString: admin });
      await d.connect();
      await d.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await d.end();
    },
  };
}

/** Polls until `fn` is true or the time runs out. */
export async function until(fn: () => Promise<boolean>, ms = 5000, step = 20): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

/** A promise you resolve from outside: used to hold a publish between its consent check and its writes. */
export function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { wait: () => p, open };
}
