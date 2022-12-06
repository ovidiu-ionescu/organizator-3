#!/usr/bin/env bash

minikube start --extra-config=apiserver.service-node-port-range=80-30036 --memory 4096

