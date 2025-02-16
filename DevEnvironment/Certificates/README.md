# Certificates

Scripts for creating a local CA and certificates for development purposes.

Inspiration from [here](https://wejn.org/2023/09/running-ones-own-root-certificate-authority-in-2023/).

# Files produced are:
- `ca.crt` - CA certificate
- `ca.key` - CA private key
- `organizator.lab.crt`
- `organizator.lab.key`


## Usage

The script `run.sh` will create the CA and the certificate for organizator.lab.
```bash
./run.sh
```

The `ca.crt` file should be imported into the browser so that it trusts the certificates signed by the CA.

The organizator.lab certificate can be used in a web server.

Cleanup by simply removing the directory `ca`.


