#!/bin/bash
# Create a Debian package installer for Sketchatone on Linux/Raspberry Pi

set -e

echo "=========================================="
echo "Sketchatone - Debian Package Creator"
echo "=========================================="
echo ""

# Check if app exists
if [ ! -d "dist/sketchatone" ]; then
    echo "❌ Error: Sketchatone application not found"
    echo "Please run ./build-linux.sh first"
    exit 1
fi

# Get version from pyproject.toml or use default
VERSION=$(grep -oP 'version = "\K[^"]+' python/pyproject.toml 2>/dev/null || echo "1.0.0")

# Detect architecture
ARCH=$(dpkg --print-architecture 2>/dev/null || echo "armhf")

# Create package directory structure
PKG_NAME="sketchatone_${VERSION}_${ARCH}"
PKG_DIR="dist/$PKG_NAME"

echo "📦 Package: sketchatone"
echo "📦 Version: $VERSION"
echo "📦 Architecture: $ARCH"
echo ""

echo "🗂️  Creating Debian package structure..."
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/opt/sketchatone"
mkdir -p "$PKG_DIR/opt/sketchatone/configs"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/etc/systemd/system"

# Copy application files
echo "📦 Copying application files..."
cp -R dist/sketchatone/* "$PKG_DIR/opt/sketchatone/"

# Copy setup script
if [ -f "sketchatone-setup" ]; then
    cp sketchatone-setup "$PKG_DIR/usr/bin/sketchatone-setup"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-setup"
    echo "📦 Including setup script"
else
    echo "⚠️  Warning: sketchatone-setup not found"
fi

# Create symlink script in /usr/bin for easy command-line access
cat > "$PKG_DIR/usr/bin/sketchatone" << 'BINEOF'
#!/bin/bash
# Sketchatone launcher
exec /opt/sketchatone/sketchatone.sh "$@"
BINEOF
chmod +x "$PKG_DIR/usr/bin/sketchatone"

# Create systemd service file (BindsTo will be added by setup script for USB mode)
cat > "$PKG_DIR/etc/systemd/system/sketchatone.service" << 'SERVICEEOF'
[Unit]
Description=Sketchatone MIDI Strummer
After=network.target sound.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sketchatone
ExecStart=/opt/sketchatone/sketchatone -c /opt/sketchatone/configs/config.json
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Environment variables
Environment="DISPLAY=:0"

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Create control file
cat > "$PKG_DIR/DEBIAN/control" << CONTROLEOF
Package: sketchatone
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Depends: libhidapi-hidraw0, libhidapi-dev, libasound2, libjack0 | libjack-jackd2-0
Maintainer: Sketchatone Project
Description: MIDI Strummer for Drawing Tablets
 Sketchatone converts drawing tablet input into expressive MIDI output,
 enabling musicians to use tablets as MIDI controllers with strumming,
 pitch bend, velocity control, and chord progressions.
 .
 Features:
  - HID device support for drawing tablets
  - MIDI output with configurable mappings
  - WebSocket real-time communication
  - Optional web dashboard
  - USB plug-and-play auto-start (optional)
  - Zynthian compatible
CONTROLEOF

# Create conffiles to preserve user config on upgrade
cat > "$PKG_DIR/DEBIAN/conffiles" << 'CONFEOF'
/opt/sketchatone/configs/config.json
CONFEOF

# Create postinst script (runs after installation)
cat > "$PKG_DIR/DEBIAN/postinst" << 'POSTINSTEOF'
#!/bin/bash
set -e

echo ""
echo "=========================================="
echo "Sketchatone installed successfully!"
echo "=========================================="
echo ""

# Set correct permissions
chmod +x /opt/sketchatone/sketchatone
chmod +x /opt/sketchatone/sketchatone.sh
chmod +x /usr/bin/sketchatone

# Create default config if it doesn't exist
if [ ! -f /opt/sketchatone/configs/config.json ]; then
    if [ -f /opt/sketchatone/configs/sample-config.json ]; then
        cp /opt/sketchatone/configs/sample-config.json /opt/sketchatone/configs/config.json
        echo "📋 Created default config: /opt/sketchatone/configs/config.json"
    fi
fi

# Reload systemd daemon to recognize new service
systemctl daemon-reload

echo ""
echo "To configure Sketchatone, run:"
echo "  sudo sketchatone-setup --help"
echo ""
echo "Quick setup options:"
echo "  sudo sketchatone-setup --mode usb-trigger   # Start when tablet plugged in"
echo "  sudo sketchatone-setup --mode always-on     # Start on boot"
echo "  sudo sketchatone-setup --mode manual        # Manual start only"
echo ""
echo "To run manually:"
echo "  sketchatone -c /opt/sketchatone/configs/config.json"
echo ""
echo "Configuration: /opt/sketchatone/configs/config.json"
echo ""

exit 0
POSTINSTEOF
chmod +x "$PKG_DIR/DEBIAN/postinst"

# Create prerm script (runs before uninstall)
cat > "$PKG_DIR/DEBIAN/prerm" << 'PRERMEOF'
#!/bin/bash
set -e

# Stop and disable service if it's running
if systemctl is-active --quiet sketchatone 2>/dev/null; then
    echo "Stopping Sketchatone service..."
    systemctl stop sketchatone
fi

if systemctl is-enabled --quiet sketchatone 2>/dev/null; then
    echo "Disabling Sketchatone service..."
    systemctl disable sketchatone
fi

# Remove udev rules if they exist
if [ -f /etc/udev/rules.d/99-sketchatone.rules ]; then
    echo "Removing udev rules..."
    rm -f /etc/udev/rules.d/99-sketchatone.rules
    udevadm control --reload-rules 2>/dev/null || true
fi

exit 0
PRERMEOF
chmod +x "$PKG_DIR/DEBIAN/prerm"

# Create postrm script (runs after uninstall)
cat > "$PKG_DIR/DEBIAN/postrm" << 'POSTRMEOF'
#!/bin/bash
set -e

# Reload systemd daemon after service file is removed
systemctl daemon-reload

echo "Sketchatone has been uninstalled."

exit 0
POSTRMEOF
chmod +x "$PKG_DIR/DEBIAN/postrm"

# Build the package
echo "💿 Building Debian package..."
dpkg-deb --build "$PKG_DIR"

# Move to dist directory with a cleaner name
mv "${PKG_DIR}.deb" "dist/sketchatone-${VERSION}-linux-${ARCH}.deb"

# Clean up
echo "🧹 Cleaning up..."
rm -rf "$PKG_DIR"

echo ""
echo "=========================================="
echo "✅ Debian package created successfully!"
echo "=========================================="
echo ""
echo "Package: dist/sketchatone-${VERSION}-linux-${ARCH}.deb"
echo ""
echo "To install on Raspberry Pi / Zynthian:"
echo "  sudo apt update"
echo "  sudo apt install ./sketchatone-${VERSION}-linux-${ARCH}.deb"
echo ""
echo "System dependencies (will be installed automatically):"
echo "  - libhidapi-hidraw0 (HID device access)"
echo "  - libhidapi-dev"
echo "  - libasound2 (ALSA for MIDI)"
echo "  - libjack0 or libjack-jackd2-0 (JACK audio)"
echo ""
echo "After installation, run setup:"
echo "  sudo sketchatone-setup --mode usb-trigger"
echo ""
