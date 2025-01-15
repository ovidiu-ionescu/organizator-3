#!/bin/bash
# Create the certificates for the CA and for organizator.lab

./cacert.sh
./hostcert.sh organizator.lab '*.organizator.lab'
