#!/usr/bin/env bash
# Lets the Mac fetch the nightly backups over ssh (run by server-setup.sh; safe to run again):
#  - adds the Mac's key (MAC_BACKUP_KEY) to your ~/.ssh/authorized_keys, limited to reading the
#    backup folder with rrsync -ro, or fixes the line if the key is already there;
#  - installs the ssh server if it's missing, and tightens it with a settings file: keys only, no
#    root, and only BACKUP_OWNER (plus SSH_ALLOW_USERS), only from Tailscale addresses. sshd checks
#    the file first; if it rejects it, the previous settings are put back.
# Run as BACKUP_OWNER (your normal account); it asks for your password for the sudo steps.
# Settings: /etc/default/planner-backup. The PLANNER_SSHD_* variables are for the tests.
set -euo pipefail

CONFIG="${PLANNER_BACKUP_CONFIG:-/etc/default/planner-backup}"
SSHD_CONFIG="${PLANNER_SSHD_CONFIG:-/etc/ssh/sshd_config}"
SSHD_DIR="${PLANNER_SSHD_DIR:-/etc/ssh/sshd_config.d}"
# 00- so it comes before other files there (sshd keeps the first value it reads, and Ubuntu's
# 50-cloud-init.conf may turn passwords on).
DROPIN="$SSHD_DIR/00-planner-backup.conf"
TAILSCALE_ADDRESSES="100.64.0.0/10 fd7a:115c:a1e0::/48"

die() { echo "Stopped: $1" >&2; exit 1; }

# Read the settings the way backup.sh does (so quotes work), then check them.
SETTINGS=()
while IFS= read -r -d '' value; do SETTINGS+=("$value"); done < <(
	# shellcheck disable=SC2016 # expanded by the inner bash
	bash -c '[ ! -f "$1" ] || . "$1" >/dev/null 2>&1; printf "%s\0" "${BACKUP_DIR:-}" "${BACKUP_OWNER:-}" "${SSH_ALLOW_USERS:-}"' _ "$CONFIG"
)
BACKUP_DIR=${SETTINGS[0]:-/srv/backups/planner}
BACKUP_DIR=${BACKUP_DIR%/}
OWNER=${SETTINGS[1]:-$(id -un)}
ALLOW_EXTRA=${SETTINGS[2]:-}
[[ $BACKUP_DIR =~ ^/[A-Za-z0-9._/-]+$ && ! $BACKUP_DIR =~ (^|/)\.\.?(/|$) ]] ||
	die "BACKUP_DIR in $CONFIG must be a full path made of letters, digits and . _ - /"
[ "$OWNER" = "$(id -un)" ] || die "run this as $OWNER (BACKUP_OWNER in $CONFIG), the account the Mac signs in as."
ALLOW="" # sshd AllowUsers patterns: USER or USER@HOST (HOST may be an address/bits or use * and ?)
for t in $TAILSCALE_ADDRESSES; do ALLOW="$ALLOW $OWNER@$t"; done
[[ $ALLOW_EXTRA != *$'\n'* ]] || die "SSH_ALLOW_USERS in $CONFIG must be on one line."
read -ra EXTRAS <<<"$ALLOW_EXTRA" # split on spaces, without expanding * and ?
for extra in "${EXTRAS[@]}"; do
	[[ $extra =~ ^[A-Za-z0-9._*?-]+(@[A-Za-z0-9.:/*?_-]+)?$ ]] || die "SSH_ALLOW_USERS in $CONFIG: '$extra' isn't an account name (or name@address)."
	ALLOW="$ALLOW $extra"
done
KEY_OPTIONS="restrict,command=\"rrsync -ro $BACKUP_DIR\""

# ---- The Mac's key ------------------------------------------------------------------------------
if [ -z "${MAC_BACKUP_KEY:-}" ]; then
	echo "To let the Mac fetch the copies, run server-setup.sh again with the Mac's key (see the README):"
	echo "  MAC_BACKUP_KEY='<contents of planner-backup.pub from the Mac>' bash scripts/server-setup.sh"
else
	# Exactly one public key on one line: type, key, and an optional comment of plain words. No
	# options and no quotes, so it can't add its own; a second line would be a key without the limit.
	KEY_PATTERN='^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) ([A-Za-z0-9+/]+=*)( [A-Za-z0-9@._-]+)*$'
	[[ $MAC_BACKUP_KEY =~ $KEY_PATTERN ]] || die "MAC_BACKUP_KEY should be the one line in the Mac's ~/.ssh/planner-backup.pub"
	BLOB=${BASH_REMATCH[3]}
	LINE="$KEY_OPTIONS $MAC_BACKUP_KEY"
	AK=~/.ssh/authorized_keys
	install -d -m 700 ~/.ssh
	touch "$AK"
	chmod 600 "$AK"
	# Lines that hold this key, whatever options or comment they have.
	# shellcheck disable=SC2016 # awk's own $i
	FIND='{ for (i = 1; i <= NF; i++) if ($i == blob) { found = 1; break } }'
	HAVE=$(awk -v blob="$BLOB" "$FIND"' found { n++ } { found = 0 } END { print n + 0 }' "$AK")
	if [ "$HAVE" = 1 ] && grep -qxF "$LINE" "$AK"; then
		echo "The Mac's key is already in ~/.ssh/authorized_keys, limited to reading $BACKUP_DIR"
	else
		NEW=$(mktemp ~/.ssh/authorized_keys.XXXXXX)
		awk -v blob="$BLOB" "$FIND"' !found { print } { found = 0 }' "$AK" >"$NEW"
		echo "$LINE" >>"$NEW"
		cat "$NEW" >"$AK" # keeps the file itself (and its permissions)
		rm -f "$NEW"
		if [ "$HAVE" = 0 ]; then
			echo "Added the Mac's key to ~/.ssh/authorized_keys (it can only read $BACKUP_DIR)"
		else
			echo "Updated the Mac's key in ~/.ssh/authorized_keys: it can now only read $BACKUP_DIR"
		fi
	fi
	command -v rrsync >/dev/null || echo "Warning: rrsync is missing, so the Mac's key won't work. It comes with rsync 3.2.4 or later."
fi

# ---- The ssh server -----------------------------------------------------------------------------
# Only once the Mac is being set up (and on later runs, to keep the settings current).
[ -n "${MAC_BACKUP_KEY:-}" ] || [ -e "$DROPIN" ] || exit 0

SSHD=$(command -v sshd || echo /usr/sbin/sshd)
if [ ! -x "$SSHD" ]; then
	echo "Installing the ssh server (openssh-server)"
	sudo apt-get install -y -qq openssh-server >/dev/null
fi

cat <<EOF

Tightening the ssh server ($DROPIN): keys only (no passwords), no root,
and only these may sign in:$ALLOW
WARNING: any other account that signs in to this server by ssh is now refused, and so is
signing in from outside Tailscale (for example from the home network). To let an account in,
add it to SSH_ALLOW_USERS in $CONFIG (for example SSH_ALLOW_USERS="alice")
and run server-setup.sh again. Sessions already open stay open: keep this one open until you have checked,
from a new Terminal window, that you can still sign in.
EOF
CONTENT="# Written by the planner's scripts/backup-access.sh (run by server-setup.sh), which rewrites it.
# To let another account sign in by ssh, add it to SSH_ALLOW_USERS in $CONFIG
# and run server-setup.sh again.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers$ALLOW"

HAD_BEFORE=no
if sudo test -e "$DROPIN"; then
	HAD_BEFORE=yes
	BEFORE=$(sudo cat "$DROPIN")
fi
sudo install -d -m 755 "$SSHD_DIR"
printf '%s\n' "$CONTENT" | sudo tee "$DROPIN" >/dev/null
sudo chmod 644 "$DROPIN"
# sshd -t needs its privilege separation folder, which only exists once sshd has run.
[ -d /run/sshd ] || sudo install -d -m 755 /run/sshd
if ! sudo "$SSHD" -t -f "$SSHD_CONFIG"; then
	if [ "$HAD_BEFORE" = yes ]; then printf '%s\n' "$BEFORE" | sudo tee "$DROPIN" >/dev/null; else sudo rm -f "$DROPIN"; fi
	die "the ssh server rejected these settings (see above), so the previous ones were put back. Nothing was reloaded."
fi
EFFECTIVE=$(sudo "$SSHD" -T -f "$SSHD_CONFIG" 2>/dev/null || true)
grep -qx "allowusers $OWNER@100.64.0.0/10" <<<"$EFFECTIVE" ||
	echo "Warning: the ssh server doesn't read $SSHD_DIR (no 'Include $SSHD_DIR/*.conf' in $SSHD_CONFIG), so these settings have no effect."
grep -qx "passwordauthentication no" <<<"$EFFECTIVE" ||
	echo "Warning: another file in $SSHD_DIR still turns passwords on; look for PasswordAuthentication there."
# Reload if it's running; with Ubuntu's ssh.socket, the next connection starts it with these settings.
sudo systemctl try-reload-or-restart ssh
echo "The ssh server now uses these settings."

systemctl is-active --quiet ssh.socket || systemctl is-active --quiet ssh ||
	echo "Warning: the ssh server isn't running, so the Mac can't fetch the copies. Start it with: sudo systemctl enable --now ssh"
# Tailscale SSH answers ssh over Tailscale itself and ignores the key's limit above.
if command -v tailscale >/dev/null &&
	sudo tailscale debug prefs 2>/dev/null | python3 -I -c 'import json, sys; sys.exit(0 if json.load(sys.stdin).get("RunSSH") else 1)' 2>/dev/null; then
	echo "Warning: Tailscale SSH is on. It ignores the limit on the Mac's key; turn it off with"
	echo "  sudo tailscale set --ssh=false"
	echo "from a session that isn't itself Tailscale SSH (for example the console)."
fi
