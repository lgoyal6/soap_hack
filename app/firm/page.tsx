// Owner: Tijil. Placeholder landing: the firm page proper is built in the firm-screens lane.
import SharePanel from "@/components/share/SharePanel";
import VoiceDock from "@/components/voice/VoiceDock";
import { tools } from "@/lib/tools";

export default async function FirmHome() {
  const matters = await tools.listMatters();
  const m = matters[0];
  return (
    <main style={{ padding: 32, fontSize: 18 }}>
      <h1>{m ? m.name : "No matter synced yet"}</h1>
      <form action="/api/sync" method="post"><button type="submit">Sync from Clio</button></form>
      {m && (<><VoiceDock matterId={m.id} /><SharePanel matterId={m.id} /></>)}
    </main>
  );
}
