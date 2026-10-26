# Deploy SessionExchange on Netlify

Upload the ZIP contents directly at the GitHub repository root. Keep package.json, package-lock.json, netlify.toml, netlify/, scripts/ and session_swap/ at that level. Do not introduce another SessionExchange/ parent folder.

| Setting | Value |
| --- | --- |
| Base directory | . (repository root) |
| Build command | npm run build |
| Publish directory | public |
| Functions directory | netlify/functions |
| Node version | 22 |

The supplied netlify.toml defines the settings. Use the existing Git-connected Netlify project. After committing the files, deploy the latest main-branch commit and wait for Published. Deploy the latest commit without cache if the previous build settings persist.

The build copies the student UI and private Outlook dashboard into public/. Netlify bundles api for /api/* and outlook-sync for the five-minute schedule. Static-only drag-and-drop publishing does not run these backend functions.

Verify / loads the name/PGID form, /api/health returns ok:true, and both functions appear in Netlify. The site-wide production store survives redeployment. Preview deployments use a separate store, and mailbox retrieval is disabled outside production.

For direct Outlook import, complete [CLOUD_OUTLOOK_SETUP.md](CLOUD_OUTLOOK_SETUP.md). Microsoft application authorization and server-side environment variables are required; code upload alone does not connect the mailbox. The admin dashboard is /outlook-admin.html.

Set SWAP_SEED_DEMO=0 to start a new site without fictional sessions. This does not delete sample events already stored on an existing site. Use the private dashboard to deactivate any unwanted samples. Existing sessions and student swap records are preserved.

Full Excel imports are blocked while SWAP_OUTLOOK_ENABLED=1. No local process is required for the cloud importer. To pause mailbox checks, set SWAP_OUTLOOK_ENABLED=0 and redeploy; the catalogue and swap history stay saved.

For debugging, inspect the deploy log and the api or outlook-sync function log. Secrets belong only in Netlify environment settings, never in GitHub. The shared prototype uses strongly consistent Netlify Blobs reads and conditional writes, with an 8 MB document cap. Students use the requested PGID-only prototype entry and self-reported assignments.
