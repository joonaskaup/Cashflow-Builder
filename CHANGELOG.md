# Releases

## 0.2.0rc1 — 7 November 2026

Mac app packaging preview; not Apple-notarized and not promoted as the general release.

- Bundle the engine and Python libraries inside Cashflow Builder.app.
- Add a native launcher, timeline icon, Dock reopening and save reminder on Quit.
- Keep projects in a permanent Application Support folder outside the app.
- Add migration guidance and an Open Projects folder button.
- Verify nested code signatures and actual frozen import/save/refresh/relocation behaviour.
- Retain local-only network access and the existing planning engine.


## 0.1.0 — 6 November 2026

First public Cashflow Builder release for Apple silicon Macs.

- Import supported FFF budgets into separate original and working copies.
- Plan directly on the timeline; assign payment months or percentages to one cost or a selection.
- Link work and payments to production periods and numbered installment milestones.
- Split budget days or months between preparation, shooting and wrap, with a remaining-quantity part.
- Review exact monthly amounts, unallocated costs and payments outside the Excel display.
- Refresh budget figures while retaining matched costs' saved timing and flagging changes for review.
- Export the cashflow into the working FFF workbook and export work/payment reports.
- Keep zero cashflow amounts light grey in Excel.
- Update an existing app folder while retaining projects and backing up previous app code.
- New offline Help guide on the start page and inside projects, covering the full workflow, allocation assumptions, dates, budget refreshes and backups.

### Existing users

Unzip separately and run **Update existing Cashflow Builder.command** from the download. Select your existing app folder, then launch from that folder. Do not replace your Projects folder or re-import your budgets.

### Supported environment

Apple silicon Mac, with the bundled Python 3.12 runtime. The release is not signed or notarized. Source formulas need current values saved by Excel. The supported FFF cashflow layout is required; this is not a general Excel formula engine. Financing remains manual.
