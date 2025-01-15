#!/bin/bash

mkdir -p ca
pushd ca

# Read the CA password, used by `sign.sh` later
export CAPASS=$(cat ca.pass)

if [ -f "$1.cnf" ]; then
        echo "Host: $1 already exists."
        exit 1
fi

if [ -z "$1" ]; then
        echo "Error: No hostname given"
        exit 1
fi

umask 066

# Generate the certificate's password, and dump it.
export PASS=$(xkcdpass -n 64)

if [ -z "$PASS" ]; then
        echo "Error: password empty; no xkcdpass?"
        exit 1
fi

echo "$PASS" > "$1.pass"

# Figure out what the hostname / altnames are, and confirm.
echo "$1" | fgrep -q "."
if [ $? -eq 0 ]; then
        CN="$1"
        ALTNAMES="$@"
else
        CN="$1.organizator.lab"
        ALTNAMES="$1.organizator.lab"
fi
echo "CN: $CN"
echo "ANs: $ALTNAMES"
echo "Enter to confirm."
read A

# Generate the RSA key, unlock it into the "unsecure" file
openssl genrsa -aes256 -passout env:PASS  -out "$1.key" ${SSL_KEY_SIZE-4096}
openssl rsa -in "$1.key" -passin env:PASS -out "$1.key.unsecure"

# Construct the CSR data
cat > "$1.cnf" <<EOF
[ req ]
req_extensions = v3_req
distinguished_name = req_distinguished_name
prompt = no

[ v3_req ]
# We are NOT a CA, this is for server auth, and these are the altnames
basicConstraints = critical,CA:FALSE
# We are, however, a certificate for server authentication (important!)
extendedKeyUsage=serverAuth
subjectAltName = @alt_names

[alt_names]
EOF

I=1
for AN in $ALTNAMES; do
        echo "DNS.$I = $AN" >> "$1.cnf"
        I=$[$I + 1]
done

cat >> "$1.cnf" <<EOF

[ req_distinguished_name ]
C = NL
L = Almere
O = organizator.lab host cert
CN = $CN
EOF

# Create the CSR
openssl req -new -key "$1.key" -sha512 -passin env:PASS -config "$1.cnf" \
        -out "$1.csr"

# Sign the CSR by the CA, resulting in `$1.crt`; needs env;CAPASS
../sign.sh "$1.csr"

# Optional: put both cert and key into a single `$1.pem` file
#ruby -pe 'next unless /BEGIN/../END/' "$1.crt" "$1.key.unsecure" > "$1.pem"

