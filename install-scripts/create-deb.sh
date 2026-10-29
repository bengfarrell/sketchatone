#!/bin/bash
# Create a Debian package installer for Sketchatone on Linux/Raspberry Pi
# This creates a Python-based installer (no PyInstaller needed)

set -e

# Self-locate: this script lives under install-scripts/ and references both
# sibling helper scripts and project-root paths (python/, public/, dist/).
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_ROOT"

OUTPUT_DIR="$PROJECT_ROOT/dist"
TREE_ONLY=0
while [ $# -gt 0 ]; do
    case "$1" in
        --output-dir) OUTPUT_DIR="${2:?Missing output directory}"; shift 2 ;;
        --tree-only) TREE_ONLY=1; shift ;;
        *) echo "Usage: $0 [--tree-only] [--output-dir DIRECTORY]" >&2; exit 2 ;;
    esac
done
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

echo "=========================================="
echo "Sketchatone - Debian Package Creator"
echo "=========================================="
echo ""

# Check if we have the required source files
if [ ! -d "python/sketchatone" ]; then
    echo "❌ Error: Python source not found at python/sketchatone"
    exit 1
fi

# This is the canonical web build step, including direct package creation.
# Never package an old dist/public tree after a failed or skipped build.
echo "🌐 Building the latest web dashboard..."
if ! npm run build; then
    echo "❌ Web build failed; package creation stopped. Fix the build errors and retry." >&2
    exit 1
fi
if [ ! -f "dist/public/index.html" ]; then
    echo "❌ Web build did not produce dist/public/index.html; package creation stopped." >&2
    exit 1
fi

# Get version from pyproject.toml or use default (compatible with both GNU and BSD grep)
VERSION=$(grep '^version = ' python/pyproject.toml 2>/dev/null | head -1 | sed 's/version = "\(.*\)"/\1/' || echo "1.0.0")

# Detect architecture (all for Python-based package)
ARCH="all"

# Create package directory structure
PKG_NAME="sketchatone_${VERSION}_${ARCH}"
PKG_DIR="$OUTPUT_DIR/$PKG_NAME"

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

# Remove __pycache__ directories
find "$PKG_DIR/opt/sketchatone/python" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Copy config files
echo "📦 Copying config files..."
if [ -d "public/configs" ]; then
    cp -R public/configs/* "$PKG_DIR/opt/sketchatone/configs/"
    echo "  → Config files included:"
    ls -la "$PKG_DIR/opt/sketchatone/configs/" 2>/dev/null || echo "    (none)"
fi

# Let dpkg preserve locally edited presets across upgrades and removal.
find "$PKG_DIR/opt/sketchatone/configs" -type f | sed "s|^$PKG_DIR||" \
    > "$PKG_DIR/DEBIAN/conffiles"

# Copy built webapp if it exists
# Server expects files at dist/public relative to the python directory
if [ -d "dist/public" ]; then
    echo "📦 Copying webapp..."
    mkdir -p "$PKG_DIR/opt/sketchatone/dist/public"
    cp -R dist/public/* "$PKG_DIR/opt/sketchatone/dist/public/"
fi

# Copy setup scripts
if [ -f "$SCRIPT_DIR/sketchatone-setup" ]; then
    cp "$SCRIPT_DIR/sketchatone-setup" "$PKG_DIR/usr/bin/sketchatone-setup"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-setup"
    echo "📦 Including setup script"
else
    echo "⚠️  Warning: sketchatone-setup not found"
fi

# Copy optional setup scripts
if [ -f "$SCRIPT_DIR/setup-usb-midi-gadget.sh" ]; then
    cp "$SCRIPT_DIR/setup-usb-midi-gadget.sh" "$PKG_DIR/usr/bin/sketchatone-setup-usb-gadget"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-setup-usb-gadget"
    echo "📦 Including USB MIDI gadget setup script"
fi

if [ -f "$SCRIPT_DIR/setup-pi-boot-trim.sh" ]; then
    cp "$SCRIPT_DIR/setup-pi-boot-trim.sh" "$PKG_DIR/usr/bin/sketchatone-boot-trim"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-boot-trim"
    echo "📦 Including boot-trim script"
fi

if [ -f "$SCRIPT_DIR/sketchatone-configure" ]; then
    cp "$SCRIPT_DIR/sketchatone-configure" "$PKG_DIR/usr/bin/sketchatone-configure"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-configure"
    echo "📦 Including interactive configure menu"
fi

# Create launcher script in /usr/bin
# This script detects JACK availability at runtime
cat > "$PKG_DIR/usr/bin/sketchatone" << 'BINEOF'
#!/bin/bash
# Sketchatone launcher - runs Python module directly with runtime JACK detection
export PYTHONPATH="/opt/sketchatone/python:$PYTHONPATH"

# Use only matching Python packages from Zynthian for optional JACK support.
PYTHON=/opt/sketchatone/venv/bin/python
PYTHON_VERSION="$("$PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ZYNTHIAN_PACKAGES="/zynthian/venv/lib/python${PYTHON_VERSION}/site-packages"
if [ -d "$ZYNTHIAN_PACKAGES" ]; then
    export PYTHONPATH="$PYTHONPATH:$ZYNTHIAN_PACKAGES"
fi

exec "$PYTHON" -m sketchatone.cli.server "$@"
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
Environment="DISPLAY=:0"
# Delay startup to ensure JACK is fully ready if present (helps with Zynthian boot)
ExecStartPre=/bin/sleep 3
# --poll 2000: keep the server running while waiting for a tablet to be plugged in,
# instead of exiting (which would loop indefinitely under Restart=on-failure and prevent
# the web UI from ever being reachable on always-on setups).
ExecStart=/usr/bin/sketchatone -c /opt/sketchatone/configs/config.json --poll 2000 --network-config /etc/sketchatone/network.json
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
Depends: python3 (>= 3.11), python3-venv, python3-rtmidi, python3-evdev, libhidapi-hidraw0, libhidapi-dev, libusb-1.0-0-dev, libudev-dev, pkg-config, libasound2, libasound2-dev, python3-dev, build-essential
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
set -eE
trap 'echo "ERROR: Sketchatone installation failed at line $LINENO. Fix the error above and run sudo dpkg --configure sketchatone." >&2' ERR

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

# Use the distribution interpreter, never system pip or a downloaded Python.
echo ""
echo "📦 Installing Python dependencies..."
/usr/bin/python3 -c 'import sys; sys.exit("Sketchatone requires stock Python 3.11 or newer (Raspberry Pi OS Bookworm+).") if sys.version_info < (3, 11) else None'
# Re-running venv refreshes its interpreter/config without deleting installed
# packages. System site packages expose apt's native rtmidi and evdev builds.
/usr/bin/python3 -m venv --system-site-packages /opt/sketchatone/venv
PYTHON=/opt/sketchatone/venv/bin/python
"$PYTHON" -m pip install --upgrade pip setuptools wheel Cython
# hidapi's ordinary wheel uses libusb rather than the tablet hidraw backend.
HIDAPI_WITH_HIDRAW=1 "$PYTHON" -m pip install \
    --no-binary hidapi --force-reinstall --no-cache-dir \
    --no-build-isolation 'hidapi>=0.14.0'
# Resolve every required dependency (including pyusb) from the manifest.
"$PYTHON" -m pip install --upgrade -e /opt/sketchatone/python
"$PYTHON" -c 'import websockets, hid, inquirer, colorama, cryptography, rtmidi, evdev, usb.core'

# Install the service only after all required dependencies are ready.
cp /opt/sketchatone/sketchatone.service /etc/systemd/system/sketchatone.service

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
# Device networking is separate from presets and disabled until explicitly configured.
# Do not overwrite existing credentials or install/activate NetworkManager on upgrades.
install -d -m 700 /etc/sketchatone
if [ -f /etc/sketchatone/network.json ]; then
    chmod 600 /etc/sketchatone/network.json
fi
systemctl daemon-reload

# Detect the currently-configured mode so upgrades don't clobber user choice.
# Matches the detection logic in sketchatone-setup's show_status.
detect_current_mode() {
    if [ -f /etc/udev/rules.d/99-sketchatone.rules ] \
        && grep -q "SYSTEMD_WANTS" /etc/udev/rules.d/99-sketchatone.rules 2>/dev/null; then
        echo "usb-trigger"
    elif systemctl is-enabled --quiet sketchatone 2>/dev/null; then
        echo "always-on"
    else
        echo "manual"
    fi
}

# dpkg passes the previously-configured version in $2 on upgrade, empty on first install.
# First install → use default mode (usb-trigger).
# Upgrade/reinstall → preserve existing mode (e.g. always-on set by the user).
# Either way, we still re-run sketchatone-setup so udev rules are regenerated against
# the (possibly updated) device configs shipped in this version.
echo ""
echo "🔧 Setting up udev rules and auto-start..."
if [ -z "${2:-}" ]; then
    INSTALL_MODE="usb-trigger"
    echo "  → First install, using default mode: $INSTALL_MODE"
else
    INSTALL_MODE="$(detect_current_mode)"
    echo "  → Upgrade from ${2}, preserving existing mode: $INSTALL_MODE"
fi

if [ -x /usr/bin/sketchatone-setup ]; then
    /usr/bin/sketchatone-setup --mode "$INSTALL_MODE"
else
    echo "⚠️  Warning: sketchatone-setup not found, skipping udev configuration"
fi

echo ""
echo "=========================================="
echo "✅ Sketchatone installed successfully!"
echo "=========================================="
echo ""
echo "Environment: $DETECTED_ENV"
echo "Auto-start mode: $INSTALL_MODE"
echo ""
echo "Configure MIDI backend (ALSA/JACK) and other settings via the web UI:"
echo "  http://$(hostname -I | awk '{print $1}')"
echo ""
echo "To run manually:"
echo "  sketchatone -c /opt/sketchatone/configs/config.json"
echo ""
echo "Optional setup (interactive menu covers autostart mode, USB MIDI gadget,"
echo "and boot-time trimming):"
echo "  sudo sketchatone-configure"
echo ""

exit 0
POSTINSTEOF
chmod +x "$PKG_DIR/DEBIAN/postinst"

# Create prerm script (runs before uninstall or upgrade)
# $1 distinguishes "upgrade" from "remove"/"purge" - we must NOT disable the service
# or wipe udev rules on upgrade, otherwise the new postinst's mode-detection will
# see disabled + no rules and "preserve" mode as manual, silently breaking always-on.
cat > "$PKG_DIR/DEBIAN/prerm" << 'PRERMEOF'
#!/bin/bash
set -e

case "$1" in
    upgrade|deconfigure)
        # Stop the running process so files can be replaced cleanly,
        # but leave enable/disable state and udev rules intact for postinst.
        if systemctl is-active --quiet sketchatone 2>/dev/null; then
            echo "Stopping Sketchatone service for upgrade..."
            systemctl stop sketchatone
        fi
        ;;
    remove|purge|failed-upgrade)
        if systemctl is-active --quiet sketchatone 2>/dev/null; then
            echo "Stopping Sketchatone service..."
            systemctl stop sketchatone
        fi
        if systemctl is-enabled --quiet sketchatone 2>/dev/null; then
            echo "Disabling Sketchatone service..."
            systemctl disable sketchatone
        fi
        if [ -f /etc/udev/rules.d/99-sketchatone.rules ]; then
            echo "Removing udev rules..."
            rm -f /etc/udev/rules.d/99-sketchatone.rules
            udevadm control --reload-rules 2>/dev/null || true
        fi
        ;;
esac

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
echo "Note: The private virtual environment and user configuration were retained."

exit 0
POSTRMEOF
chmod +x "$PKG_DIR/DEBIAN/postrm"

# Strip macOS metadata that would otherwise be packaged and surface as
# binary "._*" files on the Pi (finddevice.py crashes on those).
find "$PKG_DIR" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

# Generators own only their package artifacts, never the shared bundle helper.
if [ "$TREE_ONLY" -eq 0 ] && command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --build "$PKG_DIR" "$OUTPUT_DIR/sketchatone-${VERSION}.deb"
    rm -rf "$PKG_DIR"
else
    echo "Package tree: $PKG_DIR"
    echo "Use ./package-for-pi.sh for the unified release bundle and installer."
fi
