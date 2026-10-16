"use strict";
const $ = (id) => document.getElementById(id);
let revision = 0, pending;
function clear(message) { $("status").textContent = message; $("counts").textContent = ""; $("output").textContent = ""; }
$("form").addEventListener("input", () => { revision++; pending?.abort(); clear("Inputs changed. Run the transaction again."); $("run").disabled = false; });
$("form").addEventListener("submit", async (event) => {
  event.preventDefault(); const current = ++revision; pending?.abort();
  const controller = new AbortController(); pending = controller;
  const timer = setTimeout(() => controller.abort(), 20000);
  clear("Running the sharing transaction..."); $("run").disabled = true;
  const input = { consent: $("consent").value === "true", stale: $("stale").value === "true", recipient: $("recipient").value, retry: $("retry").value === "true" };
  try {
    const response = await fetch("/api/public-demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
    const result = await response.json(); if (current !== revision) return;
    if (!response.ok) throw new Error(result.error || "No transaction result is available.");
    $("status").textContent = result.outcome === "published" ? "Published the current consented revision" : `Refused (${result.status}): ${result.reason}`;
    $("counts").textContent = `${result.counts.shared_items} shared item(s), ${result.counts.publish_jobs} job record(s), ${result.counts.outbox} outbox row(s). No delivery was attempted.`;
    $("output").textContent = JSON.stringify(result, null, 2);
  } catch (error) { if (current === revision) clear(error.name === "AbortError" ? "Request timed out. No result is available." : error.message); }
  finally { clearTimeout(timer); if (current === revision) $("run").disabled = false; }
});
