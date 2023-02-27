#!/bin/bash
# Creates a dummy network interface for local testing with nginx
#
set -e

SUDO=''
if (( $EUID != 0 )); then
    SUDO='sudo'
fi

ADAPTER_NAME="dummy_nginx"

err_echo(){ >&2 echo $@; }

remove_dummy_network() {
    echo "Removing dummy network interface 「$ADAPTER_NAME」"
    # if the dummy network interface does not exist, exit
    if [ ! -d "/sys/class/net/$ADAPTER_NAME" ]; then
        err_echo "Dummy network interface 「$ADAPTER_NAME」 does not exist"
        exit 1
    fi
    sudo ip link del $ADAPTER_NAME
}

# check if the command line parameter is remove
if [ "$1" = "remove" ]; then
    remove_dummy_network
    exit 0
fi

if [ -d "/sys/class/net/$ADAPTER_NAME" ]; then
    err_echo "Dummy network interface 「$ADAPTER_NAME」 already exists"
    err_echo "You can remove it with:"
    err_echo "$ $0 remove"
    exit 1
fi

$SUDO ip link add $ADAPTER_NAME type dummy
$SUDO ip addr add 192.168.71.78/16 dev $ADAPTER_NAME
$SUDO ip link set $ADAPTER_NAME up

cat <<EOF
Dummy network interface 「$ADAPTER_NAME」 created

Make sure to add the following to your /etc/hosts file:
192.168.71.78 nginx.local

Remove the dummy network interface with:
$ $0 remove
EOF
