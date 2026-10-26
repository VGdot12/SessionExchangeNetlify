# SessionExchange

A student session exchange with PGID entry, a public swap board, and private request history. Students can exchange **different company events** or different sections of one event. The first prototype uses **self-reported assignments**: students enter their name and PGID, then choose the event they were assigned.

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
3. The dashboard shows both events, sections, dates, times and venues. Search and filter by offered event or date, or show flexible requests.
4. Open a card to see the poster's name and PGID. For a flexible request, select the event you will give. For a specific request, the requested event is fixed.
5. Review both sides and **Confirm swap**. Only the first successful acceptance wins. The accepted request immediately leaves the dashboard; other connected browsers refresh every 15 seconds.
6. Both students see the accepted swap and each other's **name and PGID** under **My requests**. The page has role and status filters. Open posts can be cancelled by their author.

Accepting also updates each student's declared sessions and cancels open posts for the events just exchanged. Historical accepted records preserve the names and schedule details as they were at acceptance. Past events expire automatically.

**Prototype limits:** PGID-only entry does not prove identity. Anyone knowing a PGID can view and act as that student. Assignments are declared by students, not institution-verified. The app records a peer agreement; it does not update an official registration system. Use synthetic data until you decide how real students will be authenticated and how swaps are approved.

## Excel schedule

Use [`examples/session-swap-template.xlsx`](examples/session-swap-template.xlsx), containing one `Sessions` sheet with fictional data. Replace those rows with your actual catalogue. Keep the header row:

| Column | Meaning |
| --- | --- |
| `session_id` | Stable unique ID for this event/section. Never recycle IDs for another event. |
| `course_id` | Event grouping ID. Sections of the same occurrence share this value. Different company events have different values. |
| `title` | Company and event name, e.g. `Nagarro · Pre Placement Talk`. |
| `section` | Section label, or `Main` for an event without sections. |
| `date` | Excel date or `YYYY-MM-DD`. |
| `start_time`, `end_time` | Excel times or 24-hour `HH:MM`, on the same day. |
| `room` | Venue; use `TBD` if unknown. Column required, value may be blank. |
| `instructor` | Presenter or designation. Column required, value may be blank. |

All times use `SWAP_TIMEZONE`, default **Asia/Kolkata**. One event group cannot repeat a section label. Each section of a group must have the same title. Student names and PGIDs are collected in the app, so no roster sheet is required. Optional `Students` and `Assignments` sheets are accepted for initial sample provisioning; they are not used to verify declarations.

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

**Live mailbox automation is not configured.** The next integration needs an Outlook connection, the folder/sender rule, a destination workbook location, and handling for changed/cancelled invites. See [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md) for the proposed flow and the fields from the example invite. This repository includes the email-to-workbook command and the workbook-to-server watcher; it does not claim that new mail is already being monitored.

### Periodically send local Excel changes to a hosted app

A hosted app cannot directly read a file on your laptop. Run the sync process on the computer that holds the workbook. Set the same random `SWAP_ADMIN_TOKEN` (at least 32 characters) on both the server and that computer, using environment settings rather than committing it.

```sh
python -m session_swap sync /full/path/sessions.xlsx --url https://your-app.example --watch --interval 300
```

The watcher checks every five minutes, validates changed workbooks, and sends the full catalogue over HTTPS. It retries failed changes on the next interval, keeping the last successful server data. It must remain running, with the PC awake and online. `--watch` can be omitted for a single sync. Credentials are not passed through redirects. Real workbook data and runtime databases are ignored by Git.

## Hosting

This is a Python application with SQLite storage and plain HTML/CSS/JavaScript. **GitHub stores the source; GitHub Pages cannot run this backend.** Deploy on a Python or Docker host with persistent disk storage.

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

`session_swap/` contains the backend and interface. `tests/` contains the automated checks. `examples/` contains the workbook template. `.env.example` documents configuration; settings must be provided through the environment, as this app does not auto-load that file. No paid services, API keys or Node build tools are needed for the prototype.
