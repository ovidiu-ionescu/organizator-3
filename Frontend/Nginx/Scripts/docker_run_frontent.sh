#!/usr/bin/env bash
#
# Run the frontend container

docker rm organizator-frontend

PREF=$PWD
CONTAINER_NAME="organizator-frontend"
IMAGE_NAME="organizator-frontend"
IP=192.168.71.78

SECRET=$PREF/Work/ssl/privkey.pem
# check the key file exists
if [ ! -f $SECRET ]; then
  echo "ERROR: $SECRET does not exist" >&2
  exit 1
fi

docker run --name $CONTAINER_NAME -d \
  -p $IP:80:80 -p $IP:443:443 \
  -v $PREF/Work/logs:/var/log/nginx \
  -v $PREF/Work/ssl/fullchain.pem:/etc/nginx/conf.d/fullchain.pem:ro \
  -v $PREF/Work/ssl/privkey.pem:/etc/nginx/conf.d/privkey.pem:ro \
  $IMAGE_NAME

