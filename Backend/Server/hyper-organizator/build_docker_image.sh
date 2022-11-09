#!/usr/bin/env bash
#
set -e

cargo build --release

cp ../target/release/hyper-organizator Docker

cd Docker

# change env to release the image to minikube
eval $(minikube docker-env)

docker build -t hyper-organizator .


