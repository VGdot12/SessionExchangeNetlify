Use only four Excel columns

1. Extract SessionExchange-Excel-update.zip. Copy its session_swap folder into your existing local project folder, replacing importer.py, invites.py and automation.py. Keep all the other project files. You can upload the same three replacement files to GitHub in session_swap/.
2. Download SessionCatalogue-Simple.xlsx and keep it in your permanent local folder. Keep the worksheet name Sessions and the headers title, room, time, date. Its Nagarro row comes from your supplied email screenshot. Replace TBD when the room is confirmed.
3. Add one row per event. Example: title = Company X Careers Talk, room = LT 3, time = 18:00 - 19:00, date = 2026-10-30. Use 24-hour time with both start and end, on the same day. Dates can be real Excel dates or YYYY-MM-DD text. Save the workbook.
4. Run your existing sync command with this workbook's full path. If you use --watch, stop the old watcher with Control+C and restart it after replacing the files. The same SWAP_ADMIN_TOKEN and Netlify URL still apply. These changes run on your computer; no Netlify settings change is needed.

Example, from your local project folder with its Python environment activated and SWAP_ADMIN_TOKEN already set:

```sh
python -m session_swap sync "/Users/vaibhavgurjar/Documents/SessionExchange/SessionCatalogue-Simple.xlsx" --url https://sessionexchange.netlify.app --watch --interval 300
```

The folder above is a suggested location. Save the workbook there first or replace the path with its actual location. Your computer and watcher must stay running for automatic uploads.

Keep all existing catalogue rows when appending events: each sync sends the full current catalogue. Saving Excel alone does not update Netlify unless the watcher is running.

The importer generates internal IDs. Room or end-time edits keep the same session. Changing its title, date or start time creates a new session. Do not add two rows with the same title, date and start time.

The previous nine-column format still works. If you already have live requests against its manually assigned IDs, switching to this four-column file creates new IDs and can cancel those open requests; accepted history remains. Continue using the old workbook if preserving existing open requests is necessary.

The invite import helper can update an existing four-column workbook without adding extra columns. It keeps email tracking in its private checkpoint file. A live Outlook retrieval automation has not been connected or activated.
