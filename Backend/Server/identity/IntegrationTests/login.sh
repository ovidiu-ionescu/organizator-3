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

