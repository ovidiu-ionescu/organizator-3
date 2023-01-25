#!/usr/bin/env bash

set -e

eval $(minikube docker-env)

docker build .

docker tag $(docker image ls --filter "label=tag=identity:v0.1.0" -q) identity:v0.1.0
docker tag $(docker image ls --filter "label=tag=hyper-organizator:v0.1.0" -q) hyper-organizator:v0.1.0

docker image prune --filter label=stage=builder -f
