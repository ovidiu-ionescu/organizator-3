#!/usr/bin/env bash
#
echo "Build the docker image for the frontend"

if [ ! -f Dockerfile ]; then
    echo "Dockerfile not found, exiting" >&2
    exit 1
fi

# Stop and remove the container if it exists
if [ "$(docker ps -a | grep organizator-frontend)" ]; then
    echo "Container based on image already exists, stopping and removing it"
    docker stop organizator-frontend
    docker rm organizator-frontend
fi

docker build -t organizator-frontend .

