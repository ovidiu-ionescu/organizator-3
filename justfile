
# Useful to check if the files are in the right place before creating the .deb package.
# It will create the directory debian/organizator with the files that will be included in the .deb package.
try-deb: clean-try-deb
  fakeroot ./debian/rules install
  eza -T debian/organizator


# Create the .deb package. The file will be in the parent directory.
deb:
  debuild -us -uc

clean-try-deb:
  fakeroot ./debian/rules clean
