#!/bin/sh
# Writes the calendar user from the environment (password stored hashed), then starts Radicale.
set -eu
: "${CALDAV_USER:?Set CALDAV_USER in .env}"
: "${CALDAV_PASSWORD:?Set CALDAV_PASSWORD in .env}"
case "$CALDAV_USER" in
	*[!A-Za-z0-9._-]*) echo "CALDAV_USER may only use letters, digits, dot, dash and underscore" >&2; exit 1 ;;
esac
umask 077
python3 -c 'import os; from passlib.hash import sha512_crypt; print(os.environ["CALDAV_USER"] + ":" + sha512_crypt.hash(os.environ["CALDAV_PASSWORD"]))' > /data/users
exec python3 -m radicale --config /etc/radicale/config
