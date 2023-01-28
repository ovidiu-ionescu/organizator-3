#!/bin/bash
# Reload nginx ingress controller
set -x
set -e

K="kubectl -n organizator-dev"
$K delete ingress/hyper-organizator-ingress
$K create -f hyper-organizator-ingress.yml 
