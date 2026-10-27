For the current route without the Premium HTTP action, use [GITHUB_RELAY_SETUP.md](GITHUB_RELAY_SETUP.md). The guide below is the optional direct HTTP route and requires a license permitting HTTP.

# Connect Outlook to SessionExchange using Power Automate

Use this guide instead of the previous Microsoft application-registration guide. This route uses your normal Outlook connection in Power Automate. It does not need a custom Microsoft app, Outlook administrator credentials, Excel, or a running computer. Your organization still needs to permit the connectors, and the HTTP action can require Power Automate Premium.

## 1. Upload this release and configure Netlify

Extract SessionExchange-Power-Automate.zip. Upload its CONTENTS directly into the root of VGdot12/SessionExchange, replacing the corresponding files. You must see netlify.toml and package.json directly at the root, alongside netlify/, scripts/ and session_swap/. Do not add a new SessionExchange/ parent folder.

In your existing Netlify project, open Project configuration → Environment variables. Set the following for Production and Functions (or all scopes if scope controls are unavailable):

| Variable | Value |
| --- | --- |
| SWAP_POWER_AUTOMATE_ENABLED | 1 |
| SWAP_OUTLOOK_ENABLED | 0 |
| SWAP_SEED_DEMO | 0 |
| SWAP_TIMEZONE | Asia/Kolkata |
| SWAP_FLOW_TOKEN | A new random secret of at least 32 characters; 48 random letters/numbers is suitable |
| SWAP_ADMIN_TOKEN | A different random secret of at least 32 characters, or your existing private dashboard token |

Generate the secrets with a password manager and save them. SWAP_FLOW_TOKEN allows delivery only; SWAP_ADMIN_TOKEN opens your site's private coordinator dashboard. Neither is an Outlook administrator credential. Do not put either token in GitHub or Excel. The OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET and OUTLOOK_MAILBOX variables from the older guide are not needed for this route.

Deploy the latest GitHub commit in Netlify and wait for Published. The supplied netlify.toml sets base ., build command npm run build, publish public, and functions directory netlify/functions. The existing student data stays in the same production store. The old scheduled function is inactive in Power Automate mode.

## 2. Create the automated flow

1. Open https://make.powerautomate.com/ and sign in with your college account.
2. Choose Create → Automated cloud flow.
3. Name it SessionExchange — new session invites.
4. Select Office 365 Outlook → When a new email arrives (V3), then Create. Use your own Outlook connection.
5. Select the trigger. In Parameters, expand Advanced parameters (or Show advanced options in the classic designer), then set:

| Trigger field | Value |
| --- | --- |
| Folder | Inbox, or the actual folder receiving these invites |
| From | casevents@isb.edu |
| Subject Filter | Pre Placement Talk |
| Include Attachments | No |
| Only with Attachments | No |
| Importance | Any |

Leave To and CC empty. The subject filter is deliberately a short phrase; the next condition checks the full required prefix while tolerating extra spaces. Microsoft documents sender and subject filters in its [email-trigger instructions](https://learn.microsoft.com/en-us/power-automate/email-triggers).

## 3. Add the full subject condition

Add a Condition action immediately below the trigger. For the left value, open Expression (fx) and paste:

```text
contains(toLower(replace(coalesce(triggerBody()?['subject'], ''), ' ', '')), 'upcomingevent|pgpco2027|preplacementtalk:')
```

Choose is equal to. For the right value, use Expression (fx) and enter:

```text
true
```

Do not put quotation marks around true. Leave the False / If no branch empty. The HTTP action in the next step belongs INSIDE the True / If yes branch.

This matches the required text "Upcoming Event  | PGP Co 2027 | Pre Placement Talk :" even if the usual spaces or letter case differ. Netlify checks the actual sender and complete subject again. Other cohorts and event types are not imported.

## 4. Add the HTTP action

Inside the True branch, add the action named HTTP. Use the general HTTP action, not HTTP with Microsoft Entra ID and not Send an HTTP request from the Outlook connector. If Power Automate shows a Premium requirement, you need an entitlement or trial that permits this HTTP action before the flow can run.

Enter:

| HTTP field | Value |
| --- | --- |
| Method | POST |
| URI | https://sessionexchange.netlify.app/api/integrations/outlook |
| Authentication, if shown | None |

Add these three Headers rows:

| Header key | Header value |
| --- | --- |
| Content-Type | application/json |
| Authorization | Bearer YOUR_FLOW_TOKEN |
| X-Swap-Request | 1 |

Replace YOUR_FLOW_TOKEN with the exact value of SWAP_FLOW_TOKEN from Netlify. Keep the word Bearer and ONE space before the secret. Do not use SWAP_ADMIN_TOKEN here.

For the HTTP Body, select the expression editor (fx), enter the following expression, and choose Add / Update:

```text
triggerBody()
```

The ENTIRE Body field must be this expression. Do not choose the Outlook dynamic-content item called Body or Body Preview, and do not put quotation marks around the expression. triggerBody() sends the complete email object, including its sender, subject, ID, timestamp and body, as JSON. This also preserves quotes and line breaks in HTML without manually escaping them.

The receiving endpoint accepts the Office 365 Outlook V3 message format and keeps only extracted event details and private deduplication/review metadata. It does not save recipient lists, attachments, raw email bodies or the flow token. The connector's [documented fields](https://learn.microsoft.com/en-us/connectors/office365/#graphclientreceivemessage) include the fields used by this endpoint.

Select the HTTP action → Settings → Security. Turn Secure inputs and Secure outputs ON so the token and email payload are hidden from run history. These settings do not hide secrets from people who can edit the flow, so restrict sharing. Microsoft describes these controls in [Secure data used in cloud flows](https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/use-secure-inputs-outputs-triggers).

## 5. Save and test

Save the flow and make sure it is turned on. The outline should be:

```text
When a new email arrives (V3)
    Condition: required subject phrase
        True → HTTP POST to Netlify
        False → no action
```

Choose Test → Manually and wait for a NEW matching email. An old invite already in your inbox does not trigger a new-email flow. Do not forward it to yourself for this test: the sender would become your own address, so the From filter should exclude it.

For a matching new invite, check My flows → your flow → Run history. The condition should be True and HTTP should succeed. Since Secure outputs hides response content, check delivery counts in the private dashboard instead:

1. Open https://sessionexchange.netlify.app/outlook-admin.html.
2. Enter SWAP_ADMIN_TOKEN, the separate secret for your own site.
3. Check Last successful delivery, Last delivery results and Emails needing review.
4. Refresh the student app. Future sessions should appear in the session selection lists. An email with unclear details enters review rather than becoming an incorrect session.

Power Automate runs this when emails arrive; it is no longer a five-minute polling task. Connector delivery can be delayed, so it is not a guaranteed instantaneous update. No Netlify redeploy is needed for each new email.

## 6. Import existing invites now, without waiting for a new email

Create a SECOND, temporary flow for a one-time backfill:

1. Create → Instant cloud flow → Manually trigger a flow. Name it SessionExchange — import existing invites.
2. Add Office 365 Outlook → Get emails (V3). Rename the action to Read_recent_invites using its menu.
3. Set Folder to the invite folder; From to casevents@isb.edu; Fetch Only Unread Messages to No; Include Attachments to No; and Top to 10. For Subject Filter, paste the exact opening phrase from an existing invite, ending at the colon after Pre Placement Talk. Preserve its spacing here because this is a text filter. The Netlify endpoint still checks the full sender/subject rule.
4. Add the same HTTP action with the SAME URL, headers and secure settings as step 4. The Body expression is DIFFERENT for this manual flow:

```text
body('Read_recent_invites')
```

5. Save and Run the manual flow. This sends the returned value array to Netlify; there is no need to add Apply to each. The endpoint supports batches of up to 25 messages, so keep Top at 10. If no messages match, this endpoint returns 400 rather than silently reporting an import; check the folder, subject spacing and read/unread setting.
6. Check the private dashboard and the student session lists. Re-running the same batch does not duplicate sessions. Once the needed existing invites are imported, leave this manual flow unused or turn it off. Keep the automated new-email flow on.

The Get emails filters search within the first 250 messages in that folder. If an older invite is missing, use the action's Search Query with Outlook search terms, such as `from:casevents@isb.edu subject:"Pre Placement Talk"`, then check the returned messages and keep Top at 10. Netlify ignores any sender or subject that does not match the required full rule. This search behavior is described in the [Outlook connector reference](https://learn.microsoft.com/en-us/connectors/office365/#get-emails-v3).

## Results and troubleshooting

The endpoint returns HTTP 200 for a valid delivery with counts such as updated, review, duplicate, older and ignored. A successful HTTP request does not necessarily mean a new selectable event was created: an old or duplicate invite is ignored, a past event is not offered for new swaps, and an ambiguous or revised invite is held for review.

| Result | Meaning / fix |
| --- | --- |
| 404 or HTML instead of JSON | The new code is not deployed, or the API function is missing. Upload the release at the repository root and redeploy. |
| 403 Invalid Power Automate token | SWAP_FLOW_TOKEN must match the Authorization header exactly; include Bearer plus a space. Redeploy after changing Netlify variables. |
| 403 Refresh the page and try again | Add X-Swap-Request with value 1 to the HTTP headers. |
| 503 endpoint disabled | Set SWAP_POWER_AUTOMATE_ENABLED=1 in Production/Functions and redeploy. |
| 400 needs id/from/timestamp/body | Use triggerBody() for the automated flow, or body('Read_recent_invites') for the manual flow. Do not send only Body/Body Preview. |
| ignored: 1 | Actual sender or the full subject phrase does not match. A forward from your account should be ignored. |
| review: 1 | Open the private dashboard, choose the correct event, then apply, cancel or dismiss. |
| HTTP action cannot be saved/run | Check your Power Automate license and whether the Outlook and HTTP connectors are allowed together in your organization. |

New events append to the existing catalogue. Room corrections keep open requests. Confirmed schedule changes close affected open requests, while accepted swap history remains. Stop the old Excel watcher; full Excel imports are blocked while this integration is enabled. Power Automate's Outlook connection must remain signed in; reconnect it if Microsoft revokes or expires the connection.

Verification for this release covers local automated tests and Netlify production bundling. Your own Microsoft connection, license and first live Power Automate delivery still need to be verified in your account.
