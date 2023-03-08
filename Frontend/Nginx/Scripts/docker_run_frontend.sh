#!/usr/bin/env bash
#
echo "Run the frontend container"

# make sure you are running above the Scripts directory
if [ ! -f Scripts/docker_run_frontend.sh ]; then
  echo "ERROR: you must run this script above the Scripts directory" >&2
  exit 1
fi

PREF=$PWD

echo "make sure the network interface exists"
Scripts/setup_dummy_network.sh -a -n dummy_nginx -i 192.168.71.78/16

# From now on we stop on any error
set -e

echo "check if the docker image exists"
if [ -z "$(docker images -q organizator-frontend:latest)" ]; then
  Scripts/docker_image_build.sh
fi

echo "stop and remove the container if it already exists"
if [ "$(docker ps -a | grep organizator-frontend)" ]; then
    docker stop organizator-frontend
    docker rm organizator-frontend
fi

# make sure the logs and root directories exist
mkdir -p $PREF/Work/logs
mkdir -p $PREF/Work/root
cp index.html $PREF/Work/root

CONTAINER_NAME="organizator-frontend"
IMAGE_NAME="organizator-frontend"
IP=192.168.71.78

SECRET=$PREF/Work/ssl/privkey.pem
echo check the key file exists
if [ ! -f $SECRET ]; then
  echo "ERROR: $SECRET does not exist" >&2
  exit 1
fi

docker run --name $CONTAINER_NAME \
  -d \
  -p $IP:80:80 -p $IP:443:443 \
  -v $PREF/Work/logs:/var/log/nginx \
  -v $PREF/Work/ssl/fullchain.pem:/etc/nginx/conf.d/fullchain.pem:ro \
  -v $PREF/Work/ssl/privkey.pem:/etc/nginx/conf.d/privkey.pem:ro \
  -v $PREF/Work/root:/usr/share/nginx/html \
  $IMAGE_NAME

