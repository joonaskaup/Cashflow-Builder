# Cashflow Builder

Import an existing FFF budget, plan work and payments on a timeline, and export the cashflow into the FFF cashflow sheet in your budget workbook.

Start with a rough plan for several costs at once. Refine individual costs with work periods, payment months, percentages and installments. A report of work dates and payments provides a starting point for preparing agreements.

**For Apple silicon Macs.** This first public release is version **0.1.0**. Intel Mac and Windows packages are not available.

## Download and start

1. Open the [latest release](https://github.com/joonaskaup/Cashflow-Builder/releases/latest).
2. Download **Cashflow-Builder-0.1.0-macos-arm64.zip** from **Assets**. GitHub's “Source code” downloads do not include the runtime needed to launch the app.
3. Unzip it and keep the whole **Cashflow Builder** folder together in a writable location on your Mac.
4. Double-click **Start Cashflow Builder.command**. Keep its Terminal window open while working.
5. Try the fictional example, or import your own saved and closed Excel budget.

The package includes Python and the libraries it needs. You do not need to install a programming environment. It is a folder-based app, not a signed or notarized macOS installer.

### If macOS says “Not Opened”

The current release is **unsigned and not notarized**. macOS may block the downloaded launcher with “Apple could not verify … is free of malware”. Local launch tests do not replace Apple's verification.

If you downloaded it from this repository's release and choose to trust it:

1. Click **Done** in the warning.
2. Open **System Settings → Privacy & Security**, then scroll to **Security**.
3. Find the blocked **Start Cashflow Builder.command** and click **Open Anyway**.
4. Review the confirmation and click **Open**. Authenticate if macOS asks.

The updater may need the same per-file approval. If another component is blocked, check its exact name before proceeding. If the message says the software **will damage your computer**, is **damaged**, or no exception is available, stop and report that exact message.

See [Apple's opening instructions](https://support.apple.com/en-us/102445). Do not disable Gatekeeper globally or remove quarantine from your entire Downloads folder. A signed and notarized package is not yet available.

## How planning works

| Choose this | When it is useful | If production dates change |
| --- | --- | --- |
| Months / Historical | Quickly place money in selected months, equally or by percentage | Chosen months stay fixed |
| Production periods | Make costs follow preparation, shooting or postproduction | Linked dates and payments recalculate |
| Days / months split | Use each cost's budget quantity; put the remainder in one part | Linked placements recalculate; paid days are a separate input |
| Installments | Pay shares at named milestones | Moving a linked milestone moves its payment |

**Work dates and payment dates are different.** Clicking August and September places payments there; it does not say that someone works throughout those months.

## Instructions

The [user guide](docs/USER_GUIDE.md) covers:

- A first cashflow from import to save.
- Months first, exact dates later; periods versus milestones.
- Paid days, calendar months and the remaining work quantity.
- What follows a date change and what stays fixed.
- Bulk planning, installments, Historical and reports.
- Updating budget figures while retaining saved timing.
- Updating the app, moving projects and restoring backups.

The same guide is available offline through **Help** on the start page and inside every project. It is also included as **help.html** in the download.

## Updating an existing installation

Save your work. Unzip the new release separately, run **Update existing Cashflow Builder.command** from the new download, and choose your existing app folder. Then launch from that existing folder, where your **Projects** folder remains. Do not replace the whole folder in Finder or import every project again.

See [updating and backups](docs/USER_GUIDE.md#updating-the-app-and-backing-up-projects).

## Files and privacy

The app runs locally. It has no telemetry, remote fonts or cloud upload. Its launcher restricts network access to the local browser connection. Each project keeps an unchanged imported workbook and a separate working copy. Saved timings and shared dates are stored with the project.

Back up the **whole Projects folder**, not only the Excel cashflow. The app does not encrypt those files. Excel, browser extensions and any sync or backup services remain separate from the app.

This repository and its release contain only application code, instructions, dependencies and one fictional workbook. They contain no production projects or private budgets. Please use fictional examples when reporting an issue.

## Compatibility

- Imports `.xlsx` and `.xlsm` files; convert old `.xls` files in Excel first.
- Requires the supported FFF `Erittely` and `Maksuvalmiussuunnitelma` layout. Unrecognised layouts or totals that do not reconcile are flagged.
- Excel must calculate and save source formulas before import or refresh.
- Financing stays manual in the working workbook.
- The FFF sheet has 17 display columns; payments outside that range are reported separately.

See the [release notes](CHANGELOG.md) and [development instructions](docs/DEVELOPMENT.md).
