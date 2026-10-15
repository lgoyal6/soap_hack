// Owner: Laksh. A local stand-in for an OpenAI-compatible chat endpoint (the API GMI serves), used to drive the real
// voice agent through the real `openai` SDK with disconnects, stalls and retries. It is a test double for the network
// boundary, not a model: it calls one tool, then speaks sentences built from that tool's result.
// The scenario comes from the attorney's message ("scenario:<name>").
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type StubLog = { scenario: string; round: number; attempt: number; closedEarly: boolean; finished: boolean };
type Msg = { role: string; content?: string | null; tool_calls?: unknown[] };

const sse = (res: ServerResponse, obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: "stub", object: "chat.completion.chunk", created: 0, model: "stub-model", choices: [{ index: 0, delta, finish_reason: finish }],
});

/** First item with a provider, an ask count and a source in a get_open_items result, as the model received it. */
function pickItem(messages: Msg[]) {
  const tool = [...messages].reverse().find((m) => m.role === "tool");
  const data = JSON.parse(String(tool?.content ?? "{}")) as { items?: { waitingOn?: string; asks?: number; daysOpen?: number; sources?: number[] }[] };
  const it = (data.items ?? []).find((x) => x.waitingOn && typeof x.asks === "number" && typeof x.daysOpen === "number" && x.sources?.length);
  if (!it) throw new Error("stub: no usable open item in the tool result");
  return { who: it.waitingOn!, asks: it.asks!, days: it.daysOpen!, src: it.sources![0] };
}

export async function startStub(port: number): Promise<{ server: Server; log: StubLog[]; close: () => Promise<void> }> {
  const log: StubLog[] = [];
  const attempts = new Map<string, number>();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const c of req) raw += c;
    if (!req.url?.endsWith("/chat/completions")) { res.writeHead(404).end(); return; }
    const body = JSON.parse(raw) as { messages: Msg[] };
    const user = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const scenario = /scenario:([a-z-]+)/.exec(String(user))?.[1] ?? "grounded";
    const round = body.messages.filter((m) => m.role === "tool").length ? 2 : 1;
    const k = `${scenario}:${round}:${body.messages.length}`;
    const attempt = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, attempt);
    const entry: StubLog = { scenario, round, attempt, closedEarly: false, finished: false };
    log.push(entry);
    res.on("close", () => { if (!entry.finished) entry.closedEarly = true; });

    if (round === 2 && scenario === "drop-before-headers" && attempt === 1) { req.socket.destroy(); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

    if (round === 1) {
      sse(res, chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_open_items", arguments: "{}" } }] }));
      sse(res, chunk({}, "tool_calls"));
      sse(res, { ...chunk({}), choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } });
      res.write("data: [DONE]\n\n");
      entry.finished = true;
      res.end();
      return;
    }

    const { who, asks, days, src } = pickItem(body.messages);
    const good = `${who} was asked ${asks} times [${src}]. `;
    // The days-open number from the same cited item, spoken as a count of asks. It is in the tool result, so the old
    // any-number check lets it through; the grounding check must not.
    const bad = `${who} was asked ${days} times [${src}]. `;
    const send = (text: string) => sse(res, chunk({ content: text }));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    if (scenario === "disconnect") {
      send(good);
      await wait(50);
      send(`${who} was asked `); // half a sentence, then the connection drops
      await wait(50);
      req.socket.destroy();
      return;
    }
    if (scenario === "stall") {
      send(good);
      return; // never ends; the agent's idle deadline must give up
    }
    if (scenario === "slow") {
      for (let i = 0; i < 50 && !res.closed; i++) { send(good); await wait(200); }
      if (!res.closed) { res.write("data: [DONE]\n\n"); entry.finished = true; res.end(); }
      return;
    }
    // grounded (and the retried attempt of drop-before-headers): one supported sentence, one with a swapped count.
    send(good);
    send(bad);
    send("That is all"); // ends without punctuation: flushed only because the stream ended normally
    sse(res, chunk({}, "stop"));
    sse(res, { ...chunk({}), choices: [], usage: { prompt_tokens: 200, completion_tokens: 30 } });
    res.write("data: [DONE]\n\n");
    entry.finished = true;
    res.end();
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { server, log, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
