# SessionExchange: upload Excel to GitHub

Follow **EXCEL_UPLOAD_SETUP.md** for the full steps.

1. Upload this release's extracted contents to your existing repository root.
   Include **.github/workflows/excel-upload.yml**; on Mac use Command + Shift + .
   to show hidden files. Keep netlify.toml at the root with base directory `.`.
2. In Netlify Production/Functions settings, set SWAP_EXCEL_UPLOAD_ENABLED=1,
   SWAP_SEED_DEMO=0, SWAP_OUTLOOK_ENABLED=0 and SWAP_POWER_AUTOMATE_ENABLED=0.
   Keep SWAP_FLOW_TOKEN as a private password of at least 32 characters.
   Redeploy once and wait for Published.
3. In GitHub Settings → Secrets and variables → Actions → Repository secrets,
   create/update SWAP_FLOW_TOKEN with the same password VALUE as Netlify.
4. Upload the workbook as **catalogue/sessions.xlsx** on the default branch.
5. Check Actions → **Update sessions from Excel** for a green run. Refresh the app.
6. Repeat step 4 whenever you want to publish workbook changes.

Your current Company Name / Event Type / Event Date / Event Time / Venue columns
work. A four-column title / room / time / date copy also works. A public repository
exposes the entire workbook; use a private repo or reduced copy for private data.

New events are added and existing ones updated. Omitted sessions, student records
and accepted swaps remain. Read the guide before rescheduling events. No Microsoft
app, Power Automate action or running local computer is needed. This does not
watch OneDrive: upload a copy to publish changes. Older integration guides are
optional alternatives, not setup steps for this release.
