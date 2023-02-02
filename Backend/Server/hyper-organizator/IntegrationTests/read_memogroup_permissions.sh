#!/usr/bin/bash
#
set -e

log() {
  printf "\n%s\n" "$1"
}

# By default read memo 1
memo_id=${1:-1}

host_identity="http://localhost:8080"
host="http://localhost:8082"
crl="curl --fail-with-body -s"

# read the current password from stdin
read -s -p "Current password for ${USERNAME}: " current_password

JWT=$($crl "$host_identity/login" -d "username=${USERNAME}&password=$current_password")
log "Logged in as ${USERNAME}"
AUTH="Authorization: Bearer $JWT"

$crl -v "${host}/explicit_permissions/${memo_id}" -H "$AUTH"

