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
| `npm run test:e2e` | Browser tests at tablet and phone sizes (Playwright); tests that change the Work or new-event choice run last, on their own |
| `npm run lint` | Type and Svelte checks |
| `npm run test:scripts` | Backup script tests against a throwaway Docker volume (needs Docker, rsync and openssh-server; some checks need root or passwordless sudo) |
| `npm run calendar` | Start a local Radicale calendar server (needs `python3 -m pip install radicale`) |
| `npm run seed` | Fill it with sample entries from the paper page |

## Installing it on a device

Open the planner's address in the browser, then add it to the home screen: in Chrome on Android (the ViWoods), menu → **Add to home screen** / **Install app**; in Safari on iPhone, Share → **Add to Home Screen**. It then opens full-screen like any app. With no browser buttons there, every message that says to reload has a **Reload** button, and a page that can't be shown offers **Reload** and **Back to the planner**. It needs the home server (over Tailscale) to show anything; there is no offline copy, because the calendar server is the one place the data lives.

Left open overnight (the tablet asleep with the planner on screen), the page moves on to the new day by itself, at midnight or when the screen wakes: a page showing today turns to the new today's page, with unfinished tasks carried over; a page you turned to on purpose stays where it is. It waits while a line is being written or saved, and says so under the header. If the server can't be reached just then (Wi-Fi still reconnecting), the page stays as it is and tries again a minute later.

## Work events

Work meetings are entered by hand into the **Work** calendar (created automatically on the calendar server): write the line as usual, open its details and choose **Calendar → Work**. Work events are shaded light red and tagged **Work**, and otherwise behave like any other event. Every other event, and every task in a list other than Tasks, has a small tag with the first 4 letters of its calendar's name (**Fami** for Family); screen readers read the full name, and tapping the tag opens the item like tapping its title. A task in another list says which list in its details. When two calendars start the same way, their tags get up to 6 letters (**Worko** for Workouts beside **Work**); calendars still alike after that are numbered (**Swim 1**, **Swim 2**). The Work calendar is always tagged **Work**, whatever it is called, and a calendar with no name is tagged **Cal**. Tasks in the main Tasks list have no tag. On a narrow phone the tag goes under the title, so the title keeps the row. Which calendar counts as Work, and which one new events go in (**Me** at first), are chosen on the Settings page and kept in the planner's settings on the calendar server, so they still apply after a calendar is renamed. `WORK_CALENDAR` and `EVENTS_CALENDAR` in `.env` only fill these in the first time the planner starts.

The starting calendars (Me, Family, Workouts, Morgan Meals, Work and the Tasks list) are made only on a first run: when the calendar server says there is no Tasks list at its usual address (`tasks/`) and there are no event calendars. So a calendar deleted on a phone stays deleted, even if the calendar server briefly lists nothing. The planner finds the Tasks list by that address, so renaming it in Reminders doesn't confuse it.

## Settings

The gear at the top of the planner opens **Settings**, which lists the event calendars, the Tasks list and the task categories, and shows which calendar is shaded as Work and where new events go. **Add** makes a new event calendar, and **Rename** changes a calendar's name; phones that sync it pick up the new name on their next sync. A name can be up to 40 letters and can't match another calendar or list (capitals don't count); letters are counted as you see them (an emoji is one), and invisible and control characters are removed, except a non-joiner inside a word. Calendars are listed by name; two with the same name (made on a phone, say) are told apart by the end of their address, for example **Family (family-2)**. After **Add** the cursor stays in the name box for the next one; after **Rename**, **Cancel** or Escape it goes back to that calendar's Rename button, and screen readers announce what changed. **Delete** first says how many items the calendar holds, then offers **Move them to** another calendar or **Delete them too**; nothing is chosen for you, and a confirm button appears on the page once you choose. Deleting removes the calendar from every phone and computer that syncs it, including anyone it is shared with (the nightly backup can bring it back). A move copies each item unchanged, repeats and one-off changes included, then removes the original; the calendar itself is deleted only once it is empty. If a move stops partway, the calendar stays with what is left, the page names the items that didn't move and why, shows the new count, and deleting it again finishes the job. An item that may have ended up in two calendars (because it was changed, moved or deleted on another device during the move) is named, so you can delete the copy you don't want. If anything in the calendar changed after the count was shown (on a phone, say), nothing is moved or deleted and the page shows the new count. Once a delete is under way it can't be cancelled, so Cancel goes away until it is done; **Cancel** or Escape closes the confirm before that. The last event calendar can't be deleted. If the deleted calendar was Work, Work becomes None; if new events went in it, they go in the first calendar left by name. If every event calendar is deleted on another device, the planner still opens and points to Settings. The Tasks list can't be renamed or deleted, since every task and the settings live there. Below the calendars, **Show as work (light red)** picks the calendar shaded as Work (or None), and **New events go in** picks where a line written in the events column is saved; **Save choices** stores both. **‹ Planner** at the top leads back, which matters in the installed app, where there is no browser back button.

**Task categories** (This month, Waiting, Someday at first) are listed in the order the Future tasks list and the details sheet's **List** menu use. **Add** puts a new one at the end (up to 50); a name follows the calendar-name rules and also can't contain a comma, since other apps read commas as separators. **Rename** changes the name on the list and on every task that has it, in every list, whole repeating series included, so phones show the new name too. It works in three steps: the new name is added next to the old one, each task is given the new name (a task changed on a phone meanwhile is left alone, never overwritten), and only then does the old name come off the list. If it stops partway (the calendar server stops answering, or a task changed on a phone), both names stay on the list, the page says how many tasks have the new name, and **Finish renaming** next to the old name finishes the job; no other category can be renamed until then. **Delete** first says how many tasks have the category (a repeating task counts once), then offers **Move them to** another category or **No list**, with a confirm button on the page; **Cancel** or Escape closes it. A category is only a label, so deleting one never deletes a task: with No list, its tasks stay on Future tasks (or on their day) without a category, and any categories other apps gave them are kept. The name comes off the list only once every task has changed; if it stops partway, the page says how far it got and deleting it again finishes the job.

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

The times and dates follow the server's clock, so set its time zone once: `timedatectl` shows it; if it doesn't say `America/Halifax`, run `sudo timedatectl set-timezone America/Halifax`.

- See when it last ran and when it runs next: `systemctl list-timers planner-backup.timer`
- Make a copy now: `sudo systemctl start planner-backup`, then `ls -l /srv/backups/planner`
- If it went wrong: `journalctl -u planner-backup`. Every problem starts with "Backup failed:", for example a full disk (check with `df -h /srv/backups`). "Backup failed: stopped" means the copy was stopped part-way (by hand, a shutdown or the 30-minute limit); nothing was saved and the calendar server carried on.
- If phones and computers have stopped syncing right after a backup (the calendar server was left paused, which only happens if the server lost power mid-copy): `sudo systemctl start planner-backup`. It resumes a paused calendar server and makes a copy.
- Settings (folder, days kept): `/etc/default/planner-backup`. `server-setup.sh` never overwrites your edits. Days kept must be a whole number, 1 or more.

The copies don't include `.env`; `server-setup.sh` makes a new one with a new calendar password on a new machine.

### Copy on the Mac (and so in Proton Drive)

Each morning at 07:00 the Mac fetches any new copies from the server over Tailscale into a folder inside Proton Drive, which uploads them. If the Mac is asleep at 07:00 it fetches when it wakes, and it also fetches each time you log in. It only ever adds copies: an empty or broken server can't wipe the Mac's, and a copy the Mac already has is never replaced by a same-named one from the server. It removes its own nightly copies older than 30 days (only after a good fetch). Safety copies from a restore (`before-restore-*`) are kept on the Mac until you delete them, as on the server. If the newest copy on the Mac is more than 2 days old, a notification says so. The Mac uses its own ssh key, which the server only lets read the backup folder. This uses the server's normal ssh server (`openssh-server`, installed if missing), not Tailscale SSH: Tailscale SSH ignores the key's limit, so keep it off (`server-setup.sh` warns if it is on).

Adding the Mac's key also tightens the server's ssh server with `/etc/ssh/sshd_config.d/00-planner-backup.conf`: keys only (no passwords), no signing in as root, and only your account, only over Tailscale. **Any other account that signs in to the server by ssh, or signing in from the home network rather than Tailscale, stops working.** To keep one, add it to `SSH_ALLOW_USERS` in `/etc/default/planner-backup` (for example `SSH_ALLOW_USERS="alice"`) and run `server-setup.sh` again. The ssh server checks the new settings first and the old ones are put back if it rejects them. The firewall isn't touched (Home Assistant needs its ports on the home network). The first time, keep a Tailscale or console session to the server open until you have checked, from a new Terminal window, that you can still sign in.

Setting it up, once, in Terminal on the Mac (from a copy of this repository):

1. Install Homebrew's rsync (the one built into recent macOS doesn't work as well with the server): `brew install rsync`
2. Make the key: `ssh-keygen -t ed25519 -f ~/.ssh/planner-backup -N "" -C planner-backup`, then show it with `cat ~/.ssh/planner-backup.pub`.
3. Make sure you can still sign in once passwords are off: give the server a key of your own (not the backup key, which can only read the backups). If `ls ~/.ssh/id_*.pub` shows nothing, make one with `ssh-keygen -t ed25519`. Then run `ssh-copy-id david@homebase` (your account and the server's Tailscale name; it asks for your password one last time), and check that `ssh david@homebase` now signs in without asking for it. `server-setup.sh` refuses to turn passwords off until your account has such a key. If you only ever use the server's console, not ssh, put `SSH_I_HAVE_ANOTHER_WAY_IN=yes` in front of the command in the next step instead.
4. On the server, in `/srv/planner`, run `MAC_BACKUP_KEY='<the line step 2 showed>' bash scripts/server-setup.sh`. It adds the key, limited to reading the backups (or fixes the line if the key is already there), and tightens the ssh server as described above. Keep that session open and check, from a new Terminal window, that `ssh david@homebase` still works. If it doesn't, sign in at the server's own screen and keyboard (or in a session that is still open) and put the old settings back:
   ```
   sudo rm /etc/ssh/sshd_config.d/00-planner-backup.conf
   sudo systemctl reload ssh
   ```
   Then sort out the key (step 3) and run step 4 again.
5. Copy the script and its settings file, then fill in the settings:
   ```
   mkdir -p ~/bin ~/.config
   cp scripts/mac/pull-backup.sh ~/bin/planner-pull-backup.sh
   cp scripts/mac/planner-backup.conf.example ~/.config/planner-backup.conf
   open -e ~/.config/planner-backup.conf
   ```
   In TextEdit, set `SERVER` (the server's Tailscale name, for example `homebase`), `SERVER_USER` (your account on it) and `PROTON_DRIVE` (Proton Drive's folder; `ls ~/Library/CloudStorage` shows its name), and save. The settings live there, not in the script, so copying a newer script later keeps them. If you change `KEEP_DAYS` on the server, keep the Mac's at least as high.
6. Try it: `bash ~/bin/planner-pull-backup.sh`. The copies should appear in Proton Drive under `Backups/planner`.
7. Schedule it:
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

## Shared calendar links

To subscribe to a calendar from a computer that isn't on your Tailscale (a work computer, or Google Calendar or Outlook), open the settings page and press **Share** next to the calendar under **Shared links**. Copy its link and paste it into the other app's "subscribe to calendar" or "add calendar from URL". The app then checks for changes every so often (Google every few hours, others more often). Anyone who has the link can read everything in that calendar, but nobody can change anything through it. **New link** makes a fresh link and **Stop sharing** removes it; either way the old link stops working at once. Task lists can't be shared, because calendar subscriptions show only events.

If the other computer can run Tailscale, that is the better route, because nothing is public: sign it in to your Tailscale account, or [share the server](https://tailscale.com/kb/1084/sharing) with the other person's Tailscale account, and add the calendar over CalDAV as above.

The links are published from the internet with [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) by a small Tailscale machine of their own, `planner-share` (the `share` service in `compose.yaml`), so they read `https://planner-share.<your tailnet>.ts.net/feed/...`. It publishes only the `/feed` address; the planner, CalDAV and everything else on the server stay on your tailnet only, and no port is opened on the router. The planner also refuses anything but a shared link from a request that came through Funnel.

To turn it on, once:

1. In the Tailscale admin console, open **Access controls** and add the lines below to the policy file (merge them into `tagOwners` and `nodeAttrs` if those are already there; the `funnel` line may already exist for `autogroup:member`, in which case add the tag to its `target`). Then, in the rule that lets everyone reach everything (`"src": ["*"]`), change `"*"` in `src` to `"autogroup:member"`, so planner-share, which faces the internet, can't reach your other machines. If you have other tagged machines that need to reach things, give them their own rule. Save.
   ```json
   "tagOwners": { "tag:planner-share": ["autogroup:admin"] },
   "nodeAttrs": [{ "target": ["tag:planner-share"], "attr": ["funnel"] }],
   ```
2. Open **Settings → Keys** and **Generate auth key**: leave **Reusable** off, turn **Tags** on and pick `tag:planner-share`; a 1-day expiry is fine. Copy it.
3. On the server, run the line below, **starting it with a space** so the key isn't saved in your shell history. The key is kept in `.env` (readable only by you), so later runs don't need it.
   ```
    SHARE_AUTHKEY=tskey-auth-... bash /srv/planner/scripts/server-setup.sh
   ```
4. If `sudo docker compose logs share` says Funnel isn't enabled, open the link it gives, allow Funnel, and run `sudo docker compose restart share`.

A tagged machine's key never expires, so there is nothing to renew.

Until it's on, the settings page says shared links aren't turned on. To turn sharing off entirely, remove the `SHARE_AUTHKEY=` line from `.env`, run the setup script again, then `sudo docker compose --profile share rm -sf share` and remove `planner-share` in the admin console. If the `share-state` volume is ever lost, remove the old `planner-share` machine in the admin console first and run the script with a new tagged key, so the name (and so every link) stays the same.

## Downloading everything

**Download everything (.ics)**, in the Export section of the settings page (the gear at the top of the planner), saves `planner-export-YYYY-MM-DD.zip` with one .ics file per calendar (`Me.ics`, `Family.ics`, `Tasks.ics` and so on). Unzip it and import each .ics file on its own, into the calendar it should go in: Apple Calendar and Google Calendar both take one .ics file at a time, not the zip. They ignore the tasks in `Tasks.ics`, which Thunderbird and CalDAV task apps can import. In the app installed on a phone's home screen, the zip opens the share sheet instead (Save to Files, for example). If a calendar can't be fetched, the page says which one and nothing is saved; try again in a moment.
