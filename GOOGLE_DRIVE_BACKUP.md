# Automatic Google Drive backup

Every receipt, job photo, monthly jobs report and a full database backup,
filed into one Google Drive folder automatically. Free: it runs as a Google
Apps Script in the helpdesk's Google account and uses that account's
15 GB of Drive.

```
ABSL Helpdesk/
  Receipts/2026/10 - October/
    RCPT-... - ABSL-2026-000016 - Keells.pdf          receipt details + photo
    RCPT-... - ABSL-2026-000016 - Keells - photo.jpg  the receipt photo itself
  Job photos/2026/10 - October/ABSL-2026-000016 - Keells/
    2026-10-13 0942 - IMG_0001.jpg
  Reports/2026/
    Jobs report 2026-10 (October)                     Google Sheet: Jobs + Summary
  Database backups/2026/10 - October/
    absl-helpdesk-backup-2026-10-13.json              every table, once a day
```

- New receipts and photos: within the hour.
- Database backup and this month's and last month's report sheets: once a day.
- Daily backups older than 35 days go to the Drive bin; the one taken on the
  1st of each month is kept for good.
- The root folder's description shows when the last run happened and what it
  saved. If a run fails, Google emails the account owner.

How it fits together: `scripts/google-drive-backup.gs` (Google) calls the
`drive-export` Edge Function (Supabase) with a shared `BACKUP_SECRET`. The
function uses the service role inside Supabase and hands back the backup,
report rows and one-hour download links for new photos. The service role key
never leaves Supabase. Migration 0038 lets the service role (and only it,
besides the CEO) take backups and run the jobs report.

## Setup (about 15 minutes)

1. **Database:** run `supabase/migrations/0038_drive_backup_access.sql` in
   the SQL Editor.
2. **Edge Function:** Supabase → Edge Functions → Deploy a new function → Via
   editor. Name it `drive-export`, paste
   `supabase/functions/drive-export/index.ts`, deploy. Then open its
   settings and turn **Verify JWT** off (the function checks
   `BACKUP_SECRET` itself, and the project's publishable key is not a JWT).
3. **Apps Script:** signed in to Google as the helpdesk account, open
   <https://script.google.com> → New project. Name it "ABSL Helpdesk backup",
   replace the code with `scripts/google-drive-backup.gs`, save.
4. Choose `setup` in the function list → Run → allow the permissions it asks
   for (Drive, Sheets, external requests, triggers). The execution log prints
   a long `BACKUP_SECRET`.
5. **Secret:** Supabase → Edge Functions → Secrets → add `BACKUP_SECRET` with
   that value. Don't paste it anywhere else.
6. Back in Apps Script, choose `runBackup` → Run. The first run fills the
   folder; if there is a lot, the next hourly runs finish it.
7. In Drive, share the `ABSL Helpdesk` folder with the CEO as **Viewer**.
   Don't share it by link: it holds customer details.

To change the secret later: delete the `BACKUP_SECRET` script property
(Project Settings → Script properties), run `setup` again and update the
Supabase secret.
