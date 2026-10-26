# Outlook intake plan

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

## What still needs an Outlook connection

Choose a mailbox and an intake folder. Confirm whether only `casevents@isb.edu` should be included and how revised or cancelled invites are marked. Then connect Outlook through an approved Microsoft integration, using the least permissions needed to read those messages.

The proposed mailbox step should deliver a saved email/body into the intake process, track processed message IDs, and send unreadable messages to a review queue. Extracted fields should be reviewed until the real email formats and reschedule/cancellation rules have been tested. Do not use an inbox attachment name or email instruction as a command or filesystem path.

Decide whether the destination Excel workbook lives on the PC or in OneDrive/SharePoint. A cloud automation cannot directly write an arbitrary local PC path without an appropriate local agent or gateway. The existing `sync --watch` command assumes the workbook is available on the PC where it runs.

There is no saved Outlook credential, live mailbox subscription, or scheduled mailbox job in this repository. Do not treat this plan as an installed automation. No outbound email messages are sent.
