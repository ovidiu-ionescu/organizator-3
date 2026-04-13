#!/bin/bash
# try the rules file without making a debian package, to see if it works

fakeroot ./debian/rules clean
fakeroot ./debian/rules install
eza -T debian/organizator
