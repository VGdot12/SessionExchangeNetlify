# Deploy the corrected version to Netlify

This package matches your repository's existing `SessionExchange` folder.

1. Extract the ZIP.
2. In GitHub, open `VGdot12/SessionExchange` at the repository root.
3. Choose **Add file → Upload files**. Upload the **contents** of the extracted folder: `netlify.toml`, `START_HERE.md`, `.github` and `SessionExchange`. Do not upload another enclosing folder.
4. Commit the changes. Existing files with matching paths will be replaced.
5. In your existing Netlify project, trigger **Clear cache and deploy site**.
6. Wait for **Published**, then open your site.

The root configuration supplies these settings:

| Setting | Value |
| --- | --- |
| Base directory | `SessionExchange` |
| Build command | `npm run build` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

Check that your GitHub repository now shows a `netlify.toml` file directly at its root, next to the `SessionExchange` folder. This is the key difference from the first upload.

The site runs entirely on Netlify: static interface, JavaScript backend and shared persistent storage. It starts with fictional sample sessions. Enter a name and PGID `26001`, or use a new PGID to register. PGID-only sign-in and self-reported assignments are prototype features.

After publication, `/api/health` on your site should show `ok: true`. If the page loads but the health check fails, open the Netlify `api` function logs.

[Full deployment guide](SessionExchange/DEPLOY_NETLIFY.md)

The Python files are retained for local Excel and Outlook import. No Python server is needed for the Netlify website. Uploading the website does not connect Outlook or activate the previously declined email schedule.

Verification: 12 Netlify API tests and 22 Python tool tests passed. Netlify's production bundler produced a Node 22 function with `/api/*` routing. The deployed site still requires your upload and redeploy; no live deployment was performed from this chat.
