#!/usr/bin/bash

curl -v -H "X-SSL-Client-S-DN: CN:${USERNAME}" "http://127.0.0.1:8080/password" -d "username=testuser&password=123456"

