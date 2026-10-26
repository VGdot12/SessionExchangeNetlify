# Run SessionExchange on Netlify

This version includes a Netlify-native backend. The page is published from `public/`; JavaScript Functions serve `/api/*`; Netlify Blobs stores shared student accounts, logins, requests, declared assignments and accepted-swap history. Python is used only for optional local Excel and Outlook tools.

## Fix the existing repository

Your repository currently contains a top-level `SessionExchange/` folder. The replacement **SessionExchange-Netlify.zip** is packaged to match it:

```text
repository root/
  netlify.toml
  START_HERE.md
  .github/workflows/tests.yml
  SessionExchange/
    package.json
    package-lock.json
    scripts/build.mjs
    netlify/functions/api.mjs
    netlify/lib/
    session_swap/static/
    ...Excel tools, tests and documentation
```

1. Extract the new ZIP on your computer.
2. Open your existing GitHub repository. Choose **Add file → Upload files**.
3. Drag the **contents** of the extracted folder into the repository root: `netlify.toml`, `START_HERE.md`, `.github` and `SessionExchange`. Do not drag an additional enclosing ZIP-named folder into the repository.
4. Commit the upload. The new `SessionExchange` files replace files at the same paths. Old Python files may remain; Netlify runs the new JavaScript backend.
5. In Netlify, open your existing project, then **Project configuration → Build & deploy → Continuous deployment → Build settings**. Confirm these effective settings:

| Setting | Value |
| --- | --- |
| Production branch | `main`, or the actual branch you uploaded to |
| Base directory | `SessionExchange` |
| Build command | `npm run build` |
| Publish directory | `public` (relative to the base directory) |
| Functions directory | `netlify/functions` (relative to the base directory) |
| Node version | `22` |

The root `netlify.toml` supplies the directory, build, publish and function settings. Leave the optional **Package directory** unset. If the UI displays resolved paths such as `SessionExchange/public`, that is the same effective publish location.

6. Open **Deploys → Trigger deploy → Clear cache and deploy site**. The log should show dependency installation, the build finishing, and an `api` function being bundled.
7. After the deployment is **Published**, open your Netlify URL. Enter a name and PGID `26001`. New PGIDs also work.

Do not use Netlify's static drag-and-drop publishing for only the HTML files. A Git-connected build must include the function and its dependency.

## Check the deployment

- `/` should show the name and PGID form.
- `/api/health` should return JSON with `ok: true`, `runtime: "netlify-functions"` and `storage: "netlify-blobs"`.
- `/api/config` should return JSON with `pgid_only: true`.
- Register two different PGIDs, post a cross-event request from one, and accept it from the other. Both accounts should show it in My requests. A third account should no longer see the request on the public board.
- Refresh or revisit later: requests remain in Netlify's shared store. They do not depend on one browser's local storage or a temporary function filesystem.

If `/` gives Netlify's 404, check that `netlify.toml` is at the actual repository root and that the build produced `public/index.html` under the base directory. If `/api/config` gives an HTML 404, check the Functions section and confirm the `api` function was deployed from `netlify/functions`. A storage error should be investigated in that function's logs rather than hidden by an HTML fallback.

## Sample data and real Excel updates

On an empty store the prototype seeds fictional students and twelve sample sessions. This happens once; redeploying the same production site preserves its data. To start empty, set **SWAP_SEED_DEMO=0** in Netlify before the first use. Changing that variable later does not erase existing data.

The sample dates are generated relative to first use. They are not the live institutional schedule. Import the real Excel catalogue using the existing local sync command once it is ready.

Set the same `SWAP_ADMIN_TOKEN` (at least 32 random characters) in Netlify's function environment and on the PC running the sync process. Redeploy after changing function environment variables. Then:

```sh
python -m session_swap sync /full/path/SessionCatalogue.xlsx --url https://sessionexchange.netlify.app --watch --interval 300
```

Do not put that secret into GitHub, the page, browser JavaScript or the workbook. Student login needs no setup secret. The catalogue endpoint replaces the active event snapshot while preserving accepted history and student-declared swaps. Removed events cancel affected open requests. The web app cannot directly read a file on your laptop; the PC sync process must stay awake and running.

The Outlook intake code is still included. Outlook access and a mailbox schedule remain unconnected; deploying the web app does not activate email retrieval.

## Prototype scope

PGID-only entry and self-reported assignments are the first-prototype choices requested for this project. PGIDs do not authenticate identity. Use controlled test data until you add institution-approved authentication. This Netlify backend implements name/PGID entry; the Python server's optional password mode is a separate local-server feature.

For a small student prototype, the app stores one shared document and uses strongly consistent reads plus conditional writes based on the document's ETag. On a conflicting save, it reloads data and reruns the business checks. Thus a second acceptor sees the request as already accepted. Writes never use a process-local lock or an unprotected last-write-wins update. Failed operations do not partially update swap history.

The document is capped at 8 MB so it cannot grow without bound silently. For a larger rollout, migrate to a relational database. Netlify platform usage is governed by your plan. Production data is separate from deploy previews; production redeploys retain the same store. Export backups from **Data & Storage → Blobs**, store `sessionexchange-production-v1`, key `application-v1`. Treat the export as private student data.

## Local development and verification

For the Netlify stack, use Node.js 22.13+:

```sh
npm ci
npm test
npm run build
npm run dev
```

`npm run dev` uses Netlify's local emulator at port 8888. It stores local runtime data under `.netlify/` and does not deploy anything.

Twelve Node tests cover shared persistence, cold handlers, cross-event acceptance, competing acceptors, concurrent registrations, flexible requests, authorization, import rollback, history snapshots, cookies, rate limits and campus-timezone boundaries. The production API is also checked with Netlify's function bundler, including the `/api/*` route and Node 22 runtime. The Python tool suite remains available with `python -m unittest discover -s tests -v`.

## Official references

- [Netlify Functions and supported runtime setup](https://docs.netlify.com/build/functions/get-started/)
- [Function paths and routing](https://docs.netlify.com/build/functions/configuration/#routing)
- [Blobs persistence, strong consistency and conditional writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
