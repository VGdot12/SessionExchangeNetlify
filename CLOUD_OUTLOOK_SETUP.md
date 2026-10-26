For the current Power Automate setup without a custom Microsoft app, use [POWER_AUTOMATE_SETUP.md](POWER_AUTOMATE_SETUP.md). The optional administrator-approved connection below is a different method.

# Outlook to SessionExchange, without Excel

The code is ready for a Microsoft 365 work or school mailbox in Exchange Online. It is not activated until your administrator grants access and you configure Netlify. This application connection does not use your Outlook password, a personal Outlook.com account, a local script or a Codex scheduled task.

## 1. Upload the code

Upload the extracted ZIP contents directly into the root of VGdot12/SessionExchange, replacing the corresponding files. The root must contain netlify.toml and package.json, with netlify/, scripts/ and session_swap/ alongside them. Do not introduce an extra SessionExchange/ parent folder.

The Netlify settings are base = ., command = npm run build, publish = public. The supplied config includes them. There are no new package dependencies.

## 2. Connect Microsoft 365 with your college administrator

Ask your college Microsoft 365 administrator to create or authorize a single-tenant Microsoft Entra application named SessionExchange Outlook Import. It needs background read access to ONE designated receiving mailbox, such as your own college mailbox. That is the mailbox receiving the invites, not casevents@isb.edu.

The application calls Microsoft Graph using client credentials. Your administrator must authorize application-level Mail.Read access. Mail.ReadBasic is insufficient because the session details are in the email body. Delegated permissions alone do not work with this release.

Ask IT to scope access to the designated receiving mailbox using Exchange Online Application RBAC (Application Mail.Read), and verify that no separate unscoped Entra grant gives it access to other mailboxes. RBAC and Entra grants are additive. If your organization uses an Entra Mail.Read application permission with admin consent and its existing mailbox restriction policy instead, IT should verify the effective scope. Selecting a mailbox in this app does not itself restrict the Microsoft permission grant.

Record these values in Netlify, not in GitHub:

| Netlify variable | What to enter |
| --- | --- |
| OUTLOOK_TENANT_ID | Directory (tenant) ID of the college Microsoft tenant |
| OUTLOOK_CLIENT_ID | Application (client) ID of the new app |
| OUTLOOK_CLIENT_SECRET | The client secret VALUE, not the secret's ID |
| OUTLOOK_MAILBOX | Email address of the mailbox that receives the invites |

IT creates the client secret under the app registration's Certificates & secrets. Record its expiry and replace it in Netlify before expiry. No redirect URI or browser sign-in callback is required for this application connection. Never share the secret in chat or commit it to GitHub. If your tenant requires certificates or managed identities instead of client secrets, this authentication component needs adapting before use.

Microsoft references: [Register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow), [mail permissions](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread), [mailbox access scoping](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

## 3. Add the Netlify environment variables

In your existing Netlify project, open Project configuration → Environment variables. Add the four Microsoft variables above and these settings. Use the Functions scope and Production context where those controls are available. Netlify environment changes require a new deployment to reach functions.

| Variable | Value |
| --- | --- |
| SWAP_OUTLOOK_ENABLED | 1 |
| SWAP_SEED_DEMO | 0 |
| SWAP_TIMEZONE | Asia/Kolkata |
| SWAP_ADMIN_TOKEN | Your existing private token, or a new random password of at least 32 characters |
| OUTLOOK_FOLDER | inbox |
| OUTLOOK_LOOKBACK_DAYS | 30 |

Use a password manager to generate and store the administrator token. You will enter this token on the private dashboard; students continue to use their name and PGID. A PGID does not grant administration access. Do not set secrets as build-time public variables or put them in netlify.toml.

The sender and subject are fixed in the code:

- Sender: casevents@isb.edu
- Subject must contain: Upcoming Event | PGP Co 2027 | Pre Placement Talk :

The subject check is case insensitive and permits extra or missing spacing around the separators. For example, "Upcoming Event  | PGP Co 2027 | Pre Placement Talk : Session Scheduled - 27 October, 2026" matches. "PGP Co 2028", "Workshop", or a missing final colon do not match. RE: and FW: prefixes still match if the actual sender is casevents@isb.edu. An invite forwarded from a student's address is excluded. Bodies are downloaded only after both sender and subject checks pass.

By default, the importer watches the Inbox. Do not move matching emails out of the monitored folder before they are fetched. If a mailbox rule routes them elsewhere, set OUTLOOK_FOLDER to that folder's Microsoft Graph folder ID. It is not the visible folder name. Changing mailbox or folder requires using Rescan recent emails on the dashboard after redeploying.

## 4. Redeploy and verify

Commit the uploaded files in GitHub. In Netlify, open Deploys and deploy the latest main-branch commit. Retry without cache if old build settings remain. Wait until the deploy is Published.

Check Functions: api and outlook-sync must both be present. outlook-sync has a Scheduled badge and runs every five minutes on published deployments. It does not automatically run on branch or preview deployments. There is no public /outlook-sync URL to click; use the private dashboard or the function's Run now action in Netlify.

Open [the private dashboard](https://sessionexchange.netlify.app/outlook-admin.html). Enter SWAP_ADMIN_TOKEN and select Check Outlook now. Confirm:

1. Connection shows Configured.
2. Last successful page receives a timestamp and Attention has no connection error.
3. Checked emails through advances, or Scan reports Catching up. The initial scan reads the previous 30 days and can finish over several runs.
4. Matching future sessions appear in students' session selection lists after a refresh. Past events stay stored but are not offered for new swaps.

No local computer needs to remain running after this setup. Stop the old Excel watcher. Full catalogue Excel imports are rejected while SWAP_OUTLOOK_ENABLED=1 so they cannot accidentally overwrite cloud updates.

Netlify references: [Scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/), [function environment variables](https://docs.netlify.com/build/functions/environment-variables/).

## 5. What happens to sessions and swap records

A normal invite provides Company Name, Event Type, Event Date, Event Time, and optionally Venue in its body. The importer builds the title as Company Name · Event Type and saves only title, room, date and start/end time, plus internal identifiers. It does not read screenshots, PDFs or calendar attachments. Unreadable or ambiguous bodies go to the private review queue.

New events are appended. Other sessions, students, assignments and swap history stay saved. If an invite matches the title, date and start time of an existing Excel-origin session, the importer preserves its original IDs. Room corrections preserve open requests. Changes to the title, date or time close affected open requests so students can review the new schedule and post again; accepted history keeps its original snapshot.

Cancellation and rescheduling messages are not applied automatically. They must also match the required sender AND subject to enter review. On the dashboard, select the affected session and apply the new details, cancel that session, or dismiss the email. Confirming a new event adds it separately. Cancelling a session hides it from new swap selections and closes affected open requests; it does not erase accepted history. A review choice is an explicit coordinator decision. Dismissing a message prevents the same unchanged message from returning.

Existing sample events are retained too. Use Session catalogue → Deactivate selected session to remove unwanted sample events from students' choices. This retains their history and closes their open posts.

Emails outside the exact sender/subject rule are ignored, including cancellation notices that omit the required subject phrase. If such a cancellation affects a session, deactivate it manually through Session catalogue.

The private checkpoint prevents duplicate imports and older invites from overwriting newer details. Event updates and pagination checkpoints commit atomically using the same conditional storage writes as the swap board. An interrupted run resumes from its last completed page. Only one mailbox sync can hold the short-lived lease at a time; student updates continue safely.

No email bodies or access tokens are persisted. The private checkpoint retains hashes, scan URLs, timestamps, and a bounded review queue with the subject and extracted event details. It is not included in student API responses. The dashboard token stays in memory only and is cleared by Lock dashboard or a page reload.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| 404 on the student app or dashboard | Files must be at the repository root; base ., publish public; check that scripts/build.mjs copies the dashboard assets. |
| Configured but Microsoft returns 401/403 | Secret VALUE and expiry, correct tenant/client IDs, application Mail.Read authorization, administrator approval and mailbox access scope. |
| Successful scan, no sessions | Actual sender and full subject phrase, Inbox versus a mailbox-rule folder, required body labels, review queue, and whether the session is already past in Asia/Kolkata. |
| Catching up | Wait for subsequent scheduled runs or choose Check Outlook now again. Each run is bounded to fit Netlify's scheduled-function time limit. |
| Outlook connection fails or is rate limited | The checkpoint is retained. The next five-minute run retries. Check the admin page and function logs. |
| Mailbox/folder changed | Choose Rescan recent emails after redeploying the new settings. This resets the scan window but preserves sessions and duplicate tracking. |
| Old mail missing | OUTLOOK_LOOKBACK_DAYS supports 1–90. Set the needed window, redeploy, then rescan. It does not reset student records. |
| Queue or checkpoint capacity reached | Clear reviewed items; ask the developer to expand/archive the private import checkpoint. History is never silently truncated. |

Netlify plan quotas and Microsoft limits still apply. A suspended project, expired credential, revoked permission, or moved email can stop automatic updates. No live mailbox connection was available while this release was prepared: local tests use simulated Microsoft responses, and the real first sync must be verified after you configure Microsoft and Netlify.
