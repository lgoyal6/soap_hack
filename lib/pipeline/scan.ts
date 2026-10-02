// Owner: Tijil. Reads every PDF on a matter one page at a time and stores what each page says.
// A page is read once: it is keyed by a hash of its content, so re-running skips finished pages.
// Per page, in order: (1) the PDF's own text layer; (2) for scans, the embedded page image sent to a
// vision model; (3) the single page sent as a PDF. Anything that fails is marked failed and counted,
// so the page can say "N of M pages read".
import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { clioDownload } from "../clio";
import { q } from "../db";
import { chat, MODEL_FAST } from "../llm";
import { numbersIn, quoteFound } from "./compute";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const MIN_TEXT = 200; // fewer characters than this on a page means it is a scan, not text

type PageFacts = { text?: string; provider?: string | null; service_date?: string | null; doc_type?: string | null; diagnoses?: { body_part: string; finding: string; quote: string }[]; charges?: { description: string; amount: number; quote: string }[] };

const SYSTEM = `You read one page from a personal-injury case file (medical records, bills, pleadings, expert reports).
Return only JSON:
{"text": "<the page's text, transcribed faithfully; omit this key if the page text was given to you>",
 "provider": "<treating provider or author named on the page, or null>",
 "service_date": "<date of service or of the document as written on the page, or null>",
 "doc_type": "<a few words: e.g. operative report, billing ledger, imaging report, pleading>",
 "diagnoses": [{"body_part": "...", "finding": "...", "quote": "<verbatim from the page>"}],
 "charges": [{"description": "...", "amount": 0, "quote": "<verbatim from the page, containing the amount>"}]}
Only include a diagnosis or charge that is actually on this page. Quotes must be copied exactly.`;

/** The text layer of every page, via pdf.js (no rendering, so no canvas is needed). */
async function textLayers(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  await task.destroy();
  return out;
}

/** A scanned page is usually one JPEG stored inside the PDF; pull it out as-is. */
function embeddedJpeg(doc: PDFDocument, pageIndex: number): Uint8Array | null {
  const xobjects = doc.getPage(pageIndex).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  let best: Uint8Array | null = null;
  for (const [, ref] of xobjects?.entries() ?? []) {
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = obj.dict.lookup(PDFName.of("Filter"));
    const names = filter instanceof PDFArray ? filter.asArray().map(String) : [String(filter)];
    if (names.length === 1 && names[0] === "/DCTDecode" && (!best || obj.contents.length > best.length)) best = obj.contents;
  }
  return best;
}

async function singlePagePdf(doc: PDFDocument, pageIndex: number): Promise<Uint8Array> {
  const one = await PDFDocument.create();
  one.addPage((await one.copyPages(doc, [pageIndex]))[0]);
  return one.save();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function readPage(doc: PDFDocument, pageIndex: number, text: string): Promise<PageFacts> {
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
  let user: any;
  if (text.length >= MIN_TEXT) {
    user = `Page text:\n${text.slice(0, 12000)}`;
  } else {
    const jpeg = embeddedJpeg(doc, pageIndex);
    user = jpeg
      ? [{ type: "text", text: "Read this scanned page." }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(jpeg)}` } }]
      : [{ type: "text", text: "Read this page." }, { type: "file", file: { filename: "page.pdf", file_data: `data:application/pdf;base64,${b64(await singlePagePdf(doc, pageIndex))}` } }];
  }
  const res = await chat("scan_page", { model: MODEL_FAST, temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] });
  const raw = res.choices[0]?.message?.content ?? "";
  const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as PageFacts;
  if (text.length >= MIN_TEXT) out.text = text; // never let the model replace text we already have
  return out;
}

export type ScanReport = { documents: number; pages: number; done: number; failed: number; skipped: number };

/** Reads every PDF document on the matter. Safe to call again: finished pages are skipped. */
export async function scanMatter(matterId: number, parallel = 4): Promise<ScanReport> {
  const docs = await q<{ clio_id: string; data: any }>("SELECT clio_id, data FROM raw_records WHERE matter_id = $1 AND resource = 'documents'", [matterId]);
  const report: ScanReport = { documents: 0, pages: 0, done: 0, failed: 0, skipped: 0 };

  for (const d of docs) {
    const documentId = Number(d.clio_id);
    const name = String(d.data.name ?? d.data.filename ?? "");
    const type = String(d.data.content_type ?? d.data.latest_document_version?.content_type ?? "");
    if (!/pdf/i.test(type) && !/\.pdf$/i.test(name)) continue;

    let bytes: Uint8Array, doc: PDFDocument, texts: string[];
    try {
      bytes = await clioDownload(documentId);
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      texts = await textLayers(bytes).catch(() => []);
    } catch { continue; }
    report.documents++;

    const pages = doc.getPageCount();
    const docHash = sha(bytes);
    const prior = new Map((await q<{ page_no: number; page_hash: string; status: string }>("SELECT page_no, page_hash, status FROM scan_pages WHERE document_id = $1", [documentId])).map((p) => [p.page_no, p]));
    const todo: number[] = [];
    for (let i = 0; i < pages; i++) {
      report.pages++;
      const hash = `${docHash}:${i + 1}`;
      const before = prior.get(i + 1);
      if (before?.page_hash === hash && before.status === "done") { report.skipped++; continue; }
      await q(
        `INSERT INTO scan_pages (document_id, page_no, page_hash, status) VALUES ($1,$2,$3,'pending')
         ON CONFLICT (document_id, page_no) DO UPDATE SET page_hash = $3, status = 'pending'`,
        [documentId, i + 1, hash],
      );
      todo.push(i);
    }

    for (let at = 0; at < todo.length; at += parallel) {
      await Promise.all(todo.slice(at, at + parallel).map(async (i) => {
        const pageNo = i + 1;
        try {
          const out = await readPage(doc, i, texts[i] ?? "");
          const text = out.text ?? "";
          await q("UPDATE scan_pages SET extracted = $3, text = $4, status = 'done' WHERE document_id = $1 AND page_no = $2", [documentId, pageNo, JSON.stringify({ ...out, text: undefined }), text]);
          await q(
            `INSERT INTO search_index (matter_id, resource, clio_id, page_no, title, body) VALUES ($1,'documents',$2,$3,$4,$5)
             ON CONFLICT (resource, clio_id, page_no) DO UPDATE SET title = $4, body = $5`,
            [matterId, documentId, pageNo, `${name}, page ${pageNo}`, text],
          );
          // Trust rule, same as for records: quote must be on the page, amount must be in the quote.
          await q("DELETE FROM facts WHERE matter_id = $1 AND resource = 'documents' AND clio_id = $2 AND page_no = $3", [matterId, documentId, pageNo]);
          const insert = (type: string, subject: string, value: object, quote: string) => q(
            `INSERT INTO facts (matter_id, type, subject, value, quote, resource, clio_id, page_no, source_hash)
             VALUES ($1,$2,$3,$4,$5,'documents',$6,$7,$8)`,
            [matterId, type, subject, JSON.stringify(value), quote, documentId, pageNo, sha(text)],
          );
          for (const dx of out.diagnoses ?? []) {
            if (dx.quote && quoteFound(dx.quote, text)) await insert("injury", String(dx.body_part ?? "").toLowerCase(), { finding: dx.finding, provider: out.provider ?? null }, dx.quote);
          }
          for (const c of out.charges ?? []) {
            if (c.quote && quoteFound(c.quote, text) && numbersIn(c.quote).includes(String(c.amount).replace(/\.0+$/, ""))) {
              await insert("amount", "bill", { amount: c.amount, category: "bills", provider: out.provider ?? null, description: c.description }, c.quote);
            }
          }
          report.done++;
        } catch {
          await q("UPDATE scan_pages SET status = 'failed' WHERE document_id = $1 AND page_no = $2", [documentId, pageNo]);
          report.failed++;
        }
      }));
    }
  }
  return report;
}
