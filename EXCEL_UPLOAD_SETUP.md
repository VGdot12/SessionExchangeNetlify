# Upload Excel to GitHub → update Netlify

Upload a copy of your workbook as **catalogue/sessions.xlsx**. GitHub Actions
reads it online and updates the catalogue at https://sessionexchange.netlify.app.
No Microsoft app registration, Power Automate action or running local computer
is needed. This does not watch OneDrive: upload a fresh copy to publish changes.

## 1. Upload the new code once

1. Extract **SessionExchange-Excel-Upload.zip**.
2. Open https://github.com/VGdot12/SessionExchange on your default branch (usually main).
3. Choose **Add file → Upload files** and upload the extracted contents into the
   repository root, replacing existing files. Commit the changes.
4. Do not upload the ZIP itself or put everything inside an extra folder.
5. Confirm **netlify.toml**, **package.json**, **netlify**, **scripts**,
   **session_swap**, **catalogue** and **.github** are at the repository root.
6. Confirm **.github/workflows/excel-upload.yml** exists. It is essential.

On Mac, press **Command + Shift + .** in Finder to reveal the hidden .github
folder. If GitHub omits it, choose **Add file → Create new file**, enter
**.github/workflows/excel-upload.yml** as the filename, paste the supplied
**Excel-upload-workflow.yml** contents, and commit. Putting YAML at the root
will not create a workflow.

## 2. Configure Netlify once

Site → **Project configuration → Environment variables**. Set these for
**Production**, with scope including **Functions** (or all scopes):

| Key | Value |
| --- | --- |
| SWAP_EXCEL_UPLOAD_ENABLED | `1` |
| SWAP_FLOW_TOKEN | Keep your existing private password of at least 32 characters |
| SWAP_SEED_DEMO | `0` |
| SWAP_POWER_AUTOMATE_ENABLED | `0` |
| SWAP_OUTLOOK_ENABLED | `0` |

If SWAP_FLOW_TOKEN is missing, create a random password of at least 32 characters
using a password manager. It is a shared delivery password, not a Netlify or
GitHub access token. Keep it private and out of code, workbooks and screenshots.
Do not use the example text above as its value.

Save. Open **Deploys → Trigger deploy → Deploy site** (or the equivalent redeploy
option) and wait for **Published**. Function environment changes need a new deploy:
[Netlify guidance](https://docs.netlify.com/build/functions/environment-variables/).

Keep base directory **.**, build command **npm run build**, publish directory
**public**, functions directory **netlify/functions**. Do not set base to
SessionExchange; that caused your earlier error.

An initial workflow run may fail before setup is complete. Run it again after step 3.

## 3. Add the same password in GitHub

Repository → **Settings → Secrets and variables → Actions** → under
**Repository secrets**, choose **New repository secret**.

- Name: **SWAP_FLOW_TOKEN**
- Secret: exactly the same password VALUE as in Netlify.

Click **Add secret**, or update the existing secret. Use Secrets, not Variables.
No additional GitHub access token is needed.
[GitHub instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 4. Upload your Excel workbook

Your headings are supported: Subject, Company Name, Industry, CBD Name, Event Type,
Event Date, Event Time, Duration, Mode, Venue, Received On.

| Excel | Website |
| --- | --- |
| Company Name + Event Type | Title, e.g. Nagarro · Pre Placement Talk |
| Venue | Room |
| Event Date | Date |
| Event Time | Start and end time |

Only these event details and internal identifiers reach Netlify. Industry, CBD
Name, Duration, Mode and Received On are not sent. Trailing spaces and non-breaking
spaces in headings work.

If Subject exists, only rows matching **Upcoming Event | PGP Co 2027 | Pre Placement
Talk :** are imported; spacing may vary. Other subjects are ignored. A workbook
with no matching sessions fails validation and leaves the live catalogue unchanged.

There is no sender column, so this route cannot verify the original email came
from casevents@isb.edu. Keep that filter in the process that fills your workbook,
or upload only the intended events.

A reduced **title, room, time, date** workbook also works, as does the original
nine-column session format for retaining existing internal IDs.

- Prefer a sheet named **Sessions**, with headings in row 1. Another name works
  when exactly one sheet has supported columns.
- Dates: Excel dates, **2026-10-27**, **27 October, 2026**, or **27/10/2026**.
  Numeric dates use day/month/year.
- Times: same-day 24-hour ranges such as **21:30 - 22:30**.
- Use values, not formulas, in imported fields.
- Keep one current row per event. Identical duplicates are collapsed; conflicting
  duplicates fail rather than guessing which is current.
- Limits: 10 MB file, 30 MB uncompressed, 20,000 data rows, 50 columns.

**Repository visibility:** a public repository exposes the entire workbook and
older versions, including unused columns. Use a private repo or a reduced
four-column copy for private data. Mapping fewer fields into Netlify does not
hide the source workbook from people with repository access.

To upload:

1. Download/save your OneDrive workbook as **sessions.xlsx**.
2. Open GitHub → repository → **Code** → **catalogue** folder.
3. Choose **Add file → Upload files**, select sessions.xlsx, then commit to the
   default branch (or merge into it).
4. Confirm the path is exactly **catalogue/sessions.xlsx**, including casing.

GitHub automatically starts **Update sessions from Excel**. You can close your
computer after committing the upload; processing happens online.

## 5. Check the result and repeat for future updates

Open **Actions → Update sessions from Excel** and wait for the latest run to turn
green. The **Update Netlify sessions** step shows added/updated/unchanged/cancelled
counts without printing row contents. Refresh your website, sign in and open the
assigned-session selector when posting. Future imported sessions appear there.

For a manual run: **Actions → Update sessions from Excel → Run workflow**, select
the default branch and run. With no workbook this only checks the connection;
with a workbook it imports the current default-branch file.

For later updates, replace **catalogue/sessions.xlsx** and commit again. No secret
changes or manual Netlify redeploy are needed each time. The workflow updates
persistent data directly. Netlify may also start its normal deployment because
of your Git connection. The workbook is not copied into public website assets.

## Existing sessions and swaps

- New events are appended; matching IDs or title + date + start time update an
  existing event, retaining IDs used by existing swaps and assignments.
- Room-only corrections retain open requests.
- Changes to a known event's title/date/start/end close related open requests so
  students can review the corrected schedule and repost. Accepted swaps retain
  their original details. Student records and declared assignments remain.
- Omitted events remain. Deleting a row does not cancel an event on the website.
  Past events naturally stop being selectable.
- Without a stable ID, changing title/date/start identifies a new event, and the
  old event remains. For deliberate reschedules, retain the original ID in an
  optional **session_id** column, or retain your original nine-column workbook.
  Do not guess an existing event's ID.
- A match to an intentionally deactivated event stops for review rather than
  silently reactivating it.
- Invalid files do not partially update anything. Repeated deliveries do not
  create duplicates. Older workflow runs cannot overwrite newer imports.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Workflow missing | Check .github/workflows/excel-upload.yml is on the default branch and Actions is enabled. |
| No run after upload | Check exact changed path catalogue/sessions.xlsx and default branch; try Run workflow. |
| HTTP 403 | Check matching SWAP_FLOW_TOKEN values, minimum 32 characters, and production deployment. |
| HTTP 404 or 503 | Publish the new Netlify code with SWAP_EXCEL_UPLOAD_ENABLED=1 in Production/Functions, then run the workflow again. |
| Workbook validation failed | Check sheet, headings, dates, time ranges, formulas and conflicting duplicates. No rows were saved. |
| HTTP 400 or 409 | Review duplicate matches, inactive events and stable IDs. Do not use guessed IDs. |
| Green run but no selectable events | Check future dates in Asia/Kolkata, subject matching and refresh the posting page. |
| older: true | A newer import already ran; use Run workflow for a fresh import of the current workbook. |

Keep the workflow file/name in place so its run-number sequence remains consistent.
After fixing an old failure, prefer **Run workflow** for a fresh run. GitHub Actions
and Netlify account usage limits still apply. If you later rename your Netlify site,
update ENDPOINT in scripts/deliver-catalogue.mjs.

This code was tested locally. Your workbook, repository secret and published
Netlify deployment must be configured before the live connection can be verified.
