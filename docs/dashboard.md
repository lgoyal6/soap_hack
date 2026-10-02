# Dashboard (owner: Laksh)

`/dashboard` is a one-screen widget home for the firm, built on the same case tools as `/firm` (which stays as the classic page).

- Every section of the brief is a tile: client, where it stands, paralegal, waiting on, money, conflicts, not yet done,
  injuries, entries that matter, what is new, providers, case replay. Tiles that need attention get a red edge.
- Click a tile to open its full view as a tab. Tabs close with ×; Home is always first.
- "Customise": drag tiles to reorder, × to hide, "+ name" to bring one back, "Reset layout". Saved in this browser.
- The paralegal tile stays mounted under every tab, so hold-space still works. Its page events (contract C) open the
  matching tab (`casebrief:show` with a section), open the source panel (with a source), and open and play the replay.
- Every "source" button opens the record in a side panel with the quote highlighted.
- Open items and the provider tile refresh every 10 seconds, so provider replies appear without a reload.

Files: `app/dashboard/**`, `components/dashboard/**`. Reuses Tijil's `ClientPhoto`, `Glance` and `Replay` components without changing them.
