#!/bin/bash
# Create a Debian package installer for the Sketchatone Kivy UI variant.
# Separate from create-deb.sh: this variant ships Python source only (no
# webapp, no kiosk script, no systemd service, no udev wiring). Intended
# for the in-progress native (Kivy) UI build.

set -e

echo "=========================================="
echo "Sketchatone UI - Debian Package Creator"
echo "=========================================="
echo ""

if [ ! -d "python/sketchatone" ]; then
    echo "❌ Error: Python source not found at python/sketchatone"
    exit 1
fi

if [ ! -d "blankslate/blankslate" ]; then
    echo "❌ Error: Blankslate source not found at blankslate/blankslate"
    exit 1
fi

VERSION=$(grep '^version = ' python/pyproject.toml 2>/dev/null | head -1 | sed 's/version = "\(.*\)"/\1/' || echo "1.0.0")
ARCH="all"

PKG_NAME="sketchatone-ui_${VERSION}_${ARCH}"
PKG_DIR="dist/$PKG_NAME"

echo "📦 Package: sketchatone-ui"
echo "📦 Version: $VERSION"
echo "📦 Architecture: $ARCH (Python-based, UI variant)"
echo ""

echo "🗂️  Creating Debian package structure..."
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/opt/sketchatone-ui/python"
mkdir -p "$PKG_DIR/opt/sketchatone-ui/configs"
mkdir -p "$PKG_DIR/usr/bin"

echo "📦 Copying Python source files..."
echo "  → sketchatone package"
cp -R python/sketchatone "$PKG_DIR/opt/sketchatone-ui/python/"
cp python/pyproject.toml "$PKG_DIR/opt/sketchatone-ui/python/"

echo "  → blankslate package"
cp -RL blankslate/blankslate "$PKG_DIR/opt/sketchatone-ui/python/"
cp -L blankslate/pyproject.toml "$PKG_DIR/opt/sketchatone-ui/python/blankslate-pyproject.toml"

find "$PKG_DIR/opt/sketchatone-ui/python" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

echo "📦 Copying config files..."
if [ -d "public/configs" ]; then
    cp -R public/configs/* "$PKG_DIR/opt/sketchatone-ui/configs/"
fi

# Launcher: runs the UI stub (Kivy entry point once implemented).
cat > "$PKG_DIR/usr/bin/sketchatone-ui" << 'BINEOF'
#!/bin/bash
# Sketchatone UI launcher (Kivy variant)
export PYTHONPATH="/opt/sketchatone-ui/python:$PYTHONPATH"

if [ -d "/zynthian/venv/lib/python3.11/site-packages" ]; then
    export PYTHONPATH="$PYTHONPATH:/zynthian/venv/lib/python3.11/site-packages"
fi

exec python3 -m sketchatone.cli.ui "$@"
BINEOF
chmod +x "$PKG_DIR/usr/bin/sketchatone-ui"

# Optional autostart helper (labwc autostart on Pi OS Bookworm).
if [ -f "setup-ui-autostart.sh" ]; then
    cp setup-ui-autostart.sh "$PKG_DIR/usr/bin/sketchatone-ui-setup-autostart"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-ui-setup-autostart"
    echo "📦 Including UI autostart setup script"
else
    echo "⚠️  Warning: setup-ui-autostart.sh not found"
fi

# Optional boot-time trimmer (service masks, cmdline tweaks, ssh.socket).
if [ -f "setup-pi-boot-trim.sh" ]; then
    cp setup-pi-boot-trim.sh "$PKG_DIR/usr/bin/sketchatone-ui-boot-trim"
    chmod +x "$PKG_DIR/usr/bin/sketchatone-ui-boot-trim"
    echo "📦 Including boot trimmer script"
else
    echo "⚠️  Warning: setup-pi-boot-trim.sh not found"
fi

cat > "$PKG_DIR/DEBIAN/control" << CONTROLEOF
Package: sketchatone-ui
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Depends: python3 (>= 3.8), python3-pip, python3-setuptools, cython3, libhidapi-hidraw0, libhidapi-dev, libusb-1.0-0-dev, libudev-dev, pkg-config, libasound2, python3-dev, build-essential, libmtdev1
Recommends: python3-rtmidi
Maintainer: Sketchatone Project
Description: Sketchatone (Kivy UI variant)
 Native Python (Kivy) UI build of Sketchatone. Ships the Python source,
 a launcher, and an autostart helper that launches the UI directly via
 SDL2's kmsdrm backend on Raspberry Pi OS Bookworm (no Wayland
 compositor required). No web UI, no kiosk script, no systemd service.
 .
 Run manually after install:
   sketchatone-ui -c /opt/sketchatone-ui/configs/config.json
 .
 Configure auto-launch on boot:
   sudo sketchatone-ui-setup-autostart
CONTROLEOF

cat > "$PKG_DIR/DEBIAN/postinst" << 'POSTINSTEOF'
#!/bin/bash
set -e

echo ""
echo "=========================================="
echo "Sketchatone UI Installation"
echo "=========================================="

install_package() {
    local package="$1"
    pip3 install --break-system-packages "$package" 2>/dev/null && return 0
    pip3 install "$package" 2>/dev/null && return 0
    return 1
}

# cython-hidapi ships a manylinux wheel built with the libusb backend
# (paths like b'1-1.1:1.0'). Our HID code uses open_path() and expects
# the hidraw backend (paths like b'/dev/hidraw0'), so force a source
# build with HIDAPI_WITH_HIDRAW=1. PEP-517 build isolation hides env
# vars from the build backend, so disable it and rely on the apt
# build deps (python3-setuptools, cython3) listed in Depends.
install_hidapi_hidraw() {
    HIDAPI_WITH_HIDRAW=1 pip3 install --break-system-packages \
        --no-binary :all: --force-reinstall --no-cache-dir \
        --no-build-isolation 'hidapi>=0.14.0' 2>/dev/null && return 0
    HIDAPI_WITH_HIDRAW=1 pip3 install \
        --no-binary :all: --force-reinstall --no-cache-dir \
        --no-build-isolation 'hidapi>=0.14.0' 2>/dev/null && return 0
    return 1
}

echo "📦 Installing Python dependencies..."
install_package "websockets>=11.0.0" || echo "⚠️  websockets install failed"
install_hidapi_hidraw                  || echo "⚠️  hidapi (hidraw) install failed"
install_package "inquirer>=3.1.0"     || echo "⚠️  inquirer install failed"
install_package "colorama>=0.4.6"     || echo "⚠️  colorama install failed"
install_package "cryptography>=41.0.0" || echo "⚠️  cryptography install failed"
install_package "evdev>=1.6.0"        || echo "⚠️  evdev install failed"
install_package "typing-extensions>=4.0.0" || true

if apt-cache show python3-rtmidi >/dev/null 2>&1; then
    apt-get install -y python3-rtmidi || install_package "python-rtmidi>=1.5.0" || true
else
    install_package "python-rtmidi>=1.5.0" || echo "⚠️  python-rtmidi install failed"
fi

echo "📦 Installing Kivy (UI toolkit)..."
if apt-cache show python3-kivy >/dev/null 2>&1; then
    apt-get install -y python3-kivy || install_package "kivy>=2.3.0" || echo "⚠️  kivy install failed"
else
    install_package "kivy>=2.3.0" || echo "⚠️  kivy install failed"
fi

echo "📦 Installing sketchatone package (no-deps; blankslate vendored)..."
cd /opt/sketchatone-ui/python
pip3 install --break-system-packages --no-deps -e . 2>/dev/null \
    || pip3 install --no-deps -e . 2>/dev/null \
    || echo "⚠️  sketchatone package install failed (version may show as 0.0.0-dev)"
cd - >/dev/null

chmod +x /usr/bin/sketchatone-ui

if [ ! -f /opt/sketchatone-ui/configs/config.json ]; then
    if [ -f /opt/sketchatone-ui/configs/sample-config.json ]; then
        cp /opt/sketchatone-ui/configs/sample-config.json /opt/sketchatone-ui/configs/config.json
    elif [ -f /opt/sketchatone-ui/configs/default.json ]; then
        cp /opt/sketchatone-ui/configs/default.json /opt/sketchatone-ui/configs/config.json
    fi
fi

echo ""
echo "✅ Sketchatone UI installed."
echo "Run manually:     sketchatone-ui -c /opt/sketchatone-ui/configs/config.json"
echo "Autostart on boot: sudo sketchatone-ui-setup-autostart"
echo ""
exit 0
POSTINSTEOF
chmod +x "$PKG_DIR/DEBIAN/postinst"

# Strip macOS metadata that would otherwise be packaged and surface as
# binary "._*" files on the Pi.
find "$PKG_DIR" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

echo ""
echo "💿 Building Debian package..."

if command -v dpkg-deb &> /dev/null; then
    dpkg-deb --build "$PKG_DIR"
    mv "${PKG_DIR}.deb" "dist/sketchatone-ui-${VERSION}.deb"
    rm -rf "$PKG_DIR"
    echo ""
    echo "✅ Package: dist/sketchatone-ui-${VERSION}.deb"
    echo "Install on Pi:  sudo apt install ./dist/sketchatone-ui-${VERSION}.deb"
else
    echo "  (dpkg-deb not available - creating package structure tarball)"
    TARBALL="dist/sketchatone-ui-${VERSION}-deb-pkg.tar.gz"
    cd dist
    COPYFILE_DISABLE=1 tar --no-mac-metadata --exclude='._*' --exclude='.DS_Store' \
        -czf "sketchatone-ui-${VERSION}-deb-pkg.tar.gz" "$PKG_NAME" 2>/dev/null \
        || COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='.DS_Store' \
            -czf "sketchatone-ui-${VERSION}-deb-pkg.tar.gz" "$PKG_NAME"
    cd ..

    cat > "dist/install-sketchatone-ui.sh" << INSTALLEOF
#!/bin/bash
set -e
echo "Installing Sketchatone UI ${VERSION}..."
tar xzf sketchatone-ui-${VERSION}-deb-pkg.tar.gz
dpkg-deb --build sketchatone-ui_${VERSION}_all
apt install -y --allow-downgrades ./sketchatone-ui_${VERSION}_all.deb
rm -rf sketchatone-ui_${VERSION}_all sketchatone-ui-${VERSION}-deb-pkg.tar.gz install-sketchatone-ui.sh
echo ""
echo "✅ Sketchatone UI installed."
echo "Run: sketchatone-ui -c /opt/sketchatone-ui/configs/config.json"
INSTALLEOF
    chmod +x "dist/install-sketchatone-ui.sh"
    rm -rf "$PKG_DIR"

    echo ""
    echo "✅ Files created:"
    echo "  - $TARBALL"
    echo "  - dist/install-sketchatone-ui.sh"
fi
