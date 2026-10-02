// Owner: Laksh. One voice turn: model with tools, streamed, each sentence checked before it is shown or spoken.
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import type { SourceRef } from "../contracts";
import { q } from "../db";
import { llm, logCall, MODEL } from "../llm";
import { extractCites, numbersFromData, splitSentences, unsupported } from "./check";
import { allowFrom, runTool, TOOL_DEFS, type Action, type Registry } from "./tools";

export type VoiceEvent =
  | { type: "sentence"; text: string; sources: SourceRef[]; section: string | null }
  | { type: "dropped"; text: string; numbers: string[] }
  | { type: "tool"; name: string }
  | Action
  | { type: "error"; message: string }
  | { type: "done"; turnId: number | null };

type Conversation = { messages: ChatCompletionMessageParam[]; reg: Registry; allowed: Set<string>; at: number };

// Per signed-in user and case. Survives Next.js dev reloads; lost on server restart, which only ends the thread.
const g = globalThis as unknown as { __voiceConv?: Map<string, Conversation> };
const store = (g.__voiceConv ??= new Map());

export function resetConversation(userId: number, matterId: number) {
  store.delete(`${userId}:${matterId}`);
}

function conversation(userId: number, matterId: number): Conversation {
  const k = `${userId}:${matterId}`;
  let c = store.get(k);
  if (!c || Date.now() - c.at > 6 * 3600_000) {
    c = { messages: [], reg: { refs: [], section: [] }, allowed: new Set(), at: Date.now() };
    store.set(k, c);
  }
  c.at = Date.now();
  return c;
}

function system(today: string, since: string) {
  return [
    "You are the paralegal for a personal-injury law firm, speaking to an attorney about one case.",
    "You know nothing about the case except what your tools return. Call tools before answering; never guess.",
    "Your words are read aloud. Use short, plain sentences, at most about twenty-five words each. No lists, headings, markdown or emoji.",
    "NUMBERS: never write a number, date, amount, count or duration that does not appear in a tool result. Do not add, subtract, round, convert or estimate. Do not work out deadlines or how long ago something was; repeat what the tools say. Any sentence with a number the tools did not give is deleted before it is spoken.",
    "Use the `count` field for how many items there are.",
    "SOURCES: tool results number their sources. End each factual sentence with the numbers it rests on in square brackets, before the full stop, for example: The carrier letter gives a lower limit [4].",
    "If something is not found, say so, and say how much was searched using the `searched` counts.",
    "Where the file disagrees with itself, give both versions and do not pick one.",
    "Deadlines: report the firm's own task or calendar entry; never compute one.",
    "Use `show` to put the relevant section or record on screen when it helps the attorney follow along. Use `play_replay` when asked to replay or walk through the case.",
    "Use `create_draft` only when asked to draft something. Say it is saved as a draft; never say it was sent.",
    "Use `send_imessage` only when the attorney asks you to text or message them a summary. Gather the facts with tools first, keep it to a few sentences with source markers, and say it was sent only if the tool says so.",
    "For a brief, cover where the case stands, what the attorney must decide, conflicts, open items and money, in about eight to ten sentences, then what changed.",
    `Today is ${today}. The attorney last looked at this case on ${since}; use that for "what changed" unless they give a date.`,
  ].join("\n");
}

async function lastVisit(userId: number, matterId: number) {
  const [v] = await q<{ prev_at: Date | null }>("SELECT prev_at FROM firm_visits WHERE user_id = $1 AND matter_id = $2", [userId, matterId]).catch(() => []);
  return (v?.prev_at ?? new Date(Date.now() - 30 * 86_400_000)).toISOString().slice(0, 10);
}

export async function runTurn(opts: { userId: number; matterId: number; message: string; signal: AbortSignal; emit: (e: VoiceEvent) => void }) {
  const { userId, matterId, message, signal, emit } = opts;
  const conv = conversation(userId, matterId);
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const since = await lastVisit(userId, matterId);
  // The user's own words and the dates in the prompt are not model inventions.
  numbersFromData([message, today, since], conv.allowed);

  conv.messages.push({ role: "user", content: message });
  const spoken: string[] = [];
  const dropped: { text: string; numbers: string[] }[] = [];
  const calls: string[] = [];
  let firstText: number | null = null;
  let inTok = 0, outTok = 0;
  let lastSection: string | null = null;
  let error: string | null = null;

  const sentence = (raw: string) => {
    const { text, cites } = extractCites(raw);
    if (!/[a-z0-9]/i.test(text)) return;
    const bad = unsupported(text, conv.allowed);
    if (bad.length) {
      dropped.push({ text, numbers: bad });
      emit({ type: "dropped", text, numbers: bad });
      return;
    }
    const sources = cites.map((n) => conv.reg.refs[n - 1]).filter(Boolean);
    const section = cites.map((n) => conv.reg.section[n - 1]).find(Boolean) ?? null;
    firstText ??= Date.now() - t0;
    spoken.push(raw.trim());
    emit({ type: "sentence", text, sources, section: section && section !== lastSection ? section : null });
    if (section) lastSection = section;
  };

  try {
    if (!process.env.GMI_API_KEY || !MODEL) throw new Error("The model is not configured: set GMI_API_KEY and LLM_MODEL in .env");
    for (let round = 0; round < 8; round++) {
      const t = Date.now();
      const stream = await llm.chat.completions.create(
        {
          model: MODEL, temperature: 0.2, stream: true, stream_options: { include_usage: true },
          tools: TOOL_DEFS,
          messages: [{ role: "system", content: system(today, since) }, ...conv.messages],
        },
        { signal },
      );
      let buf = "";
      let content = "";
      const tc: { id: string; name: string; args: string }[] = [];
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const d = chunk.choices?.[0]?.delta;
        if (!d) continue;
        if (d.content) {
          content += d.content;
          buf += d.content;
          const { done, rest } = splitSentences(buf);
          buf = rest;
          done.forEach(sentence);
        }
        for (const c of d.tool_calls ?? []) {
          const slot = (tc[c.index] ??= { id: "", name: "", args: "" });
          if (c.id) slot.id = c.id;
          if (c.function?.name) slot.name += c.function.name;
          if (c.function?.arguments) slot.args += c.function.arguments;
        }
      }
      if (buf.trim()) sentence(buf);
      inTok += usage?.prompt_tokens ?? 0;
      outTok += usage?.completion_tokens ?? 0;
      await logCall("voice", MODEL, usage?.prompt_tokens, usage?.completion_tokens, Date.now() - t);

      const toolCalls = tc.filter((c) => c && c.name);
      if (!toolCalls.length) {
        conv.messages.push({ role: "assistant", content: spoken.join(" ") || content });
        break;
      }
      conv.messages.push({
        role: "assistant", content: content || null,
        tool_calls: toolCalls.map((c, i): ChatCompletionMessageToolCall => ({ id: c.id || `call_${round}_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
      });
      for (const [i, c] of toolCalls.entries()) {
        emit({ type: "tool", name: c.name });
        calls.push(c.name);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.args || "{}"); } catch { /* model sent bad JSON; run with no arguments */ }
        let result: unknown;
        try {
          const r = await runTool(c.name, args, { matterId, userId, reg: conv.reg, allowed: conv.allowed, userMessage: message });
          result = r.result;
          r.actions.forEach(emit);
        } catch (e) {
          result = { error: `Tool failed: ${(e as Error).message}` };
        }
        allowFrom(result, conv.allowed);
        conv.messages.push({ role: "tool", tool_call_id: c.id || `call_${round}_${i}`, content: JSON.stringify(result) });
      }
    }
  } catch (e) {
    if (signal.aborted) error = "interrupted";
    else {
      error = (e as Error).message;
      emit({ type: "error", message: error });
    }
    // Keep the history valid: an assistant turn with tool calls must be followed by their results.
    const last = conv.messages.at(-1);
    if (last?.role === "assistant" && "tool_calls" in last && last.tool_calls?.length) conv.messages.pop();
    if (conv.messages.at(-1)?.role === "user") conv.messages.push({ role: "assistant", content: spoken.join(" ") || "(no answer)" });
  }
  // Keep the thread bounded; start at a user message so tool results never lose their call.
  if (conv.messages.length > 60) {
    const cut = conv.messages.findIndex((m, i) => i >= conv.messages.length - 40 && m.role === "user");
    if (cut > 0) conv.messages.splice(0, cut);
  }

  const [row] = await q<{ id: string }>(
    `INSERT INTO voice_turns (user_id, matter_id, model, question, answer, dropped, tool_calls, first_text_ms, total_ms, tokens, input_tokens, output_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [userId, matterId, MODEL, message, spoken.map((s) => extractCites(s).text).join(" ") + (error ? ` [${error}]` : ""),
      JSON.stringify(dropped), JSON.stringify(calls), firstText, Date.now() - t0, inTok + outTok || null, inTok || null, outTok || null],
  ).catch(() => []);
  emit({ type: "done", turnId: row ? Number(row.id) : null });
}
