// Owner: Laksh. Re-reads the case after each reply or lien step.
"use client";

import { useState } from "react";
import type { ProviderCase } from "@/lib/portal/types";
import CaseView from "./CaseView";

export default function ProviderCaseClient({ initial }: { initial: ProviderCase }) {
  const [data, setData] = useState(initial);
  async function refresh() {
    const res = await fetch(`/api/provider/case?matterId=${initial.matterId}`);
    if (res.ok) setData(await res.json());
  }
  return <CaseView data={data} onChange={refresh} />;
}
