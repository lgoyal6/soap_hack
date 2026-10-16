import type { IncomingMessage, ServerResponse } from "node:http";
import { runScenario } from "../public-lab/run.ts";

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.writeHead(405).end(JSON.stringify({ error: "Use POST" })); return; }
  let input: unknown;
  try {
    if (req.body !== undefined) {
      const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(text) > 1024) throw new Error("oversize");
      input = JSON.parse(text);
    } else {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 1024) throw new Error("oversize");
        chunks.push(bytes);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
  } catch { res.writeHead(400).end(JSON.stringify({ error: "Invalid bounded inputs" })); return; }
  try { res.writeHead(200).end(JSON.stringify(await runScenario(input))); }
  catch { res.writeHead(400).end(JSON.stringify({ error: "Unable to evaluate bounded scenario" })); }
}
