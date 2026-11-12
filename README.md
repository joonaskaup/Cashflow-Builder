# Cashflow Builder

Import an existing FFF budget, plan work and payments on a timeline, and export the cashflow into the FFF cashflow sheet in your budget workbook.

Start with a rough plan for several costs at once. Refine individual costs with work periods, payment months, percentages and installments. A report of work dates and payments provides a starting point for preparing agreements.

**For Apple silicon Macs, macOS 12 or later.** The recommended download is **0.2.0rc1**, packaged as a Mac app. Intel Mac and Windows packages are not available.

## Download and start

1. Open the [latest Mac release](https://github.com/joonaskaup/Cashflow-Builder/releases/latest).
2. Download **Cashflow-Builder-0.2.0rc1-macos-arm64-app.zip** from **Assets**. GitHub's “Source code” downloads are not runnable Mac apps.
3. Unzip it and move **Cashflow Builder.app** to Applications or another permanent location.
4. Open Cashflow Builder. Its interface opens in your browser; clicking its Dock icon reopens the page.
5. Try the fictional example, or import your own saved and closed Excel budget.

The app contains Python and the libraries it needs. No separate Python installation or Terminal window is required. Projects are stored outside the app, so replacing it during an update keeps them in place.

### If macOS says “Not Opened”

The app is locally (ad-hoc) signed, **not Apple-notarized**. It replaces the older folder download, which can trigger separate warnings for Python and its libraries. Signature-integrity and functional tests do not prove that a downloaded app passes Gatekeeper.

A real browser download passed testing on the development Mac after one app-specific approval: import, save, report export and reopening worked without separate component warnings. An independent clean-account or second-Mac check remains. See the [test record](docs/MAC_DISTRIBUTION_CHECK.md).

If you downloaded it from this repository's release and choose to trust it:

1. Click **Done** in the warning.
2. Open **System Settings → Privacy & Security**, then scroll to **Security**.
3. Find the blocked **Cashflow Builder.app** and click **Open Anyway**.
4. Review the confirmation and click **Open**. Authenticate if macOS asks.

If Python or individual libraries still trigger warnings, stop and report them; do not work through a series of component exceptions. If the message says the software **will damage your computer**, is **damaged**, or no exception is available, stop and report that exact message.

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

The same guide is available offline through **Help** on the start page and inside every project.

## Updating an existing installation

For an existing **.app** installation: save, quit, then replace the application. Projects stay in `~/Library/Application Support/Cashflow Builder/Projects`.

For the older **folder version**: save and stop it, keep its Projects folder as a backup, then copy the individual project folders into the new app's Projects folder. The start page has **Open Projects folder** and migration instructions. Do not use the old updater for the .app, replace a same-named project folder, or re-import budgets to migrate saved timing.

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
