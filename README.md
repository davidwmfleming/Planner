# Planner

David's weekly planner: two pages a week (Mon–Wed, Thu–Sun), events on the left, tasks on the right, stored in a self-hosted CalDAV calendar so phones and computers stay in sync.

- What and why: [docs/spec.md](docs/spec.md)
- How it's built and the task list: [docs/design.md](docs/design.md)
- The clickable prototype the layout came from: [docs/prototype/index.html](docs/prototype/index.html)

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app locally |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests at tablet and phone sizes (Playwright) |
| `npm run lint` | Type and Svelte checks |
| `npm run test:scripts` | Backup script tests against a throwaway Docker volume (needs Docker, rsync and openssh-server; some checks need root or passwordless sudo) |
| `npm run calendar` | Start a local Radicale calendar server (needs `python3 -m pip install radicale`) |
| `npm run seed` | Fill it with sample entries from the paper page |

## Installing it on a device

Open the planner's address in the browser, then add it to the home screen: in Chrome on Android (the ViWoods), menu → **Add to home screen** / **Install app**; in Safari on iPhone, Share → **Add to Home Screen**. It then opens full-screen like any app. It needs the home server (over Tailscale) to show anything; there is no offline copy, because the calendar server is the one place the data lives.

## Work events

Work meetings are entered by hand into the **Work** calendar (created automatically on the calendar server): write the line as usual, open its details and choose **Calendar → Work**. Work events are shaded light red and tagged **Work**, and otherwise behave like any other event. Set `WORK_CALENDAR` in `.env` to use a different calendar name.

## Running it on the server (or a test VM)

The planner and its calendar server run in Docker (`compose.yaml`), reachable only over Tailscale with an https address from Tailscale Serve. All calendar data lives in the Compose volume `planner_data`, which the nightly backup covers. On a fresh Ubuntu Server with your user able to `sudo`:

```
curl -fsSO https://raw.githubusercontent.com/davidwmfleming/Planner/main/scripts/server-setup.sh
bash server-setup.sh            # add --sample on a test machine for the sample entries
```

The script installs Docker and Tailscale if needed (Tailscale prints a sign-in link the first time), puts the code in `/srv/planner`, writes `/srv/planner/.env` with a random calendar password, starts everything, and prints the planner's address and the calendar-app details. Run it again to update. In the Tailscale admin console, MagicDNS and HTTPS certificates must be on. Set `HTTPS_PORT` (for example `HTTPS_PORT=8443 bash server-setup.sh`) if another service already uses 443.

## Backups

Every night at 02:30 the server copies all the calendars, the planner's settings and the (hashed) calendar password into one file, `/srv/backups/planner/planner-YYYY-MM-DD.tar.gz`, and deletes copies older than 30 days. If the server was off at 02:30, the copy is made soon after it starts. The calendar server pauses for the second or two the copy takes, so no calendar is caught half-saved. `server-setup.sh` sets this up and makes the first copy straight away. If a copy is made a second time on one day (say, by hand), it is saved as `planner-YYYY-MM-DD-HHMMSS.tar.gz`; an existing copy is never replaced. Two backups never run at once; the second waits.

The copies and their folder belong to root. Your account can read them (through its group) but can't change or add anything there; no other account can see them.

The times and dates follow the server's clock, so set its time zone once: `timedatectl` shows it; if it doesn't say `America/Toronto`, run `sudo timedatectl set-timezone America/Toronto`.

- See when it last ran and when it runs next: `systemctl list-timers planner-backup.timer`
- Make a copy now: `sudo systemctl start planner-backup`, then `ls -l /srv/backups/planner`
- If it went wrong: `journalctl -u planner-backup`. Every problem starts with "Backup failed:", for example a full disk (check with `df -h /srv/backups`).
- Settings (folder, days kept): `/etc/default/planner-backup`. `server-setup.sh` never overwrites your edits. Days kept must be a whole number, 1 or more.

The copies don't include `.env`; `server-setup.sh` makes a new one with a new calendar password on a new machine.

### Copy on the Mac (and so in Proton Drive)

Each morning at 07:00 the Mac fetches any new copies from the server over Tailscale into a folder inside Proton Drive, which uploads them. If the Mac is asleep at 07:00 it fetches when it wakes, and it also fetches each time you log in. It only ever adds copies: an empty or broken server can't wipe the Mac's, and a copy the Mac already has is never replaced by a same-named one from the server. It removes its own nightly copies older than 30 days (only after a good fetch). Safety copies from a restore (`before-restore-*`) are kept on the Mac until you delete them, as on the server. If the newest copy on the Mac is more than 2 days old, a notification says so. The Mac uses its own ssh key, which the server only lets read the backup folder. This uses the server's normal ssh server (`openssh-server`, installed if missing), not Tailscale SSH: Tailscale SSH ignores the key's limit, so keep it off (`server-setup.sh` warns if it is on).

Adding the Mac's key also tightens the server's ssh server with `/etc/ssh/sshd_config.d/00-planner-backup.conf`: keys only (no passwords), no signing in as root, and only your account, only over Tailscale. **Any other account that signs in to the server by ssh, or signing in from the home network rather than Tailscale, stops working.** To keep one, add it to `SSH_ALLOW_USERS` in `/etc/default/planner-backup` (for example `SSH_ALLOW_USERS="alice"`) and run `server-setup.sh` again. The ssh server checks the new settings first and the old ones are put back if it rejects them. The firewall isn't touched (Home Assistant needs its ports on the home network). The first time, keep a Tailscale or console session to the server open until you have checked, from a new Terminal window, that you can still sign in.

Setting it up, once, in Terminal on the Mac (from a copy of this repository):

1. Install Homebrew's rsync (the one built into recent macOS doesn't work as well with the server): `brew install rsync`
2. Make the key: `ssh-keygen -t ed25519 -f ~/.ssh/planner-backup -N "" -C planner-backup`, then show it with `cat ~/.ssh/planner-backup.pub`.
3. On the server, in `/srv/planner`, run `MAC_BACKUP_KEY='<the line it showed>' bash scripts/server-setup.sh`. It adds the key, limited to reading the backups (or fixes the line if the key is already there), and tightens the ssh server as described above.
4. Copy the script and its settings file, then fill in the settings:
   ```
   mkdir -p ~/bin ~/.config
   cp scripts/mac/pull-backup.sh ~/bin/planner-pull-backup.sh
   cp scripts/mac/planner-backup.conf.example ~/.config/planner-backup.conf
   open -e ~/.config/planner-backup.conf
   ```
   In TextEdit, set `SERVER` (the server's Tailscale name, for example `homebase`), `SERVER_USER` (your account on it) and `PROTON_DRIVE` (Proton Drive's folder; `ls ~/Library/CloudStorage` shows its name), and save. The settings live there, not in the script, so copying a newer script later keeps them. If you change `KEEP_DAYS` on the server, keep the Mac's at least as high.
5. Try it: `bash ~/bin/planner-pull-backup.sh`. The copies should appear in Proton Drive under `Backups/planner`.
6. Schedule it:
   ```
   sed "s|/Users/YOURNAME|$HOME|g" scripts/mac/local.planner.pull-backup.plist > ~/Library/LaunchAgents/local.planner.pull-backup.plist
   plutil -lint ~/Library/LaunchAgents/local.planner.pull-backup.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.planner.pull-backup.plist
   ```
   It runs once straight away; check `~/Library/Logs/planner-pull-backup.log`. Saving into Proton Drive's folder normally needs no extra permission. Only if the log says "Can't save files in …" or "Operation not permitted": in System Settings → Privacy & Security → Full Disk Access, add `/opt/homebrew/bin/rsync` (the program that writes the copies; press ⌘⇧G in the file picker to type the path), then run `launchctl kickstart -k gui/$(id -u)/local.planner.pull-backup`. Don't add `/bin/bash` there: that would give every shell script full access to the Mac.

The log and the notifications say which side a problem is on: "couldn't reach" means the server or Tailscale (normal while you're away; you only hear about it once the newest copy is more than 2 days old), "couldn't save" or "Can't save files" means this Mac (often a full disk), and "some copies couldn't be fetched" means a file on the server couldn't be read. Unfinished downloads wait in `~/Library/Caches/planner-pull-backup`, outside Proton Drive, so Proton never uploads half a file.

To stop it: `launchctl bootout gui/$(id -u)/local.planner.pull-backup`.

### Putting a copy back

Pick the copy from the day you want (`ls /srv/backups/planner`), then:

```
cd /srv/planner
sudo bash scripts/restore.sh /srv/backups/planner/planner-2026-10-19.tar.gz
```

It shows what it will do and waits for you to type `yes`. Then it stops the planner, saves everything as it is right now in `/srv/backups/planner/before-restore-<date-time>.tar.gz`, replaces all calendars, tasks and settings with the copy, and starts the planner again. Anything added after that copy was made is gone from the planner but kept in the safety copy, so if you picked the wrong day, restore the safety copy the same way. Safety copies are never deleted automatically; remove them by hand when you no longer need them.

Phones and computers catch up on their next sync. If one still shows old items, remove the calendar account on it and add it again.

- **Copy kept on the Mac:** copy it back first, from the Proton Drive folder, then restore `/tmp/planner-2026-10-19.tar.gz` on the server:
  ```
  cd ~/Library/CloudStorage/ProtonDrive-*/Backups/planner
  scp planner-2026-10-19.tar.gz homebase:/tmp/
  ```
- **New machine:** run `server-setup.sh` first, then the restore. The calendar password is the new one in the new `.env`, so re-enter it on each phone.

## Syncing with other calendar apps

The planner's calendars can be added to Apple Calendar (Mac or iPhone), or to Android with DAVx⁵, as a CalDAV account. Events and tasks added on either side show on the other. The planner passes everything under `/dav/` to the calendar server, which asks for its own user name (`CALDAV_USER`, usually `david`) and password (`CALDAV_PASSWORD` in `.env`).

- **iPhone:** Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add CalDAV Account. Server: the planner's address without `https://`; then the user name and the calendar password.
- **Mac:** Calendar → Settings → Accounts → + → Other CalDAV Account. Account type: Manual; server address: `https://<planner address>/dav/`.
