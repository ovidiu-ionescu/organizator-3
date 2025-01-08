#!/usr/bin/bash

echo "Please enter your old password:"
read -s old_password
echo "Please enter your new password:"
read -s new_password

curl -v \
  -H "X-SSL-Client-S-DN: CN=${USERNAME}" \
  -H "X-SSL-Client-Verify: SUCCESS" \
  "http://127.0.0.1:8080/password" -d "new_password=${new_password}&username=testuser&old_password=${old_password}"

