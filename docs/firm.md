# Firm page (owner: Tijil)

`/firm` is one page, large type, no tabs. `app/firm/page.tsx` reads everything through the case tools
(`lib/tools`, contract A) and hands it to `components/firm/FirmBrief.tsx`.

| Section | Where it comes from |
|---|---|
| Top bar | Matter fields, last message with the client, the firm's own limitations task, sum of expense entries, scan progress |
| Where this case stands | Two or three model-written sentences, each tied to the items it rests on; dropped if they carry a number the computed state lacks |
| Conflicts in the file | Facts that disagree, shown as the verbatim quotes side by side |
| Money | The firm's own fields, coverage figures and liens quoted from records, expenses summed; rough net to client with its arithmetic |
| Injuries found in the file | Quoted findings from records and scan pages, linked to the page |
| Open items | Per request thread: who the firm waits on, asks counted by code, days open, any other count the file states, the provider's reply |
| Not yet done | Things the file says exist or were promised, with no later record of them happening |
| The ten that matter | Weighted score per record; Pin and Not important adjust the weights |
| What is new | Records dated after a chosen day (defaults to the last visit on an earlier day) |
| Case replay | Dated records animated in four lanes |

Every "source" button opens the record in a side panel with the quoted words highlighted.

The voice agent moves the page with browser events (`casebrief:show`, `casebrief:chips`, `casebrief:replay`).
Open items are re-read every few seconds so a provider's reply appears without a reload.
