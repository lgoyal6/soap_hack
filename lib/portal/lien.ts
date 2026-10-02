// Owner: Laksh. A provider's lien on one case: provider confirms the balance, firm asks for a reduction,
// provider accepts or counters, firm can accept the counter. Every step is kept in `history`.
import { q } from "../db";
import type { Lien, LienAction, LienEvent, LienStatus } from "./types";

export class LienError extends Error {}

type Row = { balance: string | null; status: LienStatus; history: LienEvent[] };

export async function readLien(matterId: number, nodeId: number): Promise<Lien | null> {
  const [r] = await q<Row>("SELECT balance, status, history FROM liens WHERE matter_id = $1 AND provider_node_id = $2", [matterId, nodeId]);
  return r ? { balance: r.balance === null ? null : Number(r.balance), status: r.status, history: r.history } : null;
}

/** Which side may take which step from which status. */
const RULES: Record<LienAction, { by: "firm" | "provider"; from: (LienStatus | "none")[]; to: LienStatus }> = {
  confirm: { by: "provider", from: ["none", "open", "balance_confirmed", "accepted", "countered", "reduction_requested"], to: "balance_confirmed" },
  request_reduction: { by: "firm", from: ["balance_confirmed", "countered"], to: "reduction_requested" },
  accept: { by: "provider", from: ["reduction_requested"], to: "accepted" },
  counter: { by: "provider", from: ["reduction_requested"], to: "countered" },
  accept_counter: { by: "firm", from: ["countered"], to: "accepted" },
};

/** The amount on the table: the last request or counter. */
const lastOffer = (h: LienEvent[]) => [...h].reverse().find((e) => e.action === "request_reduction" || e.action === "counter")?.amount ?? null;

export async function lienStep(matterId: number, nodeId: number, by: "firm" | "provider", action: LienAction, amount: number | null, note?: string): Promise<Lien> {
  const rule = RULES[action];
  if (!rule) throw new LienError("Unknown step");
  if (rule.by !== by) throw new LienError("Not allowed for this side");
  const cur = await readLien(matterId, nodeId);
  if (!rule.from.includes(cur?.status ?? "none")) throw new LienError(`Cannot ${action.replace("_", " ")} while the lien is ${cur?.status ?? "not started"}`);

  const needsAmount = action === "confirm" || action === "request_reduction" || action === "counter";
  if (needsAmount && (amount === null || !Number.isFinite(amount) || amount < 0)) throw new LienError("Enter an amount");
  const balance = action === "confirm" ? amount : cur?.balance ?? null;
  const offer = cur ? lastOffer(cur.history) : null;
  if (action === "request_reduction" && balance !== null && amount! >= balance) throw new LienError("A reduction must be below the confirmed balance");
  if (action === "counter" && offer !== null && balance !== null && (amount! <= offer || amount! >= balance)) {
    throw new LienError("A counter must be between the firm's request and the balance");
  }
  const agreed = action === "accept" || action === "accept_counter" ? offer : null;
  const ev: LienEvent = { at: new Date().toISOString(), by, action, amount: needsAmount ? amount : agreed, ...(note ? { note: note.slice(0, 500) } : {}) };

  await q(
    `INSERT INTO liens (matter_id, provider_node_id, balance, status, history) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (matter_id, provider_node_id) DO UPDATE SET balance = $3, status = $4, history = liens.history || $5`,
    [matterId, nodeId, balance, rule.to, JSON.stringify([ev])],
  );
  return (await readLien(matterId, nodeId))!;
}
