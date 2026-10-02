// Owner: Tijil. The ONLY module that talks to Clio.
// Case data is read with GET and nothing else: there is no function here that can create, update or
// delete anything in Clio. (The single POST is the OAuth token exchange, which touches no case data.)
import { q } from "./db";

const BASE = process.env.CLIO_BASE_URL ?? "https://app.clio.com";
const API = `${BASE}/api/v4`;

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CLIO_CLIENT_ID ?? "",
    redirect_uri: process.env.CLIO_REDIRECT_URI ?? "",
    state,
  });
  return `${BASE}/oauth/authorize?${p}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIO_CLIENT_ID ?? "",
      client_secret: process.env.CLIO_CLIENT_SECRET ?? "",
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Clio token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

async function saveToken(t: TokenResponse) {
  await q(
    `INSERT INTO clio_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, $1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (id) DO UPDATE SET access_token = $1, refresh_token = COALESCE($2, clio_tokens.refresh_token),
       expires_at = now() + make_interval(secs => $3)`,
    [t.access_token, t.refresh_token ?? null, t.expires_in],
  );
}

export async function exchangeCode(code: string) {
  await saveToken(
    await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: process.env.CLIO_REDIRECT_URI ?? "" }),
  );
}

async function accessToken(): Promise<string> {
  const [row] = await q<{ access_token: string; refresh_token: string | null; fresh: boolean }>(
    "SELECT access_token, refresh_token, expires_at > now() + interval '2 minutes' AS fresh FROM clio_tokens WHERE id = 1",
  );
  if (!row) throw new Error("Clio is not connected. Sign in at /api/clio/login.");
  if (row.fresh || !row.refresh_token) return row.access_token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  await saveToken(t);
  return t.access_token;
}

export class ClioError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`Clio GET ${url} failed: ${status} ${body.slice(0, 300)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET one URL, waiting out the rate limit (HTTP 429 with Retry-After) up to five times. */
async function getUrl(url: string): Promise<Response> {
  const token = await accessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt < 5) {
      await sleep((Number(res.headers.get("Retry-After")) || 15) * 1000);
      continue;
    }
    if (!res.ok) throw new ClioError(res.status, await res.text(), url);
    return res;
  }
}

type Params = Record<string, string | number | undefined>;

function buildUrl(path: string, params: Params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  return `${API}/${path}.json?${p}`;
}

/** GET a single resource. Clio returns only id and etag unless `fields` is passed. */
export async function clioGet<T>(path: string, params: Params = {}): Promise<T> {
  return ((await (await getUrl(buildUrl(path, params))).json()) as { data: T }).data;
}

/** GET every page of a list. */
export async function clioList<T>(path: string, params: Params = {}): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = buildUrl(path, { limit: 200, ...params });
  while (url) {
    const page = (await (await getUrl(url)).json()) as { data: T[]; meta?: { paging?: { next?: string } } };
    out.push(...page.data);
    url = page.meta?.paging?.next;
  }
  return out;
}

/** Download a document's bytes. Clio answers with a redirect to the file, which fetch follows. */
export async function clioDownload(documentId: number): Promise<Buffer> {
  return Buffer.from(await (await getUrl(`${API}/documents/${documentId}/download.json`)).arrayBuffer());
}
