#!/usr/bin/env bash

set -e

eval $(minikube docker-env)
cd ..
#docker build -f k8s/Dockerfile -t hyper-organizator:v0.0.1 .
docker build -t hyper-organizator:v0.0.1 .

