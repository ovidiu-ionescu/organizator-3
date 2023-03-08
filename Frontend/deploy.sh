#!/usr/bin/env bash

set -e 
echo "Build the typescript files"
pushd OrganizatorWeb-Memo
npm run build
popd

BUILD=OrganizatorWeb-Memo/build/main/
DEV_SOURCE=OrganizatorWeb-Memo/src/main
DEST_TEST=Nginx/Work/root
DEST_TEST_SOURCE=$DEST_TEST/src/main

echo "Copy the build"
mkdir -p $DEST_TEST
rsync -av $BUILD $DEST_TEST

echo "Copy the source"
mkdir -p $DEST_TEST_SOURCE
rsync -av $DEV_SOURCE $DEST_TEST_SOURCE

echo "Copy the webassembly"
mkdir -p $DEST_TEST/pkg
rsync -av $DEV_SOURCE/pkg $DEST_TEST/

