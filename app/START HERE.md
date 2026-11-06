# Cashflow Builder 0.1.0

Import an existing FFF budget and export an FFF cashflow.

## Start

1. Keep the whole Cashflow Builder folder together in a writable location on your Apple silicon Mac.
2. Double-click **Start Cashflow Builder.command**. Leave its Terminal window open.
3. Try the fictional example or import your saved, closed Excel budget.
4. Set production periods, select costs, assign timing and **Save changes**.
5. Use **Open cashflow workbook** to open the working budget and its cashflow sheet.

## If macOS blocks the launcher

This release is unsigned and not notarized. If you downloaded it from the Cashflow Builder GitHub release and choose to trust it, click **Done** on the “Not Opened” warning. Open **System Settings → Privacy & Security**, scroll to **Security**, and choose **Open Anyway** for **Start Cashflow Builder.command**. Confirm **Open** and authenticate if asked. The updater may need its own approval.

If the warning instead says software will damage your computer or is damaged, stop and report the exact message. Do not disable Gatekeeper globally. Apple's instructions: https://support.apple.com/en-us/102445.

## Instructions

Open **help.html** in this folder, or click **Help** in the app. It covers:

- Periods, milestones and month-first planning.
- How work dates differ from payment dates.
- Paid days, budget months and the remaining quantity.
- What follows a production-date change.
- Bulk planning, installments and Historical.
- Updating budget figures without starting again.
- Reports, backups and updating the app.

## Existing users: update the app

Unzip this download separately. Save your existing work, then run **Update existing Cashflow Builder.command** from this new folder and choose your existing app folder. Launch from the existing folder afterwards, where your Projects remain. Do not replace that whole folder in Finder.

## Existing project: update the budget

Save pending app edits. Open the project's working budget through **Open cashflow workbook**, update figures in Excel, save and close it, then use the app's **Refresh budget**. Review changed costs. Editing the original file outside the project does not update the working copy automatically.

## Keep your work

Save before closing the browser. Use **Projects → Stop app** when finished. Back up the whole **Projects** folder while the app is stopped, not only the cashflow workbook.

This package includes its runtime. It is for Apple silicon Macs and is not signed or notarized. Old .xls files must be converted in Excel before import. No programming environment is required.
