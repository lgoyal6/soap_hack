// Owner: Tijil. Frozen. Every model call goes through here so tokens and duration are logged (contract F).
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { q } from "./db";

// GMI Cloud speaks the OpenAI API; the model ids come from env, never from code.
export const llm = new OpenAI({ apiKey: process.env.GMI_API_KEY || "missing", baseURL: process.env.GMI_BASE_URL, timeout: 90_000, maxRetries: 1 });

export const MODEL = process.env.LLM_MODEL ?? "";
export const MODEL_FAST = process.env.LLM_MODEL_FAST || MODEL;

export async function logCall(purpose: string, model: string, inTok: number | undefined, outTok: number | undefined, ms: number) {
  await q("INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, ms) VALUES ($1,$2,$3,$4,$5)", [
    purpose, model, inTok ?? null, outTok ?? null, ms,
  ]).catch(() => {}); // logging must never break a request
}

/** Non-streaming call, logged. For streaming, use `llm` directly and call `logCall` when the stream ends. */
export async function chat(purpose: string, params: Omit<ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string }) {
  const model = params.model ?? MODEL;
  if (!process.env.GMI_API_KEY || !model) throw new Error("Model not configured: set GMI_API_KEY and LLM_MODEL in .env");
  const t = Date.now();
  const res = await llm.chat.completions.create({ ...params, model });
  await logCall(purpose, model, res.usage?.prompt_tokens, res.usage?.completion_tokens, Date.now() - t);
  return res;
}

/** Ask for JSON and parse it; tolerates a fenced code block around the JSON. */
export async function chatJson<T>(purpose: string, system: string, user: string, model?: string): Promise<T> {
  const res = await chat(purpose, {
    model,
    temperature: 0,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const body = text.slice(text.search(/[[{]/), Math.max(text.lastIndexOf("}"), text.lastIndexOf("]")) + 1);
  return JSON.parse(body) as T;
}
