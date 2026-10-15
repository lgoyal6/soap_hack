// App liveness for local operators and container probes.
// This route deliberately avoids case data, sessions, databases and providers.
// A successful response proves HTTP serving only, not dependency readiness.
export function GET() {
  return Response.json(
    { status: "ok", check: "liveness" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
