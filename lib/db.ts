// Owner: Tijil. Frozen.
import { Pool } from "pg";

// One pool per process; survives Next.js dev reloads.
const g = globalThis as unknown as { __pool?: Pool };
export const pool = (g.__pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}
