// Owner: Tijil. Contract A in BUILD_PLAN.md: the only way the voice agent, the firm page and the
// share panel learn about a case. Signatures are frozen in lib/contracts.ts.
import type { CaseTools } from "../contracts";
import { fixtureTools } from "@/fixtures/case";
import { liveTools } from "./live";

// USE_FIXTURES=1 serves the made-up fixture case (for building without a Clio sync, and for tests).
export const tools: CaseTools = process.env.USE_FIXTURES === "1" ? fixtureTools : liveTools;
