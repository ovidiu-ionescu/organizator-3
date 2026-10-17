#!/usr/bin/bash
#
# Read a memo and every version of it, which the server answers only to the memo's owner.
#
# Both services have to be running (just run in identity-organizator and in organizator-server) and
# the caller has to be the memo's owner: anyone else gets the same 404 the plain read gives for a
# memo that is not there.
#
set -e

log() {
  printf "\n%s\n" "$1"
}

: ${USERNAME:?"is not set, it is needed for login"}

# By default read the history of memo 1
memo_id=${1:-1}

host_identity="http://localhost:8080"
host="http://localhost:8082"
crl="curl --fail-with-body -s"

# read the current password from stdin
read -s -p "Current password for ${USERNAME}: " current_password

JWT=$($crl "$host_identity/login" -d "username=${USERNAME}&password=$current_password")
: ${JWT:? "has not been fetched, cannot continue without it"}
log "Logged in as ${USERNAME}"
AUTH="Authorization: Bearer $JWT"

$crl -v "${host}/memo/${memo_id}/history" -H "$AUTH"

echo
