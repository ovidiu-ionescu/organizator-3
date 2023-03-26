#!/usr/bin/env bash
#
namespace=organizator-dev
case $1 in
  uninstall|delete)
    helm uninstall identity --namespace $namespace
    exit 0
    ;;
  show)
    helm get manifest identity --namespace $namespace
    exit 0
    ;;
esac

helm install identity --namespace $namespace identity-helm


