#!/usr/bin/bash
#
set -e

log() {
  printf "\n%s\n" "$1"
}

host="http://localhost:8080"
crl="curl --fail-with-body -s"

# read the current password from stdin
read -s -p "Current password for ${USERNAME}: " current_password

JWT=$($crl "$host/login" -d "username=${USERNAME}&password=$current_password")
log "Logged in as ${USERNAME}"
AUTH="Authorization: Bearer $JWT"

$crl "${host}/password" -H "$AUTH" -d "username=testuser&new_password=123456&old_password=$current_password"
log "Password changed for testuser"

JWT=$($crl "${host}/login" -d "username=testuser&password=123456")
AUTH="Authorization: Bearer $JWT"
log "Logged in as testuser"

$crl "${host}/password" -H "$AUTH" -d "username=testuser&new_password=7890&old_password=123456"
log "testuser changed own password"

JWT=$($crl "${host}/login" -d "username=testuser&password=7890")
log "Logged in as testuser with new own password"

exit 0

$crl "${host}/password" -H "X-SSL-Client-S-DN: CN:${USERNAME}" -d "username=testuser&password=123456"
$crl "${host}/password" -d "username=testuser&password=123456"
