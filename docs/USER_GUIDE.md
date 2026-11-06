# Cashflow Builder user guide

Version 0.1.0 · 6 November 2026

Use this guide while making your cashflow. The main distinction is between **when work happens** and **when money is paid**. A payment month alone does not create a work period.

## First cashflow in seven steps

1. Save and close your FFF budget in Excel. Start Cashflow Builder and choose the budget. Old `.xls` files must first be saved as `.xlsx` or `.xlsm` in Excel.
2. Check the project name and **First cashflow month**, then choose **Check budget and create project**. The app checks the source totals and makes its own working copy.
3. Open the project. In **Dates and periods**, enter preparation, shooting and postproduction. Months are enough for the first draft. Enter the shared number of paid shooting days if you will use day-based work plans.
4. Save the dates. In **Plan cashflow**, select a cost, several costs or a section. Choose payment months, production periods or installments.
5. Review the affected costs and calculated euros. Choose **Assign**, then **Save changes**. Assignment creates a draft; Save writes it to the workbooks.
6. Check **Still needs timing**, any warnings and the monthly totals. **Open cashflow workbook** opens your working budget with its FFF cashflow sheet.
7. Save before leaving. Return to **Projects** and use **Stop app** when finished. Closing a browser tab alone does not stop the app.

Try the fictional example first if you want to explore without using a real budget.

## Opening a downloaded copy on macOS

The current release is unsigned and not notarized. macOS may show **Not Opened** and say Apple could not verify that the launcher is free of malware. Local app tests do not replace Apple's verification.

If you downloaded the release from the Cashflow Builder GitHub repository and choose to trust it:

1. Click **Done** in the warning.
2. Open **System Settings → Privacy & Security** and scroll to **Security**.
3. Find **Start Cashflow Builder.command** and click **Open Anyway**.
4. Review the confirmation, click **Open**, and authenticate if asked.

The updater may need the same per-file approval. Check the exact name if another component is blocked. If the warning says software will damage your computer, is damaged, or no exception is available, stop and report the message. Do not disable Gatekeeper globally or remove quarantine from your whole Downloads folder.

Apple's reference: https://support.apple.com/en-us/102445. A signed and notarized package is not yet available.

## Which workbook am I editing?

Import creates two copies inside your project:

| Copy | Purpose |
| --- | --- |
| Original | Unchanged snapshot of the workbook you imported |
| Budget | Working workbook: edit budget figures here; the app writes its cashflow here |

The original file you selected outside the app is also left unchanged. Editing that external file later does **not** update the working copy automatically.

New projects start with untimed costs. Existing manual financing is retained, but existing cashflow cost entries are not imported as timing rules. Saving the new plan replaces cost allocations in the working cashflow sheet. The Original copy keeps the imported workbook as it was.

Keep the working Excel files closed when saving through the app or refreshing the budget. Save and close Excel first, then reopen it to see the updated cashflow.

## Periods and milestones

A **period** has a start and an end: Preparation, Shooting or Postproduction, for example. A **milestone** is a single payment point, such as picture lock or a director's installment.

Open **Dates and periods** or **Open month planner**. A period's bar shows its span; a diamond marks a milestone. Give extra periods and milestones names that you will recognise when assigning costs. Editing, picture and sound can have separate milestones.

### Start with months

Enter **08/2027** for August 2027. The app also accepts **08/27** and **2027-08**. Including the four-digit year makes an accidental wrong year easier to spot.

| Entry | How the app uses it |
| --- | --- |
| Period: 06/2027 to 08/2027 | 1 June to 31 August, inclusive |
| Milestone: 08/2027 | Payment at month end: 31 August |
| Exact date: 15/08/2027 | That exact day |

Use **Use exact dates** when you know the actual boundaries. Existing exact dates stay exact. **Use whole months** deliberately expands a period to the first and last day of its selected months.

Month-only dates are planning assumptions. Review them before using the report to prepare agreements.

### Paste several dates at once

Open **Paste a timetable**. Paste semicolon-separated lines, or columns copied from Excel:

```text
Preparation; 06/2027; 08/2027
Shooting; 09/2027; 10/2027
Postproduction; 11/2027; 02/2028
Picture lock; 01/2028;
Sound delivery; milestone; 15/02/2028;
```

The format is **Name; Start; End**, or **Name; period/milestone; Start; End**. A new entry without an end becomes a milestone. Matching names update existing entries and retain their links. Entries missing from the pasted list stay unchanged.

Review the proposed changes, choose **Apply entries to draft**, then save. Correct any invalid lines before applying.

## What follows a date change?

**The link determines what moves.** A cost assigned to Shooting follows Shooting. A payment placed directly in September stays in September.

| Timing choice | Changing a period or milestone |
| --- | --- |
| Linked whole-period allocation | Follows the period's dates; its monthly amounts can change |
| Linked first or last part of a period | Recalculates from the relevant boundary and work length |
| Percentage paid at a period's start or end | Follows that boundary |
| Installment linked to a milestone | Follows the milestone; the cost keeps its own percentage |
| Fixed payment months or exact payment dates | Stays on those chosen months or dates |
| Historical | Stays in the Historical total |

Existing payment delays still apply. Explicitly entered work dates stay fixed too: choosing exact work dates removes the inference from the period boundaries for that part.

After editing shared dates, review the effect and use **Save dates and update cashflow**. Check for payments now outside the displayed cashflow range.

Moving or extending Shooting does **not** automatically change the shared paid shooting-day total. Calendar dates and paid-day counts are separate inputs; review both when the production plan changes.

## Days: budget quantity and paid shooting days

For a cost budgeted in days, a work split divides that cost's own day quantity. It does not change the source budget amount.

In a **Days / months** split, each part can use:

- **Enter quantity**: a fixed number of days for this part.
- **From production timetable**: the shared paid-day count for the chosen period.
- **Remaining budget quantity**: the cost's days left after the other parts.

Choose exactly **one** remaining-quantity part. Zero means no work in that part. Day and month inputs are separate, including when assigning the same plan to a mixed selection.

### Example: preparation, shooting and wrap

The cost has **34 budget days** and a total of **€8,160**. Shooting has **24 paid days**. Put preparation at the end of Preparation and wrap at the start of Postproduction.

| Part | Before | After changing wrap |
| --- | --- | --- |
| Preparation: remaining quantity | 8 days · €1,920 | 6 days · €1,440 |
| Shooting: from timetable | 24 days · €5,760 | 24 days · €5,760 |
| Wrap: entered quantity | 2 days · €480 | 4 days · €960 |
| Total | 34 days · €8,160 | 34 days · €8,160 |

The preparation start moves later; the wrap end moves later. With Preparation ending 31 August 2027 and Postproduction starting 1 November, the weekday estimate moves the preparation start from 20 to 24 August and the wrap end from 2 to 4 November.

These dates depend on the chosen placement. **Within the whole period** spreads work across the period; it does not identify every individual working day.

### Paid days by month

Enter **Paid shooting days** on the Shooting card. Optional monthly paid-day totals describe how those days fall across months. If both a shared total and monthly counts are entered, they must agree. Unlisted months have zero paid days when monthly counts are used.

For example, 18 paid days in September and 6 in October divide a €5,760 shooting share into **€4,320** and **€1,440** when using paid-day allocation.

Without monthly counts, the day-based planner uses a **Monday–Friday estimate**, without a public-holiday calendar. Anchored first/last work-day spans also use that weekday convention. A shared count of 24 days is not itself a list of 24 exact work dates.

If fixed parts and timetable days exceed a cost's budget days, the app asks you to adjust that cost. A bulk plan need not fit every person; review exceptions individually.

## Months: work quantity versus payment months

There are two different uses of months:

- **Budget months** describe a quantity of work or rental. A four-month budget can be divided between preparation, shooting and wrap.
- **Payment months** say when money leaves. Clicking four month buttons does not create four months of work.

### Example: four budget months

An office costs **€2,000 for four months**. Shooting covers September and October, so **From production timetable** uses two calendar months.

| Part | With half a month of wrap | With one month of wrap |
| --- | --- | --- |
| Preparation: remaining quantity | 1.5 months · €750 | 1 month · €500 |
| Shooting: from timetable | 2 months · €1,000 | 2 months · €1,000 |
| Wrap: entered quantity | 0.5 month · €250 | 1 month · €500 |

The total stays four months and €2,000. Placement at the end of preparation or start of postproduction changes the inferred work boundaries.

Timetable months use **calendar-month shares**. A full month counts as one; a partial month counts as covered days divided by days in that month. For example, 15–31 July contributes 17/31 of a month. Days are not converted into months using a five-day week.

For an anchored fractional work length, the date estimate uses whole calendar months plus the fraction multiplied by **30 days**, rounded to a whole day. Thus a half-month extension is estimated as 15 days. The preview shows the resulting dates and assumptions.

### Equal or proportional payments?

| Method | Result |
| --- | --- |
| Selected payment months, equal split | Each chosen month receives the same share |
| Selected payment months, percentages | Each month receives your chosen share of the cost |
| During-period percentage/euro allocation | Monthly payments follow the calendar days covered |
| Monthly work allocation | Monthly payments follow calendar-month shares |
| Paid-day allocation | Monthly payments follow the entered paid-day counts |

Equal monthly payments can give a short boundary month the same amount as a whole month. Proportional methods account for the covered part. Review the euro result rather than assuming that every “monthly” option behaves alike. Rounding is handled so allocated payments add up to the allocated total.

## Fast planning and bulk changes

For a first draft, tick several costs or a section and choose **Months / Historical**, **Production periods**, **Installments** or **Saved patterns**. Each cost keeps its own budget. Review the selection and amounts before assigning.

On the cost timeline:

- Click **+** to include a payment month. Additional months start with equal shares.
- Shift-click another month to include a range.
- Click an amount, right-click a cell or use **⋯** for shares, removal and other timing choices.
- With several costs selected, clicking a month in one selected row edits that selection. Clicking an unselected row affects that row only. Check the scope shown in the editor.
- Use **Apply share** after typing a percentage. Then review and save.

Replacing period-linked timing with fixed months opens a review. Once replaced, those months no longer follow production-date changes.

Saved patterns are reusable starting points. Assigning creates independent timing for the selected costs. Matching labels do not link costs together. Shared periods and milestone dates still remain linked. Adjusting one cost does not silently change every cost with the same pattern name.

Assign creates an unsaved draft. **Undo** restores the preceding draft step. **Save changes** commits to the workbooks. If some costs need fixing, use the review controls or save the ready costs when that option is offered.

To leave a cost unplanned, use **⋯ → Clear all payment timing**, then Save. This keeps the cost and returns its budget to **Still needs timing**.

## Historical payments

Historical is one total for money already paid before the forecast. It does not require individual payment dates.

Choose **Historical** beside the payment-month buttons. Historical alone places the whole cost there. Historical plus future months can split a cost, for example **30% Historical and 70% in August**.

The optional label **03/23-02/25** means March 2023 through February 2025. It is just a column label: it does not spread payments across those months or automatically classify any cost as Historical. Future early-development payments belong in their planned month, not Historical.

## Installments

1. In **Dates and periods**, use **Add an installment row** and name the agreement, such as “Director's installments”.
2. Click **+** in the payment months. Numbered diamonds appear. Month-only installments use month end.
3. Click a diamond to enter an exact date or choose **Move on timeline** and click its new month. Its number and existing links stay attached.
4. Choose **Use for costs →**, select the cost or costs, and choose **Set percentages** under Installments.
5. Enter shares, for example 30%, 40% and 30%. Review, Assign and Save.

The dates are shared, while each cost has its own shares and budget. Adding another diamond later does not insert a new payment into existing cost arrangements; review and reassign when you want the new split. A milestone already used by a cost or saved pattern must be unlinked before removal.

## If the budget changes

**Keep the existing project and use Refresh budget. Do not start a new project just to update figures.**

1. Save or discard pending payment and date edits in the app. A refresh is blocked while drafts are pending so they are not overwritten.
2. Choose **Open cashflow workbook**. This opens the project's **Budget** working copy.
3. Edit the budget figures in that workbook. Let Excel recalculate, then save and close it. If your revised figures are in a separate workbook, transfer the relevant budget changes into this working copy in Excel, preserving the supported worksheet layout and formulas. Keep a project backup before substantial structural edits.
4. Click the app's **Refresh budget** button. Reloading the browser page is not a budget refresh.
5. Review the changed costs, any grouping or matching preview, and the new totals. Apply the reviewed refresh when prompted. Check **Still needs timing** and flagged arrangements before saving further timing edits.

### What is retained?

| Change in the budget | What to expect after refresh |
| --- | --- |
| Matched cost, amount changed | Saved timing is retained; percentage-based euros recalculate |
| Fixed euro installments | Euro entries stay fixed; a remainder can absorb the difference, otherwise review is needed |
| Day or month quantity changed | Quantity-based splits recalculate; fixed parts may no longer fit |
| Newly added cost | Needs timing unless an applicable source phase mapping supplies it |
| Removed cost | Retained as a removed record for review; no longer counted as an active cost |
| Moved rows or changed description | Matching may retain the timing and flag it for review |
| Ambiguous match or substantially renamed cost | May appear as a new cost and require identity/timing review |

For example, a €10,000 cost paid 30% and 70% becomes €3,600 and €8,400 when its budget rises to €12,000. Two fixed euro payments of €3,000 and €7,000 remain those amounts; the extra €2,000 needs an allocation unless one part is a remainder.

Refresh preserves matched timing; it cannot safely guess every identity after a budget has been reorganised. Inspect the review instead of assuming that every row will match automatically. Source totals must still reconcile.

The unchanged **Original** snapshot is not updated by refresh. The working copy and the saved plan are the continuing project.

## Cashflow range and totals

**Cashflow range** changes the first displayed month in both the app and working Excel sheet. Enter a month, choose **Preview range**, then **Apply cashflow range**.

Changing this range does not move work or payments; it changes which months are displayed. Manual financing remains in its calendar months. A range that would omit a financing payment is refused. If opening cash is present, confirm that its balance is appropriate for the new first month.

The supported FFF template has 17 display columns: normally 17 months, or Historical plus 16 months when Historical is used. **Scheduled outside the Excel display** identifies payments beyond that range. Check the year and the range if the Excel total seems too low.

Zero cashflow amounts are light grey so nonzero values are easier to read. Existing working files receive this formatting on the next app Save or Refresh after updating.

## Reports for preparing agreements

Save the plan, then open **Reports**. The report reads saved data; pending edits are not included.

- **Summary**: costs, budget quantities/rates, payment counts and unplanned amounts.
- **Work periods**: recorded starts and ends, with the basis of each date.
- **Payments**: payment dates, named installments and amounts, including payments outside the displayed cashflow range.

**Download Excel report** exports all costs into three filterable sheets. The on-screen search does not limit the export.

Use the report as a starting point. It distinguishes exact work dates, month estimates and production-wide spans. Payment months do not imply work dates, and Historical has no invented payment date. Budget totals may include holiday pay and employer costs; check the budget details before treating a total as an agreed fee.

## Updating the app and backing up projects

Updating the app and refreshing the budget are different operations:

- **Update existing Cashflow Builder.command** installs newer app code and instructions.
- **Refresh budget** rereads the budget figures inside your existing project.

### Install a new app release

1. Save your work. Stop the app from **Projects → Stop app**.
2. Unzip the new release into a separate folder. Do not replace the existing folder in Finder.
3. Run **Update existing Cashflow Builder.command** from the new download. Select the existing folder containing your app and Projects.
4. The updater backs up the previous application code in **App backups** and installs the new version. It leaves Projects, workbooks, saved timing and the installed runtime in place.
5. Launch **Start Cashflow Builder.command** from that existing folder. Open projects through Projects rather than an old browser tab.

If the updater finds the app running, use **Open existing app**, save all project tabs, then choose **I saved — update**. It requests a normal shutdown. If it cannot reach the app, stop it from Projects or close its Terminal window after saving, then Retry.

If the project list is unexpectedly empty after an update, check the **Stored on this Mac** path on the start page. You may have launched the fresh download rather than the existing installation. Stop that copy and launch from the folder containing your Projects. There is no need to import the budgets again.

### Back up the complete project

Stop the app and copy the whole **Projects** folder to your backup location. It contains the original and working budgets, extracted lists, shared dates and timing patterns. Copying only the Excel cashflow does not back up all planning information.

Automatic pre-write workbook backups live inside each project's **work/backups**. App backups contain application code, not project data. Keep your own full-project backups too.

To restore a full backup, stop the app, retain a copy of the current Projects folder, then restore the backed-up Projects folder as a unit. Avoid mixing individual saved-plan files from different dates. Start the app and verify the project before continuing.

Unsaved browser drafts are not a reliable backup. Save before stopping or closing the browser.

## Common questions

### Why can I not save?

Read the issue beside the affected cost. A quantity split needs one remainder part; percentages must account for the full cost unless a remainder supplies the balance. Fixed parts must fit the budget quantity. Correct the issue, or explicitly clear the cost's timing to leave it unplanned. A saved pattern name alone does not supply missing quantities.

### Why did changing Shooting not move this payment?

Check its timing label. Fixed payment months stay fixed. Use a production-period or milestone-linked arrangement if the payment should follow shared dates.

### Why did Refresh budget do nothing?

Use the app's Refresh button, not browser reload. Save or discard drafts first. Edit the project's Budget working copy, save and close Excel, then refresh. Editing the external original file alone has no effect.

### Why are day allocations different from my shooting schedule?

Check the shared paid-day total and the monthly paid-day counts. Without monthly counts, the app uses weekday estimates, not your call sheets or a public-holiday calendar.

### What if the app cannot recognise my budget?

Check the worksheet and column mapping and whether Excel saved calculated formula values. The supported cashflow layout uses rows 21–40 for costs, row 41 for the total, row 42 for the balance, columns E–U for the display and V for the total. Modified layouts may require support. Share a fictional example or a minimal description when reporting a problem, rather than a confidential workbook.
