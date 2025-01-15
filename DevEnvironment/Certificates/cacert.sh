#!/bin/bash

mkdir -p "ca"
pushd "ca"

if [ -f "ca.cnf" ]; then
        echo "CA already exists."
        exit 1
fi

umask 066

# Generate a CA password, because openssl (reasonably) wants to protect
# the key material... and dump it to `ca.pass`.
export CAPASS=$(xkcdpass -n 64)

if [ -z "$CAPASS" ]; then
        echo "Error: password empty; no xkcdpass?"
        exit 1
fi

echo "$CAPASS" > "ca.pass"

# Generate the 4096 bit RSA key for the CA
openssl genrsa -aes256 -passout env:CAPASS  -out "ca.key" 4096

# Strip the encryption off it; IOW, now they're are two things worth
# protecting -- the `ca.pass` and `ca.key.unsecure`.
openssl rsa -in "ca.key" -passin env:CAPASS -out "ca.key.unsecure"

# At this point, you can decide whether to memorize `ca.pass` and
# delete it along with `ca.key.unsecure`, or protect `ca.key.unsecure`
# with your life, and maybe forget all about `ca.key` and `ca.pass`.
#
# (I'm sure you would have no trouble rewriting this to do away with
# the `ca.pass` and `xkcdpass` dependency altogether)

# Configure the CSR with necessary fields
cat > "ca.cnf" <<'EOF'
[ req ]
x509_extensions = v3_req
distinguished_name = req_distinguished_name
prompt = no

[ v3_req ]
# This is the money shot -- we are the cert authority (CA:TRUE),
# and there are no other CAs below us in the chain (pathlen:0),
# and the constraint is non-negotiable (critical)
basicConstraints = critical, CA:TRUE, pathlen:0

## This is optional but maybe needed for some platforms
#extendedKeyUsage = serverAuth, clientAuth, emailProtection

# Let's do the nameConstraints thing, because it works on iOS16
# and recent Firefox. So constrain all leaf certs to `organizator.lab`
# and its subdomains, but not `critical` in case it's not supported
# by some device.
# h/t https://news.ycombinator.com/item?id=37538084
keyUsage = critical, keyCertSign, cRLSign
nameConstraints = permitted;DNS:organizator.lab

[ req_distinguished_name ]
C = NL
L = Almere
O = organizator.lab CA
CN = ca.organizator.lab
emailAddress = ca@organizator.ro
EOF

# Do the deed -- generate the `ca.crt`, with 10 year (3650 days) validity
openssl req -new -x509 -days 3650 -sha512 -passin env:CAPASS -config ca.cnf \
        -key ca.key -out ca.crt -text

