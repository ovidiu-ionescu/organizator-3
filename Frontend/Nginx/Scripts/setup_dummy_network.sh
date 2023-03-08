#!/bin/bash
# Creates a dummy network interface for local testing with nginx
#
set -e

ADAPTER_NAME="dummy_nginx"
IP_ADDRESS="192.168.71.78/16"

SUDO=''
if (( $EUID != 0 )); then
    SUDO='sudo'
fi

err_echo(){ >&2 echo $@; }

remove_dummy_network() {
    : ${ADAPTER_NAME:?"ADAPTER_NAME is not set"}
    echo "Removing dummy network interface 「$ADAPTER_NAME」"
    # if the dummy network interface does not exist, exit
    if [ ! -d "/sys/class/net/$ADAPTER_NAME" ]; then
        err_echo "Dummy network interface 「$ADAPTER_NAME」 does not exist"
        exit 1
    fi
    sudo ip link del $ADAPTER_NAME
}

ACTION="add"

while getopts "ai:rn:h" opt; do
    case $opt in
        h) echo "Usage: $0 [-a] [-i IP_ADDRESS] [-r] [-n ADAPTER_NAME]"
            echo "  -a: add dummy network interface"
            echo "  -i: IP address"
            echo "  -r: remove dummy network interface"
            echo "  -n: network interface name"
            echo "  -h: help"
            exit 0
            ;;
        a)
            ACTION="add"
            ;;
        i)
            echo "IP address: $OPTARG"
            IP_ADDRESS=$OPTARG
            ;;
        r)
            #echo "Removing dummy network interface 「$ADAPTER_NAME」"
            ACTION="remove"
            ;;
        n)
            echo "Network interface name: $OPTARG"
            ADAPTER_NAME=$OPTARG
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
        :)
            echo "Option -$OPTARG requires an argument." >&2
            exit 1
            ;;
    esac
done

case $ACTION in
    add)
        echo "Adding dummy network interface 「$ADAPTER_NAME」"
        ;;
    remove)
        # echo "Removing dummy network interface 「$ADAPTER_NAME」"
        remove_dummy_network
        exit 0
        ;;
    *)
        echo "Invalid action: $ACTION" >&2
        exit 1
        ;;
esac

if [ -d "/sys/class/net/$ADAPTER_NAME" ]; then
    err_echo "Dummy network interface 「$ADAPTER_NAME」 already exists"
    err_echo "You can remove it with:"
    err_echo "$ $0 -r -n $ADAPTER_NAME"
    exit 1
fi

$SUDO ip link add $ADAPTER_NAME type dummy
$SUDO ip addr add $IP_ADDRESS dev $ADAPTER_NAME
$SUDO ip link set $ADAPTER_NAME up

cat <<EOF
Dummy network interface 「$ADAPTER_NAME」 created

Make sure to add the following to your /etc/hosts file:
${IP_ADDRESS%%/*} nginx.local

Remove the dummy network interface with:
$ $0 -r -n $ADAPTER_NAME
EOF

