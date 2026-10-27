# SessionExchange

A student session exchange with PGID entry, a public swap board, and private request history. Students can exchange **different company events** or different sections of one event. The first prototype uses **self-reported assignments**: students enter their name and PGID, then choose the event they were assigned.

## Deploy on Netlify

Upload the flat-root release contents into your existing GitHub repository and follow [`START_HERE.md`](START_HERE.md). The supplied netlify.toml sets base directory `.`, build command `npm run build`, publish directory `public`, and functions directory `netlify/functions`. The JavaScript API and persistent shared state run on Netlify. No Python host is needed.

## Upload Excel to GitHub (current option)

Follow [EXCEL_UPLOAD_SETUP.md](EXCEL_UPLOAD_SETUP.md). Upload the workbook as
**catalogue/sessions.xlsx** on the default branch. The **Update sessions from Excel**
workflow validates it online and sends only event details to a protected Netlify
endpoint. Set SWAP_EXCEL_UPLOAD_ENABLED=1 in Netlify and put the same private
SWAP_FLOW_TOKEN in Netlify and GitHub Actions repository secrets. Disable the
older Outlook and Power Automate import routes while using this option.

Your Company Name / Event Type / Event Date / Event Time / Venue headings work,
as do title / room / time / date and the original nine-column schema. When Subject
exists, the PGP Co 2027 pre-placement subject filter applies. This route cannot
verify the original email sender. A public repo exposes the whole workbook;
use a private repo or reduced session-only copy for private data.

This route adds/updates events and retains omitted entries, student records and
accepted history. Matching events keep existing IDs. Room corrections keep open
swaps; schedule changes to a known event close affected open posts. Read the guide
for stable IDs when rescheduling. These merge rules differ from the optional
legacy full-snapshot Excel importer described below.

## Optional older Outlook route through Power Automate and GitHub

For the older route without Power Automate Premium, follow [GITHUB_RELAY_SETUP.md](GITHUB_RELAY_SETUP.md). The Outlook trigger and Condition stay the same; GitHub's standard connector dispatches the invite to `.github/workflows/outlook-relay.yml`, and the relay delivers it to Netlify. Store the same SWAP_FLOW_TOKEN value as a GitHub Actions repository secret. The workflow never commits mail or prints raw email contents. A manual workflow run performs a read-only connection check.

## Optional direct HTTP route

Follow [POWER_AUTOMATE_SETUP.md](POWER_AUTOMATE_SETUP.md). Your normal Outlook connection sends matching new emails to a protected Netlify endpoint, without Excel, a local computer or a custom Microsoft app registration. The receiving endpoint is `/api/integrations/outlook`. It uses a separate ingest-only SWAP_FLOW_TOKEN; the private `/outlook-admin.html` dashboard uses SWAP_ADMIN_TOKEN.

Only casevents@isb.edu emails whose subject contains `Upcoming Event | PGP Co 2027 | Pre Placement Talk :` are imported. The app saves title, room, date and start/end time, appends new events, and retains existing sessions and accepted history. Cancellations and unclear corrections enter review. Your Power Automate license and organization must allow the Outlook and HTTP actions.

The earlier application-credential scheduled importer is still optional; its separate guide is [CLOUD_OUTLOOK_SETUP.md](CLOUD_OUTLOOK_SETUP.md). It is inactive when Power Automate is enabled.

## Try the prototype

Requires Python 3.11 or later. Open a terminal in this project folder:

```sh
python3 -m session_swap serve --demo
```

Open **http://127.0.0.1:8000**. Enter a name and PGID **26001** to browse five sample requests. PGIDs 26002–26006 represent other fictional students. A new PGID registers using the name you enter. Sample dates are generated relative to the first run. Demo data stays in `data/swaps.sqlite3`; use a different `--db` path to start another demo.

The demo itself needs no third-party packages. For Excel import and deployment, install the dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows, use `py` instead of `python3` and `.venv\Scripts\activate` to activate the environment.

## Student journey

1. Enter your **name and PGID**, then choose **Post a swap request** or **Browse available swaps**.
2. To post, select the event you have been assigned. Request a particular other event, or choose **Any other event**. You can add a short note.
3. The dashboard shows both event names, dates, times and venues. Search and filter by offered event or date, or show flexible requests.
4. Open a card to see the poster's name and PGID. For a flexible request, select the event you will give. For a specific request, the requested event is fixed.
5. Review both sides and **Confirm swap**. Only the first successful acceptance wins. The accepted request immediately leaves the dashboard; other connected browsers refresh every 15 seconds.
6. Both students see the accepted swap and each other's **name and PGID** under **My requests**. The page has role and status filters. Open posts can be cancelled by their author.

Accepting also updates each student's declared sessions and cancels open posts for the events just exchanged. Historical accepted records preserve the names and schedule details as they were at acceptance. Past events expire automatically.

**Prototype limits:** PGID-only entry does not prove identity. Anyone knowing a PGID can view and act as that student. Assignments are declared by students, not institution-verified. The app records a peer agreement; it does not update an official registration system. Use synthetic data until you decide how real students will be authenticated and how swaps are approved.

## Optional legacy Excel schedule

Use a sheet named `Sessions` with four columns:

| Column | Example |
| --- | --- |
| `title` | Nagarro · Pre Placement Talk |
| `room` | LT 3 (or TBD) |
| `time` | 21:30 - 22:30 |
| `date` | 2026-10-27 (or an Excel date) |

Use same-day 24-hour start and end times. The importer generates internal IDs from title, date and start time, supplies Main as the internal section, and leaves instructor blank. Room and end-time edits preserve IDs; changing title, date or start time creates a new event. Identical title/date/start combinations must not be duplicated.

The original nine-column format in `examples/session-swap-template.xlsx` remains supported. Keep that format for an existing live catalogue if you need to preserve its original event IDs. Switching to generated IDs deactivates the old entries and can cancel their open requests; accepted history is retained.

All times use `SWAP_TIMEZONE`, default **Asia/Kolkata**. Student names and PGIDs are collected in the app; no roster sheet is required.

Import into a separate database from the demo:

```sh
python -m session_swap --db data/live.sqlite3 import /full/path/sessions.xlsx --dry-run
python -m session_swap --db data/live.sqlite3 import /full/path/sessions.xlsx
python -m session_swap --db data/live.sqlite3 serve --pgid-only
```

Imports are **complete catalogue snapshots**, not row-by-row additions. Omitted events are deactivated and affected open requests are cancelled. Invalid files roll back entirely. Accepted swap history and student accounts remain. Reimporting the same schedule preserves declared swaps. Avoid mixing demo and real data. Formula cells are rejected; store imported values directly.

## Outlook → Excel → app

The included parser understands the labelled invite format supplied for this project: Company Name, Industry, Event Type, Event Date, Event Time, Mode, Venue and Presenter's Designation. It reads saved `.eml`, UTF-8 text or HTML email bodies. It does not read screenshot images or sign into Outlook.

Save the email as `.eml`, or save its body as UTF-8 text, then preview:

```sh
python -m session_swap parse-invite /full/path/invite.eml
```

Check the company, date, times, timezone and section. To add or update that reviewed event in a workbook:

```sh
python -m session_swap parse-invite /full/path/invite.eml --section Main --workbook /full/path/sessions.xlsx --apply
```

Reprocessing the same event and section updates its existing row. Missing or malformed essential fields fail instead of inventing values. Unknown venues remain `TBD`. This parser expects same-day 24-hour times. A date change creates a distinct event ID; remove the superseded row from Excel after reviewing a reschedule. Cancellation emails and `.ics` attachments need separate handling.

**Live mailbox automation is not configured.** The project now includes `outlook-import`, which accepts messages retrieved by a connected Outlook scheduler, avoids duplicate messages, preserves source details, updates venues and times, and sends malformed or changed/cancelled invites to a review queue. See [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md) for configuration and the message format. Reading Outlook still needs a connected mailbox and an enabled schedule. The code does not store mailbox credentials or pretend that new mail is being monitored.

### Periodically send local Excel changes to a hosted app

A hosted app cannot directly read a file on your laptop. Run the sync process on the computer that holds the workbook. Set the same random `SWAP_ADMIN_TOKEN` (at least 32 characters) on both the server and that computer, using environment settings rather than committing it.

```sh
python -m session_swap sync /full/path/sessions.xlsx --url https://your-app.example --watch --interval 300
```

The watcher checks every five minutes, validates changed workbooks, and sends the full catalogue over HTTPS. It retries failed changes on the next interval, keeping the last successful server data. It must remain running, with the PC awake and online. `--watch` can be omitted for a single sync. Credentials are not passed through redirects. Real workbook data and runtime databases are ignored by Git.

## Alternative: hosting the Python server

The original Python backend uses SQLite storage and the same plain HTML/CSS/JavaScript interface. It can still run on a Python or Docker host with persistent disk storage. **GitHub stores the source; GitHub Pages cannot run either backend.** For Netlify, use the JavaScript Functions implementation documented above.

For a PGID-only staging prototype, set `SWAP_PGID_ONLY=1`; for password entry, leave it `0`. Set `SWAP_SECURE_COOKIE=1` behind HTTPS and `SWAP_DB` to a persistent disk path. Keep `SWAP_DEMO=0` outside local sample demos. Initialise the database, import a workbook, and run:

```sh
python -m session_swap init
gunicorn --bind 0.0.0.0:8000 --workers 2 --threads 4 session_swap.web:application
```

The Dockerfile provides the same server. Mount `/app/data` to a persistent volume; without it, replacing the container loses records. Back up SQLite using SQLite's backup mechanism, including a restore check. Run on one host with a local persistent disk; multiple independent servers must not use separate copies of this database. Use a managed relational database before scaling beyond this setup.

For optional password mode, provision a student account through a `Students` sheet (`pgid`, `name`) with your catalogue, then run `python -m session_swap set-password PGID`. Passwords are entered privately, hashed, and not written into Excel. Password reset is coordinator-operated; self-service reset and college SSO are not included.

## Tests

```sh
python -m unittest discover -s tests -v
```

Tests cover cross-event exchanges, flexible selections, first-time PGID entry, competing acceptance, private history, cancellation, expiry, import rollback, sync preservation, cookies, request-origin checks, sync-token protection, optional passwords and the invite parser. GitHub Actions runs the suite on pushes and pull requests.

## Repository contents

`netlify/` contains the hosted backend. `scripts/build.mjs` prepares the frontend. `session_swap/` contains the shared interface, original Python server and local Excel/Outlook tools. `tests/` contains the automated checks. `examples/` contains the workbook template. `.env.example` documents configuration; the Python app does not auto-load that file. The Netlify build requires Node dependencies; the alternative local Python demo does not.
