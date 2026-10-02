// Owner: Tijil. Contract A in BUILD_PLAN.md: the only way the voice agent, the firm page and the
// share panel learn about a case. Signatures are frozen in lib/contracts.ts.
import type { CaseTools } from "../contracts";
import { fixtureTools } from "@/fixtures/case";

// Until the live implementation lands, every caller gets the made-up fixture case.
// USE_FIXTURES=1 keeps the fixture case after that (for building without a Clio sync, and for tests).
export const tools: CaseTools = fixtureTools;
