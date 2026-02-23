#!/bin/bash
# Install Sketchatone on Raspberry Pi
set -e

echo "Installing Sketchatone 0.1.0..."

# Extract package structure
tar xzf sketchatone-0.1.0-deb-pkg.tar.gz

# Build the .deb
dpkg-deb --build sketchatone_0.1.0_all

# Install it
apt install -y ./sketchatone_0.1.0_all.deb

# Clean up
rm -rf sketchatone_0.1.0_all sketchatone-0.1.0-deb-pkg.tar.gz install-sketchatone.sh

echo ""
echo "✅ Sketchatone installed successfully!"
echo ""
echo "Run: sketchatone -c /opt/sketchatone/configs/config.json"
