#!/usr/bin/env bash

set -e

eval $(minikube docker-env)
docker build -t hyper-organizator:v0.0.1 .

