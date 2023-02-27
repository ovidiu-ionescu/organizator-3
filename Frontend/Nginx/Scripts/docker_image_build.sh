#!/usr/bin/env bash
#
# Build the docker image
if [ ! -f Dockerfile ]; then
    echo "Dockerfile not found, exiting" >&2
    exit 1
fi
docker stop organizator-frontend
docker rm organizator-frontend

docker build -t organizator-frontend .

