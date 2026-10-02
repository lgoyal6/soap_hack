// Owner: Tijil. Turns raw Clio records into one uniform shape the rest of the pipeline reads.
import { q } from "../db";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = { resource: string; clioId: number; date: string | null; title: string; text: string; data: any };

const strip = (s: unknown) => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim() : "");
const names = (list: any) => (Array.isArray(list) ? list.map((p) => p?.name).filter(Boolean).join(", ") : "");

function shape(resource: string, d: any): { title: string; text: string } {
  switch (resource) {
    case "notes": return { title: strip(d.subject), text: strip(d.detail) };
    case "communications": return { title: strip(d.subject), text: `From: ${names(d.senders)}\nTo: ${names(d.receivers)}\n${strip(d.body)}` };
    case "tasks": return { title: strip(d.name), text: `Status: ${d.status ?? ""}\n${strip(d.description)}` };
    case "calendar_entries": return { title: strip(d.summary), text: strip(d.description) };
    case "activities": return { title: strip(d.note).split(/[.:\n]/)[0], text: strip(d.note) };
    case "documents": return { title: strip(d.name), text: d.parent?.name ? `Folder: ${d.parent.name}` : "" };
    case "matters": return { title: strip(d.description) || strip(d.display_number), text: "" };
    default: return { title: strip(d.name), text: "" };
  }
}

export async function loadRecords(matterId: number, resources?: string[]): Promise<Rec[]> {
  const rows = await q<{ resource: string; clio_id: string; record_date: Date | null; data: any }>(
    `SELECT resource, clio_id, record_date, data FROM raw_records
     WHERE matter_id = $1 AND ($2::text[] IS NULL OR resource = ANY($2)) ORDER BY record_date NULLS LAST, clio_id`,
    [matterId, resources ?? null],
  );
  return rows.map((r) => ({
    resource: r.resource, clioId: Number(r.clio_id),
    date: r.record_date ? r.record_date.toISOString() : null,
    data: r.data, ...shape(r.resource, r.data),
  }));
}

export async function loadMatter(matterId: number): Promise<any | null> {
  const [row] = await q<{ data: any }>("SELECT data FROM raw_records WHERE resource = 'matters' AND clio_id = $1", [matterId]);
  return row?.data ?? null;
}

/** Custom fields as records, so facts drawn from them can be cited like anything else. */
export function customFieldRecords(matter: any): Rec[] {
  return (matter?.custom_field_values ?? [])
    .filter((f: any) => f?.value !== null && f?.value !== undefined && f?.value !== "")
    .map((f: any) => ({
      resource: "custom_fields", clioId: Number(String(f.id).replace(/\D/g, "").slice(-12)) || 0, date: null,
      title: String(f.field_name ?? "Custom field"), text: String(f.value), data: f,
    }));
}

/** Contacts linked to a matter, with how they relate to it. */
export async function loadContacts(matterId: number): Promise<{ id: number; name: string; email: string | null; relationship: string | null; isClient: boolean; data: any }[]> {
  const matter = await loadMatter(matterId);
  const clientId = matter?.client?.id as number | undefined;
  const rels = await q<{ data: any }>("SELECT data FROM raw_records WHERE resource = 'relationships' AND matter_id = $1", [matterId]);
  const relBy = new Map<number, string>(rels.map((r) => [Number(r.data.contact?.id), String(r.data.description ?? "")]));
  const ids = [...new Set([...(clientId ? [clientId] : []), ...relBy.keys()])];
  if (!ids.length) return [];
  const contacts = await q<{ clio_id: string; data: any }>("SELECT clio_id, data FROM raw_records WHERE resource = 'contacts' AND clio_id = ANY($1)", [ids]);
  return contacts.map((c) => {
    const id = Number(c.clio_id);
    const email = c.data.primary_email_address ?? c.data.email_addresses?.[0]?.address ?? null;
    return { id, name: String(c.data.name ?? ""), email, relationship: relBy.get(id) ?? null, isClient: id === clientId, data: c.data };
  });
}
