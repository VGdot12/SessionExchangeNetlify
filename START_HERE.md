# SessionExchange on Netlify

This release imports session invites directly from Outlook in the cloud. Excel and a running local computer are not needed after setup.

1. Unzip the download. Upload its CONTENTS into the root of your existing GitHub repository. At the repository root you should see netlify.toml, package.json, netlify/, scripts/ and session_swap/. Do not put everything inside another SessionExchange folder.
2. Keep the Netlify project connected to VGdot12/SessionExchange. Base directory is the repository root (.), build command is npm run build, publish directory is public, and functions directory is netlify/functions. The supplied netlify.toml sets these correctly.
3. Follow CLOUD_OUTLOOK_SETUP.md to connect Microsoft 365 and enter the settings in Netlify. This version uses an application connection that needs your college Microsoft administrator's authorization. Uploading the code alone does not connect your mailbox.
4. Redeploy the latest main-branch commit after adding the environment settings. Confirm both api and outlook-sync appear under Functions; outlook-sync should be marked Scheduled.
5. Open https://sessionexchange.netlify.app/outlook-admin.html. Enter your SWAP_ADMIN_TOKEN, then choose Check Outlook now. Verify the first successful scan and refresh the student app.

Only messages FROM casevents@isb.edu with a subject CONTAINING "Upcoming Event | PGP Co 2027 | Pre Placement Talk :" are eligible. Differences in spacing and letter case are allowed; other cohorts and event types are excluded. The importer reads only title, room, date and start/end time into the catalogue. It does not fetch attachments or send email.

Existing sessions and swap records remain saved. Use the private dashboard to review changes or deactivate old sample sessions. Stop any local Excel watcher when you switch to cloud sync. Full Excel imports are blocked while cloud sync is enabled.

Do not upload real credentials, .env files, local databases or node_modules to GitHub. Store secrets in Netlify environment variables for Functions, in the production context. No Microsoft secrets belong in frontend code.
