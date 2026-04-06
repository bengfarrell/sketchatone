#!/bin/bash
# Create a Debian package installer for Sketchatone on Linux/Raspberry Pi
# This creates a Python-based installer (no PyInstaller needed)

set -e

echo "=========================================="
echo "Sketchatone - Debian Package Creator"
echo "=========================================="
echo ""

# Check if we have the required source files
if [ ! -d "python/sketchatone" ]; then
    echo "❌ Error: Python source not found at python/sketchatone"
    exit 1
fi

if [ ! -d "blankslate/blankslate" ]; then
    echo "❌ Error: Blankslate source not found at blankslate/blankslate"
    exit 1
fi

# Get version from pyproject.toml or use default (compatible with both GNU and BSD grep)
VERSION=$(grep '^version = ' python/pyproject.toml 2>/dev/null | head -1 | sed 's/version = "\(.*\)"/\1/' || echo "1.0.0")

# Detect architecture (all for Python-based package)
ARCH="all"

# Create package directory structure
PKG_NAME="sketchatone_${VERSION}_${ARCH}"
PKG_DIR="dist/$PKG_NAME"

echo "📦 Package: sketchatone"
echo "📦 Version: $VERSION"
echo "📦 Architecture: $ARCH (Python-based)"
echo ""

echo "🗂️  Creating Debian package structure..."
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/opt/sketchatone/python"
mkdir -p "$PKG_DIR/opt/sketchatone/configs"
mkdir -p "$PKG_DIR/opt/sketchatone/dist/public"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/etc/systemd/system"

# Copy Python source files
echo "📦 Copying Python source files..."
echo "  → sketchatone package"
cp -R python/sketchatone "$PKG_DIR/opt/sketchatone/python/"
cp python/pyproject.toml "$PKG_DIR/opt/sketchatone/python/"

echo "  → blankslate package"
# Use -RL to follow symlinks (blankslate/blankslate is a symlink to ../blankslate/python/blankslate)
cp -RL blankslate/blankslate "$PKG_DIR/opt/sketchatone/python/"
cp -L blankslate/pyproject.toml "$PKG_DIR/opt/sketchatone/python/blankslate-pyproject.toml"

# Remove __pycache__ directories
find "$PKG_DIR/opt/sketchatone/python" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Copy config files
echo "📦 Copying config files..."
if [ -d "public/configs" ]; then
    cp -R public/configs/* "$PKG_DIR/opt/sketchatone/configs/"
    echo "  → Config files included:"
    ls -la "$PKG_DIR/opt/sketchatone/configs/" 2>/dev/null || echo "    (none)"
fi

# Copy built webapp if it exists
# Server expects files at dist/public relative to the python directory
if [ -d "dist/public" ]; then
    echo "📦 Copying webapp..."
    mkdir -p "$PKG_DIR/opt/sketchatone/dist/public"
    cp -R dist/public/* "$PKG_DIR/opt/sketchatone/dist/public/"
fi

# Copy setup script
if [ -f "sketchatone-setup" ]; then
    cp sketchatone-setup "$PKG_DIR/usr/bin/sketchatone-setup"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-setup"
    echo "📦 Including setup script"
else
    echo "⚠️  Warning: sketchatone-setup not found"
fi

# Create launcher script in /usr/bin
# This script detects JACK availability at runtime
cat > "$PKG_DIR/usr/bin/sketchatone" << 'BINEOF'
#!/bin/bash
# Sketchatone launcher - runs Python module directly with runtime JACK detection
export PYTHONPATH="/opt/sketchatone/python:$PYTHONPATH"

# Auto-detect Zynthian environment and add venv to PYTHONPATH if available
if [ -d "/zynthian/venv/lib/python3.11/site-packages" ]; then
    export PYTHONPATH="$PYTHONPATH:/zynthian/venv/lib/python3.11/site-packages"
fi

exec python3 -m sketchatone.cli.server "$@"
BINEOF
chmod +x "$PKG_DIR/usr/bin/sketchatone"

# Create single systemd service with JACK detection
cat > "$PKG_DIR/opt/sketchatone/sketchatone.service" << 'SERVICEEOF'
[Unit]
Description=Sketchatone MIDI Strummer
After=network.target sound.target jack2.service a2jmidid.service
# Optional dependency on JACK (won't fail if JACK isn't available)
Wants=jack2.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sketchatone
# Auto-detect and include Zynthian venv if available
Environment="PYTHONPATH=/opt/sketchatone/python:/usr/lib/python3/dist-packages"
Environment="DISPLAY=:0"
# Small delay to let JACK initialize if present (helps with Zynthian boot)
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/python3 -m sketchatone.cli.server -c /opt/sketchatone/configs/config.json
TimeoutStopSec=10
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Create control file - remove hard JACK dependency for ALSA mode compatibility
cat > "$PKG_DIR/DEBIAN/control" << CONTROLEOF
Package: sketchatone
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Depends: python3 (>= 3.8), python3-pip, libhidapi-hidraw0, libhidapi-dev, libasound2, python3-dev, build-essential
Recommends: libjack0 | libjack-jackd2-0, python3-rtmidi
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
  - Supports ALSA (standard Pi) and JACK/Zynthian
CONTROLEOF

# Create postinst script (runs after installation)
cat > "$PKG_DIR/DEBIAN/postinst" << 'POSTINSTEOF'
#!/bin/bash
set -e

echo ""
echo "=========================================="
echo "Sketchatone Installation"
echo "=========================================="
echo ""

# Auto-detect environment
DETECTED_ENV="Standard Raspberry Pi"
if [ -d "/zynthian" ] || systemctl list-unit-files | grep -q "jack2.service"; then
    DETECTED_ENV="Zynthian (JACK detected)"
fi

echo "Detected environment: $DETECTED_ENV"
echo ""
echo "Note: MIDI backend (ALSA/JACK) can be configured"
echo "      in the web UI after installation."
echo ""

# Install the systemd service
cp /opt/sketchatone/sketchatone.service /etc/systemd/system/sketchatone.service

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."

# Function to install a package with fallback methods
install_package() {
    local package="$1"

    # Try with --break-system-packages first (Debian 12+)
    if pip3 install --break-system-packages "$package" 2>/dev/null; then
        return 0
    fi

    # Try without flag (older systems)
    if pip3 install "$package" 2>/dev/null; then
        return 0
    fi

    # Try with apt if available (for common packages)
    local apt_name=$(echo "$package" | sed 's/>=.*//' | sed 's/-/_/g')
    if apt-cache show "python3-$apt_name" >/dev/null 2>&1; then
        echo "  → Installing $apt_name via apt..."
        apt install -y "python3-$apt_name" 2>/dev/null && return 0
    fi

    return 1
}

# Install common dependencies
install_package "websockets>=11.0.0" || echo "⚠️  Warning: websockets install failed"
install_package "hidapi>=0.14.0" || echo "⚠️  Warning: hidapi install failed"
install_package "inquirer>=3.1.0" || echo "⚠️  Warning: inquirer install failed"
install_package "colorama>=0.4.6" || echo "⚠️  Warning: colorama install failed"
install_package "cryptography>=41.0.0" || echo "⚠️  Warning: cryptography install failed"

# Install python-rtmidi for ALSA support - first try apt, then pip
echo "📦 Installing python-rtmidi (ALSA backend)..."
if apt-cache show python3-rtmidi >/dev/null 2>&1; then
    echo "  → Installing from apt (python3-rtmidi)..."
    apt-get install -y python3-rtmidi && echo "  ✓ Installed from apt" || {
        echo "  ⚠️  apt install failed, trying pip..."
        install_package "python-rtmidi>=1.5.0" || echo "  ⚠️  Warning: python-rtmidi install failed"
    }
else
    echo "  → python3-rtmidi not available in apt, using pip..."
    install_package "python-rtmidi>=1.5.0" || echo "  ⚠️  Warning: python-rtmidi install failed"
fi

# JACK support is available via Zynthian venv if present (auto-detected at runtime)

# Set correct permissions
chmod +x /usr/bin/sketchatone

# Create default config if it doesn't exist
if [ ! -f /opt/sketchatone/configs/config.json ]; then
    # Use default sample config (MIDI backend can be changed in web UI)
    if [ -f /opt/sketchatone/configs/sample-config.json ]; then
        cp /opt/sketchatone/configs/sample-config.json /opt/sketchatone/configs/config.json
        echo "📋 Created default config: /opt/sketchatone/configs/config.json"
    elif [ -f /opt/sketchatone/configs/default.json ]; then
        cp /opt/sketchatone/configs/default.json /opt/sketchatone/configs/config.json
        echo "📋 Created default config: /opt/sketchatone/configs/config.json"
    fi
fi

# Reload systemd daemon to recognize new service
systemctl daemon-reload

# Automatically generate udev rules with usb-trigger mode (default)
# This is needed for HID device permissions (especially keyboard HID buttons)
echo ""
echo "🔧 Setting up udev rules and auto-start..."
if [ -x /usr/bin/sketchatone-setup ]; then
    /usr/bin/sketchatone-setup --mode usb-trigger
else
    echo "⚠️  Warning: sketchatone-setup not found, skipping udev configuration"
fi

echo ""
echo "=========================================="
echo "✅ Sketchatone installed successfully!"
echo "=========================================="
echo ""
echo "Environment: $DETECTED_ENV"
echo ""
echo "Sketchatone is configured to auto-start when your tablet is plugged in."
echo ""
echo "Configure MIDI backend (ALSA/JACK) and other settings via the web UI:"
echo "  http://$(hostname -I | awk '{print $1}')"
echo ""
echo "To change auto-start behavior:"
echo "  sudo sketchatone-setup --mode manual        # Disable auto-start (keep permissions)"
echo "  sudo sketchatone-setup --mode always-on     # Start on boot instead"
echo ""
echo "To run manually:"
echo "  sketchatone -c /opt/sketchatone/configs/config.json"
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
echo "Note: Python dependencies were not removed."

exit 0
POSTRMEOF
chmod +x "$PKG_DIR/DEBIAN/postrm"

# Build the package
echo ""
echo "💿 Building Debian package..."

# Check if dpkg-deb is available (Linux) or not (macOS)
if command -v dpkg-deb &> /dev/null; then
    # Build directly on Linux
    dpkg-deb --build "$PKG_DIR"
    mv "${PKG_DIR}.deb" "dist/sketchatone-${VERSION}.deb"

    # Clean up
    echo "🧹 Cleaning up..."
    rm -rf "$PKG_DIR"

    echo ""
    echo "=========================================="
    echo "✅ Debian package created successfully!"
    echo "=========================================="
    echo ""
    echo "Package: dist/sketchatone-${VERSION}.deb"
    echo ""
    echo "To install:"
    echo "  sudo apt install ./dist/sketchatone-${VERSION}.deb"
    echo ""
else
    # On macOS, create a tarball of the package structure
    echo "  (dpkg-deb not available - creating package structure tarball)"

    # Create tarball of the package directory
    TARBALL="dist/sketchatone-${VERSION}-deb-pkg.tar.gz"
    cd dist
    tar czf "sketchatone-${VERSION}-deb-pkg.tar.gz" "$PKG_NAME"
    cd ..

    # Create a helper script to build the deb on the Pi (before cleanup)
    cat > "dist/install-sketchatone.sh" << INSTALLEOF
#!/bin/bash
# Install Sketchatone on Raspberry Pi
set -e

echo "Installing Sketchatone ${VERSION}..."

# Extract package structure
tar xzf sketchatone-${VERSION}-deb-pkg.tar.gz

# Build the .deb
dpkg-deb --build sketchatone_${VERSION}_all

# Install it
apt install -y ./sketchatone_${VERSION}_all.deb

# Clean up
rm -rf sketchatone_${VERSION}_all sketchatone-${VERSION}-deb-pkg.tar.gz install-sketchatone.sh

echo ""
echo "✅ Sketchatone installed successfully!"
echo ""
echo "Run: sketchatone -c /opt/sketchatone/configs/config.json"
INSTALLEOF
    chmod +x "dist/install-sketchatone.sh"

    # Clean up
    echo "🧹 Cleaning up..."
    rm -rf "$PKG_DIR"

    echo ""
    echo "=========================================="
    echo "✅ Package structure created successfully!"
    echo "=========================================="
    echo ""
    echo "Files created:"
    echo "  - $TARBALL"
    echo "  - dist/install-sketchatone.sh"
    echo ""
    echo "To install on Raspberry Pi / Zynthian:"
    echo ""
    echo "  # Copy files to Pi"
    echo "  scp dist/sketchatone-${VERSION}-deb-pkg.tar.gz dist/install-sketchatone.sh root@synth.local:~/"
    echo ""
    echo "  # On the Pi:"
    echo "  ./install-sketchatone.sh"
    echo ""
fi
