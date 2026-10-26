# SessionExchange with Power Automate

Use POWER_AUTOMATE_SETUP.md for the exact setup steps. This is the current recommended path and does not require a custom Microsoft app registration.

1. Upload the extracted ZIP CONTENTS to the GitHub repository root. netlify.toml and package.json must be directly at the root.
2. In Netlify set SWAP_POWER_AUTOMATE_ENABLED=1, SWAP_OUTLOOK_ENABLED=0, SWAP_SEED_DEMO=0, SWAP_TIMEZONE=Asia/Kolkata, and separate random SWAP_FLOW_TOKEN and SWAP_ADMIN_TOKEN secrets of at least 32 characters each. These are secrets for your own website, not Outlook administrator credentials.
3. Deploy the latest commit, then create the Power Automate flow described in POWER_AUTOMATE_SETUP.md.
4. The new endpoint is https://sessionexchange.netlify.app/api/integrations/outlook. It receives complete V3 email trigger JSON.
5. The private delivery/review dashboard is https://sessionexchange.netlify.app/outlook-admin.html.

Only casevents@isb.edu emails whose subject contains Upcoming Event | PGP Co 2027 | Pre Placement Talk : are imported. Spacing and letter case differences are accepted. No Excel or local computer is needed. The optional older Microsoft application connection is described separately in CLOUD_OUTLOOK_SETUP.md; do not follow that administrator setup for the Power Automate route.
