// Owner: Tijil. Copies every Clio resource for every matter into raw_records, unchanged.
// Re-running is cheap: a record whose etag has not changed is not rewritten, and `changed`
// tells the rest of the pipeline what needs re-processing.
import { createHash } from "node:crypto";
import { ClioError, clioList } from "./clio";
import { q } from "./db";

type Rec = { id: number; etag?: string; [k: string]: unknown };

type Resource = {
  name: string;
  path: string;
  fields: string;
  /** Extra query params for a given matter; omit for account-wide resources. */
  perMatter?: (matterId: number) => Record<string, string | number>;
  /** The record's own date, as opposed to when Clio stored it. */
  date: (r: Rec) => unknown;
  /** Text to hash so identical bodies can be deduped. */
  body?: (r: Rec) => unknown;
};

// Field lists follow Clio's v4 reference. If Clio rejects one (HTTP 400), the resource is retried
// with id and etag only and the error is reported, so one bad field cannot stop the whole sync.
const RESOURCES: Resource[] = [
  {
    name: "matters", path: "matters",
    fields: "id,etag,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name},practice_area{id,name},matter_stage{id,name},responsible_attorney{id,name},statute_of_limitations{id,name,due_at,status},custom_field_values{id,field_name,field_type,value}",
    date: (r) => r.open_date,
  },
  {
    name: "contacts", path: "contacts",
    fields: "id,etag,name,first_name,last_name,type,title,prefix,date_of_birth,primary_email_address,primary_phone_number,company{id,name},email_addresses{name,address,primary},phone_numbers{name,number},addresses{name,street,city,province,postal_code,country},updated_at",
    date: (r) => r.updated_at,
  },
  {
    name: "relationships", path: "relationships",
    fields: "id,etag,description,matter{id},contact{id,name,type}",
    perMatter: (id) => ({ matter_id: id }), date: () => null,
  },
  {
    name: "notes", path: "notes",
    fields: "id,etag,subject,detail,date,created_at,updated_at,matter{id},author{id,name}",
    perMatter: (id) => ({ type: "Matter", matter_id: id }), date: (r) => r.date,
  },
  {
    name: "communications", path: "communications",
    fields: "id,etag,subject,body,type,date,received_at,created_at,updated_at,matter{id},senders{id,name,type},receivers{id,name,type}",
    perMatter: (id) => ({ matter_id: id }), date: (r) => r.date ?? r.received_at, body: (r) => r.body,
  },
  {
    name: "tasks", path: "tasks",
    fields: "id,etag,name,description,status,priority,due_at,completed_at,created_at,updated_at,matter{id},assignee{id,name,type}",
    perMatter: (id) => ({ matter_id: id }), date: (r) => r.due_at,
  },
  {
    name: "calendar_entries", path: "calendar_entries",
    fields: "id,etag,summary,description,location,start_at,end_at,all_day,created_at,updated_at,matter{id}",
    perMatter: (id) => ({ matter_id: id }), date: (r) => r.start_at,
  },
  {
    name: "activities", path: "activities",
    fields: "id,etag,type,date,quantity,price,total,non_billable,non_billable_total,note,created_at,updated_at,matter{id},expense_category{id,name}",
    perMatter: (id) => ({ matter_id: id }), date: (r) => r.date,
  },
  {
    name: "documents", path: "documents",
    fields: "id,etag,name,filename,content_type,received_at,created_at,updated_at,parent{id,name},matter{id},latest_document_version{id,size,content_type,fully_uploaded}",
    perMatter: (id) => ({ matter_id: id }), date: (r) => r.received_at ?? r.created_at,
  },
  {
    name: "folders", path: "folders",
    fields: "id,etag,name,parent{id,name},matter{id}",
    perMatter: (id) => ({ matter_id: id }), date: () => null,
  },
];

export type SyncReport = Record<string, { total: number; changed: number; error?: string }>;

const hash = (s: string) => createHash("sha256").update(s.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

async function fetchAll(res: Resource, extra: Record<string, string | number>): Promise<{ rows: Rec[]; error?: string }> {
  try {
    return { rows: await clioList<Rec>(res.path, { fields: res.fields, ...extra }) };
  } catch (e) {
    if (!(e instanceof ClioError)) throw e;
    // A rejected field list: retry with the bare minimum. Anything else: report it and carry on with the other resources.
    const rows = e.status === 400 ? await clioList<Rec>(res.path, { fields: "id,etag", ...extra }).catch(() => []) : [];
    return { rows, error: `${e.status} ${e.body.slice(0, 300)}` };
  }
}

async function store(res: Resource, matterId: number | null, rows: Rec[]): Promise<number> {
  let changed = 0;
  for (const r of rows) {
    const body = res.body?.(r);
    const out = await q(
      `INSERT INTO raw_records (resource, clio_id, matter_id, etag, record_date, data, body_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (resource, clio_id) DO UPDATE
         SET matter_id = $3, etag = $4, record_date = $5, data = $6, body_hash = $7, synced_at = now()
         WHERE raw_records.etag IS DISTINCT FROM $4 OR raw_records.data IS DISTINCT FROM $6::jsonb
       RETURNING clio_id`,
      [res.name, r.id, matterId, r.etag ?? null, (res.date(r) as string) || null, JSON.stringify(r), typeof body === "string" ? hash(body) : null],
    );
    changed += out.length;
  }
  return changed;
}

export async function runSync(): Promise<SyncReport> {
  const report: SyncReport = {};
  const add = (name: string, total: number, changed: number, error?: string) => {
    const cur = (report[name] ??= { total: 0, changed: 0 });
    cur.total += total;
    cur.changed += changed;
    if (error) cur.error = error;
  };

  // Only matters Clio returned in this run are synced, never whatever else happens to be in the database.
  const matterIds: number[] = [];
  for (const res of RESOURCES.filter((r) => !r.perMatter)) {
    const { rows, error } = await fetchAll(res, {});
    add(res.name, rows.length, await store(res, null, rows), error);
    if (res.name === "matters") matterIds.push(...rows.map((r) => r.id));
  }

  for (const matterId of matterIds) {
    await q("UPDATE raw_records SET matter_id = clio_id WHERE resource = 'matters' AND clio_id = $1", [matterId]);
    for (const res of RESOURCES.filter((r) => r.perMatter)) {
      const { rows, error } = await fetchAll(res, res.perMatter!(matterId));
      add(res.name, rows.length, await store(res, matterId, rows), error);
    }
  }
  return report;
}
