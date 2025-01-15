#!/bin/sh
##
##  sign.sh -- Sign a SSL Certificate Request (CSR)
##  Copyright (c) 1998-2001 Ralf S. Engelschall, All Rights Reserved.
##

#   argument line handling
CSR=$1
if [ $# -ne 1 ]; then
    echo "Usage: sign.sign <whatever>.csr"; exit 1
fi
if [ ! -f $CSR ]; then
    echo "CSR not found: $CSR"; exit 1
fi
case $CSR in
   *.csr ) CERT="`echo $CSR | sed -e 's/\.csr/.crt/'`" ;;
       * ) CERT="$CSR.crt" ;;
esac

#   make sure environment exists
if [ ! -d ca.db.certs ]; then
    mkdir ca.db.certs
fi
if [ ! -f ca.db.serial ]; then
    echo '01' >ca.db.serial
fi
if [ ! -f ca.db.index ]; then
    cp /dev/null ca.db.index
fi

#   create an own SSLeay config
cat >ca.config <<EOT
[ ca ]
default_ca              = CA_own
[ CA_own ]
dir                     = .
certs                   = \$dir
new_certs_dir           = \$dir/ca.db.certs
database                = \$dir/ca.db.index
serial                  = \$dir/ca.db.serial
RANDFILE                = \$dir/ca.db.rand
certificate             = \$dir/ca.crt
private_key             = \$dir/ca.key
# all hail our fruity overlords:
default_days            = 365
default_crl_days        = 30
# need sane message digest, too:
default_md              = sha512
preserve                = no
policy                  = policy_anything
copy_extensions         = copy
x509_extensions         = v3
[ v3 ]
basicConstraints = critical, CA:FALSE

[ policy_anything ]
countryName             = optional
stateOrProvinceName     = optional
localityName            = optional
organizationName        = optional
organizationalUnitName  = optional
commonName              = supplied
emailAddress            = optional
EOT

#  sign the certificate
if [ "x$CAPASS" = "x" ]; then
	echo "No \$CAPASS present, will have to specify pass"
	PASSIN=""
else
	echo "Reading pass from \$CAPASS"
	PASSIN="-passin env:CAPASS"
fi

echo "CA signing: $CSR -> $CERT:"
openssl ca -batch -config ca.config $PASSIN -out $CERT -infiles $CSR
echo "CA verifying: $CERT <-> CA cert"
if [ -f ca-chain.pem ]; then
	openssl verify -CAfile ca-chain.pem $CERT
else
	openssl verify -CAfile ca.crt $CERT
fi

#  cleanup after SSLeay
rm -f ca.config
rm -f ca.db.serial.old
rm -f ca.db.index.old

#  die gracefully
exit 0

