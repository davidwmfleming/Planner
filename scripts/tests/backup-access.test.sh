#!/usr/bin/env bash
# Checks scripts/backup-access.sh: the Mac's key line in authorized_keys, and the ssh server
# settings file it adds. Runs the real sshd -t / -T against a test sshd_config; sudo, systemctl
# and apt-get are stand-ins that run or record the command. No Docker needed.
set -uo pipefail
# shellcheck source=scripts/tests/helpers.sh
. "$(dirname "$0")/helpers.sh"

SSHD=$(command -v sshd || echo /usr/sbin/sshd)
[ -x "$SSHD" ] || { echo "sshd (openssh-server) is needed for this test"; exit 1; }
ME=$(id -un)
export HOME="$WORK/home"
mkdir -p "$HOME" "$WORK/bin" "$WORK/sshd_config.d"
# sshd -t needs /run/sshd, which exists only once sshd has run. Make it with the real sudo (CI runs as a
# normal account with passwordless sudo) before sudo is replaced by a stand-in below.
[ -d /run/sshd ] || sudo install -d -m 755 /run/sshd
printf '#!/bin/sh\nexec "$@"\n' >"$WORK/bin/sudo"
printf '#!/bin/sh\necho "$*" >>"%s/systemctl.log"\n' "$WORK" >"$WORK/bin/systemctl"
printf '#!/bin/sh\necho "$*" >>"%s/apt.log"\n' "$WORK" >"$WORK/bin/apt-get"
chmod +x "$WORK/bin/"*
ssh-keygen -q -t ed25519 -N "" -f "$WORK/hostkey"
cat >"$WORK/sshd_config" <<EOF
Include $WORK/sshd_config.d/*.conf
HostKey $WORK/hostkey
EOF
cat >"$WORK/config" <<EOF
BACKUP_DIR=/srv/backups/planner
BACKUP_OWNER=$ME
EOF
export PLANNER_BACKUP_CONFIG="$WORK/config" PLANNER_SSHD_CONFIG="$WORK/sshd_config" PLANNER_SSHD_DIR="$WORK/sshd_config.d"
AK="$HOME/.ssh/authorized_keys"
DROPIN="$WORK/sshd_config.d/00-planner-backup.conf"
access() { # access KEY: runs the script with MAC_BACKUP_KEY=KEY (none if empty)
	rm -f "$WORK/systemctl.log"
	PATH="$WORK/bin:$PATH" MAC_BACKUP_KEY="$1" bash "$REPO/scripts/backup-access.sh" >"$WORK/out" 2>&1
}
lines_with() { grep -cF "$1" "$AK"; }

echo "== Without the Mac's key, nothing changes"
access "" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "it says how to add the key" grep -q "MAC_BACKUP_KEY=" "$WORK/out"
check "no ssh server settings are written" test ! -e "$DROPIN"

echo "== The key made exactly as the README says is added, limited to reading the backups"
ssh-keygen -q -t ed25519 -f "$WORK/planner-backup" -N "" -C "planner backup" # the comment has a space
KEY=$(cat "$WORK/planner-backup.pub")
BLOB=$(cut -d' ' -f2 <<<"$KEY")
mkdir -p "$HOME/.ssh"
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyOfDavidsLaptop laptop" >"$AK"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "the key line is restricted to rrsync -ro on the backup folder" \
	grep -qxF "restrict,command=\"rrsync -ro /srv/backups/planner\" $KEY" "$AK"
check "the other key is left alone" grep -q "laptop" "$AK"
check "authorized_keys stays private" test "$(stat -c %a "$AK")" = 600
access "$KEY" || bad "running again exits cleanly"
check "running again says it is already there" grep -q "already" "$WORK/out"
check "and doesn't add it twice" test "$(lines_with "$BLOB")" = 1

echo "== Anything but one plain public key is refused"
for evil in "$KEY"$'\n'"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISecond" \
	"command=\"sh\" $KEY" "$KEY\" ,command=\"sh" "ssh-ed25519 $BLOB a\"b"; do
	if access "$evil"; then bad "refuses $(head -c 40 <<<"$evil")"; else ok "refuses $(head -c 40 <<<"$evil")"; fi
done
check "authorized_keys is unchanged by refused keys" test "$(wc -l <"$AK")" = 2

echo "== A key pasted with spaces or a newline at the end (as Terminal copies it) is accepted"
access "$KEY"$'\n' || { cat "$WORK/out"; bad "a key with a trailing newline is accepted"; }
access "$KEY  " || { cat "$WORK/out"; bad "a key with trailing spaces is accepted"; }
check "there is still exactly one line for the key" test "$(lines_with "$BLOB")" = 1
check "and it is the limited one" grep -qxF "restrict,command=\"rrsync -ro /srv/backups/planner\" $KEY" "$AK"

echo "== An update run without the key doesn't ask for the key that is already there"
access "" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "it doesn't ask for the Mac's key" not grep -q "MAC_BACKUP_KEY=" "$WORK/out"
check "it says the key is set up" grep -q "Mac's key is already" "$WORK/out"

echo "== A key already there without the limit is limited, not left as it was"
grep -vF "$BLOB" "$AK" >"$WORK/ak" && cat "$WORK/ak" >"$AK"
echo "$KEY" >>"$AK"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "the unlimited line is gone" not grep -qxF "$KEY" "$AK"
check "the limited line replaces it" grep -qxF "restrict,command=\"rrsync -ro /srv/backups/planner\" $KEY" "$AK"
check "it says it changed the line" grep -q "Updated" "$WORK/out"
check "the other key is still there" grep -q "laptop" "$AK"

echo "== A quoted or changed BACKUP_DIR updates the line"
sed -i 's|^BACKUP_DIR=.*|BACKUP_DIR="/srv/other/planner/"|' "$WORK/config"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "the line points at the new folder" grep -qxF "restrict,command=\"rrsync -ro /srv/other/planner\" $KEY" "$AK"
check "there is still exactly one line for the key" test "$(lines_with "$BLOB")" = 1
sed -i 's|^BACKUP_DIR=.*|BACKUP_DIR="/srv/x\\" evil"|' "$WORK/config"
if access "$KEY"; then bad "a BACKUP_DIR with odd characters is refused"; else ok "a BACKUP_DIR with odd characters is refused"; fi
check "the line is unchanged" grep -qxF "restrict,command=\"rrsync -ro /srv/other/planner\" $KEY" "$AK"
sed -i 's|^BACKUP_DIR=.*|BACKUP_DIR=/srv/backups/planner|' "$WORK/config"

echo "== The ssh server: keys only, no root, only $ME and only over Tailscale"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "the settings file is written" test -f "$DROPIN"
"$SSHD" -T -f "$WORK/sshd_config" >"$WORK/effective" 2>&1 || { cat "$WORK/effective"; bad "sshd accepts the settings"; }
for want in "passwordauthentication no" "kbdinteractiveauthentication no" "permitrootlogin no" \
	"allowusers $ME@100.64.0.0/10" "allowusers $ME@fd7a:115c:a1e0::/48"; do
	check "sshd now has: $want" grep -qx "$want" "$WORK/effective"
done
check "only those two AllowUsers entries" test "$(grep -c '^allowusers' "$WORK/effective")" = 2
check "the ssh server is reloaded" grep -q "reload.* ssh" "$WORK/systemctl.log"
check "it warns that other accounts can no longer sign in by ssh" grep -q "SSH_ALLOW_USERS" "$WORK/out"
check "and to keep a session open" grep -qi "keep .*open" "$WORK/out"

echo "== SSH_ALLOW_USERS lets other accounts in; anything odd in it is refused"
echo 'SSH_ALLOW_USERS="alice bob@192.168.1.*"' >>"$WORK/config"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
"$SSHD" -T -f "$WORK/sshd_config" >"$WORK/effective" 2>&1
check "alice may sign in" grep -qx "allowusers alice" "$WORK/effective"
check "bob may sign in from the home network" grep -qx "allowusers bob@192.168.1.\*" "$WORK/effective"
cp "$DROPIN" "$WORK/dropin-before"
sed -i '$d' "$WORK/config"
printf 'SSH_ALLOW_USERS="alice\nPermitRootLogin yes"\n' >>"$WORK/config"
if access "$KEY"; then bad "a setting that spans lines is refused"; else ok "a setting that spans lines is refused"; fi
check "the ssh settings are unchanged" cmp -s "$WORK/dropin-before" "$DROPIN"
sed -i '/SSH_ALLOW_USERS/,$d' "$WORK/config"
for wild in '*' '*@100.64.0.0/10' '?*'; do
	echo "SSH_ALLOW_USERS='$wild'" >>"$WORK/config"
	if access "$KEY"; then bad "SSH_ALLOW_USERS='$wild' (any account) is refused"; else ok "SSH_ALLOW_USERS='$wild' (any account) is refused"; fi
	sed -i '$d' "$WORK/config"
done
check "the ssh settings are unchanged" cmp -s "$WORK/dropin-before" "$DROPIN"

echo "== Accounts let in by another ssh settings file are pointed out"
echo "AllowUsers mallory" >"$WORK/sshd_config.d/50-other.conf"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "it warns about the other account" grep -q "Warning: .*mallory" "$WORK/out"
rm -f "$WORK/sshd_config.d/50-other.conf"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
check "and says nothing when there are none" not grep -q "mallory" "$WORK/out"

echo "== If sshd rejects the result, the old settings are put back and nothing is reloaded"
access "$KEY" || { cat "$WORK/out"; bad "backup-access.sh exits cleanly"; }
cp "$DROPIN" "$WORK/dropin-before"
echo "SSH_ALLOW_USERS=carol" >>"$WORK/config"
echo "NoSuchOption yes" >>"$WORK/sshd_config"
if access "$KEY"; then bad "it fails"; else ok "it fails"; fi
check "the earlier settings file is back" cmp -s "$WORK/dropin-before" "$DROPIN"
check "the ssh server is not reloaded" test ! -s "$WORK/systemctl.log"
check "it says the settings were put back" grep -qi "put back" "$WORK/out"
sed -i '$d' "$WORK/sshd_config"
rm -f "$DROPIN"
echo "NoSuchOption yes" >>"$WORK/sshd_config"
if access "$KEY"; then bad "it fails the first time too"; else ok "it fails the first time too"; fi
check "no settings file is left" test ! -e "$DROPIN"
sed -i '$d' "$WORK/sshd_config"

echo "== Passwords stay on while the Mac's key is the only way in (so David can't lock himself out)"
rm -f "$DROPIN"
grep -F "$BLOB" "$AK" >"$WORK/ak" && cat "$WORK/ak" >"$AK" # only the Mac's limited key is left
if access "$KEY"; then bad "it stops"; else ok "it stops"; fi
check "no ssh server settings are written" test ! -e "$DROPIN"
check "it says to add a key of your own with ssh-copy-id first" grep -q "ssh-copy-id" "$WORK/out"
check "the Mac's key is still added" test "$(lines_with "$BLOB")" = 1
echo "# a comment" >>"$AK"
echo "restrict,command=\"rrsync -ro /srv/old\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOldMacKey old" >>"$AK"
if access "$KEY"; then bad "comments and other backup-only keys don't count"; else ok "comments and other backup-only keys don't count"; fi
SSH_I_HAVE_ANOTHER_WAY_IN=yes access "$KEY" || { cat "$WORK/out"; bad "SSH_I_HAVE_ANOTHER_WAY_IN=yes goes ahead"; }
check "with SSH_I_HAVE_ANOTHER_WAY_IN=yes the settings are written" test -f "$DROPIN"
rm -f "$DROPIN"
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyOfDavidsLaptop laptop" >>"$AK"
access "$KEY" || { cat "$WORK/out"; bad "with a key of David's own it goes ahead"; }
check "with a key of David's own the settings are written" test -f "$DROPIN"

echo "== The README's key-making command and server-setup.sh"
check "the README says to run ssh-copy-id before adding the Mac's key" \
	awk '/ssh-copy-id/ && !c { c = NR } /MAC_BACKUP_KEY=/ && !m { m = NR } END { exit !(c && m && c < m) }' "$REPO/README.md"
check "the README says how to undo the ssh settings from the console" grep -q "rm /etc/ssh/sshd_config.d/00-planner-backup.conf" "$REPO/README.md"
check "the README makes the key with a one-word comment" grep -q 'ssh-keygen -t ed25519 -f ~/.ssh/planner-backup -N "" -C planner-backup' "$REPO/README.md"
check "server-setup.sh runs backup-access.sh" grep -q "bash scripts/backup-access.sh" "$REPO/scripts/server-setup.sh"

finish
