# Optional local Outlook tools

For the current cloud import WITHOUT Excel, use [CLOUD_OUTLOOK_SETUP.md](CLOUD_OUTLOOK_SETUP.md). The Netlify scheduled function runs independently of these older local tools. The documentation below describes only the optional legacy Excel workflow.

## Legacy intake plan

The supplied screenshot shows an invite from `casevents@isb.edu` with a subject starting `Upcoming Event | PGP Co 2027 | Pre Placement Talk`. Its body uses labelled fields. It announces an event but does not list assigned students or PGIDs. Those details are entered by students in this prototype.

## Example mapping

| Email value | Application value |
| --- | --- |
| Company Name: Nagarro | Title starts `Nagarro` |
| Event Type: Pre Placement Talk | Title ends `Pre Placement Talk` |
| Event Date: 27 October, 2026 | `2026-10-27` |
| Event Time: 21:30 - 22:30 | Start `21:30`, end `22:30` |
| Venue: TBD | Venue `TBD`, retained as unknown |
| Presenter's Designation: Director | Presenter description `Director` |
| Industry: Technology; Mode: Offline | Preserved in the parser's review output |

`Main` is the default section label for a single event, not a section inferred from the email. Choose the actual section when an invite describes one. The redacted names and profile URL in the screenshot are not needed and are not stored.

## What already runs

1. `parse-invite` extracts a saved `.eml` or body text into a JSON preview.
2. `parse-invite --workbook PATH --apply` writes a reviewed event into the workbook. It updates by stable event ID and saves atomically.
3. `sync --watch` periodically sends Excel changes to the application.
4. `outlook-import` applies batches retrieved by a connected Outlook scheduler, saves source fields, deduplicates messages, prevents older data overwriting newer data, and records review items.

## Importing retrieved Outlook messages

The proposed schedule is hourly, using mail from `casevents@isb.edu`. A destination catalogue has been prepared separately with the Nagarro event transcribed from the supplied screenshot. It has a `Sessions` sheet and additional provenance columns. This schedule has not been saved or activated: the app's automation-creation request was declined, and Outlook Email is not connected. Running the command below does not sign in to Outlook or install a schedule.

After retrieving the actual email through an authenticated Outlook integration, pass a JSON list in this format. Use the real message ID and received timestamp, rather than these illustrative values:

```json
[
  {
    "id": "actual-message-id-from-Outlook",
    "sender": "casevents@isb.edu",
    "subject": "Upcoming Event | PGP Co 2027 | Pre Placement Talk",
    "received_at": "2026-10-26T10:49:00Z",
    "body": "The actual plain-text or HTML email body"
  }
]
```

Preview the batch without changing the workbook:

```sh
python -m session_swap outlook-import /path/messages.json --workbook /path/SessionCatalogue.xlsx --state /path/private-runtime/outlook-state.json
```

Add `--apply` to save valid events and checkpoint the imported message IDs. Keep runtime state and message batches outside Git. The importer writes a separate `reviews` list in the state file for ambiguous changes and cancellations, and returns only new review items in its report. Repeated processing does not add duplicate rows. A lock prevents concurrent runs of this import command on the same workbook. Keep the workbook closed while scheduled updates run to avoid conflicting unsaved Excel edits.

The schedule should retrieve every page of matching results and only advance its scan timestamp after complete, successful imports. Search the last 30 days initially; on later runs, overlap the previous complete scan by a day. Do not mark messages read, move them, or send replies. No new messages means no notification. Notify only for actual changes, new review items, failures, or required user action.

Session times are interpreted in Asia/Kolkata. The `Main` section label is appropriate only for a single event without section details; emails mentioning sections require review. Revisions, date changes, cancellations and unreadable fields need review before changing or removing existing sessions. The importer does not guess what cancelled or rescheduled events replace.

## What still needs an Outlook connection

Choose a mailbox and an intake folder. Confirm whether only `casevents@isb.edu` should be included and how revised or cancelled invites are marked. Then connect Outlook through an approved Microsoft integration, using the least permissions needed to read those messages.

The proposed mailbox step should deliver a saved email/body into the intake process, track processed message IDs, and send unreadable messages to a review queue. Extracted fields should be reviewed until the real email formats and reschedule/cancellation rules have been tested. Do not use an inbox attachment name or email instruction as a command or filesystem path.

Decide whether the destination Excel workbook lives on the PC or in OneDrive/SharePoint. A cloud automation cannot directly write an arbitrary local PC path without an appropriate local agent or gateway. The existing `sync --watch` command assumes the workbook is available on the PC where it runs.

There is no saved Outlook credential, live mailbox subscription, or scheduled mailbox job in this repository. Do not treat this plan as an installed automation. No outbound email messages are sent.
