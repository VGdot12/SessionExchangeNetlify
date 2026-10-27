# Outlook → Power Automate → GitHub Actions → Netlify

This is the current recommended setup. Keep the Outlook trigger and Condition you already built. Replace the Premium HTTP action with GitHub's standard connector, then let the supplied GitHub Actions workflow deliver the invite to Netlify. No custom Microsoft application, Outlook administrator credentials, Excel or local computer is required. The normal Outlook and GitHub connections must be allowed in your Power Automate environment.

Microsoft lists the GitHub connector as Standard and documents the dispatch action [here](https://learn.microsoft.com/en-us/connectors/github/#create-a-repository-dispatch-event-preview). The action is currently labelled Preview. Standard GitHub-hosted runners in public repositories have free Actions usage; private repositories use the account's allowance. Netlify and Power Automate usage limits still apply. See [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## 1. Upload the updated files

Extract SessionExchange-GitHub-Relay.zip. Upload its CONTENTS directly into the root of VGdot12/SessionExchange, replacing matching files. Keep package.json and netlify.toml at the repository root. Do not introduce another SessionExchange/ parent folder.

Confirm that these files exist in GitHub on your DEFAULT branch, normally main:

```text
.github/workflows/outlook-relay.yml
scripts/relay-outlook-event.mjs
netlify/lib/power-automate.mjs
netlify/lib/handler.mjs
```

On a Mac, Finder hides .github by default. Press Command+Shift+. to show hidden files before selecting the folder for upload. Check .github/workflows/outlook-relay.yml on GitHub after committing. If it is missing, use Add file → Create new file, name it .github/workflows/outlook-relay.yml, and paste the contents of that file from the download. This location matters: GitHub only recognizes workflows inside .github/workflows/.

This release retains the flat Netlify configuration: base ., build npm run build, publish public. After uploading, let Netlify deploy the latest commit and wait for Published. The update adds a read-only connection check to the existing integration endpoint. It preserves the production catalogue and swap history.

## 2. Keep these settings in Netlify

In Netlify → your project → Project configuration → Environment variables, keep:

| Variable | Value |
| --- | --- |
| SWAP_POWER_AUTOMATE_ENABLED | 1 |
| SWAP_OUTLOOK_ENABLED | 0 |
| SWAP_SEED_DEMO | 0 |
| SWAP_TIMEZONE | Asia/Kolkata |
| SWAP_FLOW_TOKEN | Your existing random delivery secret, at least 32 characters |
| SWAP_ADMIN_TOKEN | Your separate private dashboard secret |

Use Production and Functions scope if scope controls are available. Save and redeploy after changing values. There is no need to generate a new SWAP_FLOW_TOKEN if the existing value is already configured. The SWAP_POWER_AUTOMATE_ENABLED name stays the same because Netlify still receives the same Power Automate message format through the relay. Microsoft tenant/client credentials are not used in this mode.

## 3. Add the same delivery secret to GitHub

1. Open https://github.com/VGdot12/SessionExchange.
2. Select Settings → Secrets and variables → Actions.
3. Choose New repository secret.
4. Name: SWAP_FLOW_TOKEN.
5. Secret: paste the EXACT SAME secret value from Netlify's Production SWAP_FLOW_TOKEN field. Do not include the word Bearer and do not paste the variable name as its value.
6. Choose Add secret.

Use an Actions repository SECRET, not a plain repository variable, environment-specific secret or source file. This token belongs to your website and does not require an Outlook administrator. GitHub documents repository secrets [here](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 4. Test the GitHub-to-Netlify connection first

1. Open the repository's Actions tab. Enable Actions if GitHub asks you to enable workflows.
2. In the left list, select Deliver Outlook session invite.
3. Choose Run workflow → select main (or your actual default branch) → Run workflow.
4. Open the new run and its deliver job.
5. The last step should say: Connection check passed. No session or swap was changed.

This manual run checks the GitHub secret against the protected Netlify endpoint. It does NOT import an email or create a delivery-history entry. If it fails, resolve the error before editing the Power Automate flow. A 403 means the secrets do not match or the integration is not enabled for production. A 404 usually means the new Netlify files are not deployed. A 503 means the integration is disabled or the API/storage is unavailable.

The workflow must be on the default branch for external dispatch events to trigger it. See [GitHub event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch).

## 5. Replace the HTTP action in your existing Power Automate flow

Open Power Automate → My flows → your SessionExchange flow → Edit.

KEEP the existing Outlook trigger and the Condition. In the True branch, select the HTTP card's ellipsis (…) menu and Delete it. Removing HTTP removes this Premium capability from the flow.

Now click + INSIDE the True branch → Add an action. Search GitHub, then select:

Create a repository dispatch event (Preview)

Use Microsoft's standard GitHub connector. If prompted to create a connection, name it SessionExchange GitHub and sign in as VGdot12, the GitHub account that owns this repository. Authorize access to SessionExchange as requested. This is a connection inside Power Automate; no Codex GitHub plugin is needed.

Enter the action fields:

| Field | Value |
| --- | --- |
| Repository Owner | VGdot12 |
| Repository Name | SessionExchange |
| Event Name | session-invite |
| Event Payload | The expression below |

For Event Payload, click inside the field → fx / Expression, paste this ENTIRE expression and apply it:

```text
setProperty(json('{}'), 'message', triggerBody())
```

Do not surround the expression with quotes and do not enter the word message as plain text. It creates an object containing one message property. Use this expression instead of putting triggerBody() directly at the top level: the workflow expects message, and GitHub limits top-level payload properties. If Event Name or Event Payload is hidden, expand the action's Advanced parameters / Show all.

There are no URI, HTTP headers or Authorization fields in this GitHub action. The delivery token stays in GitHub's Actions secret. Do not put your Netlify token inside Event Payload.

Open the GitHub action's Settings and turn Secure inputs and Secure outputs ON to hide the email payload from Power Automate run history. These controls do not hide the flow definition from editors; only share editing access with trusted collaborators. Save the flow and keep it turned on.

The finished outline is:

```text
When a new email arrives (V3)
  Condition: required subject phrase
    True → GitHub: Create a repository dispatch event
    False → no action
```

## 6. Confirm the existing trigger and Condition

The Outlook trigger should retain From = casevents@isb.edu, Subject Filter = Pre Placement Talk, Include Attachments = No, Only with Attachments = No, and the actual folder receiving your invites. Leave To and CC empty.

The existing Condition's left-hand expression is:

```text
contains(toLower(replace(coalesce(triggerBody()?['subject'], ''), ' ', '')), 'upcomingevent|pgpco2027|preplacementtalk:')
```

Operator: is equal to. Right-hand value: Expression true, without quotation marks.

This checks the complete required prefix while tolerating the usual extra spaces. The relay and Netlify independently recheck casevents@isb.edu and the full subject rule: Upcoming Event | PGP Co 2027 | Pre Placement Talk :. Other cohorts and event types are not imported.

## 7. Test an actual invite

Save the flow. Choose Test → Manually and wait for a NEW matching email. An old invite already in the inbox will not trigger a new-email flow. Forwarding it yourself changes the sender and should be excluded.

For a successful delivery:

1. Power Automate Run history shows the Condition as True and the GitHub dispatch action as successful.
2. GitHub Actions shows a Deliver Outlook session invite run triggered by repository_dispatch. Its last step reports delivery counts only: updated, review, duplicate, older and ignored.
3. The private dashboard https://sessionexchange.netlify.app/outlook-admin.html, opened with SWAP_ADMIN_TOKEN, shows Last successful delivery and the results.
4. Future sessions appear in the student selection lists after a refresh. An unreadable or revised invite enters the review queue.

A successful Power Automate dispatch only means GitHub accepted the event. Check the GitHub run and the dashboard to confirm that Netlify actually received it. If delivery fails, open the failed GitHub run → Re-run jobs. Duplicate tracking makes replay safe.

## 8. Optional: import an invite already in your inbox

Create a temporary Instant cloud flow with Manually trigger a flow. Add Office 365 Outlook → Get emails (V3), using the invite folder, From casevents@isb.edu, Fetch Only Unread Messages No, Include Attachments No, and Top 10. For Subject Filter, paste the exact opening phrase from an existing invite through the colon after Pre Placement Talk, preserving its spacing.

Add Apply to each and choose value from Get emails (V3) as its input. INSIDE that loop, add the same GitHub dispatch action with owner VGdot12, repository SessionExchange, event session-invite. Its Event Payload expression is DIFFERENT:

```text
setProperty(json('{}'), 'message', item())
```

This sends one dispatch per email. Do not use the previous HTTP batch expression. Save and run this manual flow, then check GitHub Actions and the private dashboard. Leave the automated new-email flow on. Re-running the same invite does not duplicate sessions. The relay still ignores emails outside the required sender/subject rule.

## Privacy, limits and troubleshooting

The matching email is processed by Power Automate and GitHub Actions before delivery to Netlify. The supplied workflow does not commit emails to the repository, upload mail artifacts, or print raw subjects, bodies, recipients or tokens in logs. The relay sends only the necessary email envelope and body to Netlify; the existing parser saves the session's title, room, date and start/end time plus private duplicate/review metadata. Do not enable verbose event dumps or add steps that print GitHub's event context.

Each event should contain one invite. GitHub limits the dispatch payload to 65,535 characters. Large HTML emails may exceed that limit and be rejected before the workflow runs; do not truncate them silently. Review such an invite manually or adapt the flow to convert its HTML to a smaller plain-text body. Attachments must stay disabled. GitHub Actions and connector delivery may queue; updates are not guaranteed to be immediate.

| Problem | Fix |
| --- | --- |
| Premium warning remains | Delete the HTTP action from this flow. Use the GitHub standard connector, not a custom connector. |
| GitHub dispatch action unavailable or connection blocked | Check your environment's connector policies and regional availability. This is a Microsoft-listed Preview action; your environment must expose it. |
| Dispatch returns 401/403/404 | Reconnect the GitHub account with permission to write to VGdot12/SessionExchange; verify owner and repository names. |
| Dispatch succeeds, but no GitHub run | Confirm the workflow file is in .github/workflows/ on the default branch, Actions is enabled, and Event Name is exactly session-invite. |
| Invalid Event Payload | Use the wrapper expression from step 5; use item() only inside the manual backfill loop. |
| Relay returns Netlify 403 | GitHub's Actions secret must match Netlify's Production SWAP_FLOW_TOKEN exactly. No Bearer prefix in either saved secret. |
| Relay returns 404 or unexpected JSON | Deploy the latest flat-root code in Netlify and wait for Published. |
| Relay reports updated:0 | Check review, duplicate, older and ignored counters. Past sessions stay stored but are not available for new swaps. |
| Connection check fails after changing Netlify settings | Redeploy Netlify after environment-variable changes, then re-run the GitHub connection check. |

The code and workflow have been checked locally. Actual GitHub dispatch permission, Power Automate policy and your first real cloud delivery still need verification in your accounts.
