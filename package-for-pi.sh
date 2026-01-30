#!/bin/bash
# Package Sketchatone for Raspberry Pi / Zynthian build
# Creates a minimal tarball with everything needed to build on the Pi

set -e

echo "=========================================="
echo "Sketchatone - Package for Raspberry Pi"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "python/pyproject.toml" ]; then
    echo "❌ Error: Must be run from the sketchatone project root"
    exit 1
fi

# Get version from pyproject.toml
VERSION=$(grep -oP 'version = "\K[^"]+' python/pyproject.toml 2>/dev/null || echo "1.0.0")
echo "📦 Version: $VERSION"

# Check if webapp needs to be built
if [ ! -d "dist/public" ]; then
    echo ""
    echo "🔨 Building webapp..."
    npm run build
fi

# Create temp directory for packaging
PACKAGE_NAME="sketchatone-${VERSION}-pi-build"
TEMP_DIR=$(mktemp -d)
PACKAGE_DIR="$TEMP_DIR/$PACKAGE_NAME"

echo ""
echo "📁 Creating package structure..."
mkdir -p "$PACKAGE_DIR"

# Copy Python source (excluding venv, __pycache__, tests, egg-info)
echo "  → python/ (source code)"
mkdir -p "$PACKAGE_DIR/python"
cp python/pyproject.toml "$PACKAGE_DIR/python/"
cp -R python/sketchatone "$PACKAGE_DIR/python/"
# Remove __pycache__ directories
find "$PACKAGE_DIR/python" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Copy built webapp
echo "  → dist/public/ (built webapp)"
mkdir -p "$PACKAGE_DIR/dist"
cp -R dist/public "$PACKAGE_DIR/dist/"

# Copy configs
echo "  → public/configs/ (device configs)"
mkdir -p "$PACKAGE_DIR/public"
cp -R public/configs "$PACKAGE_DIR/public/"

# Copy build scripts
echo "  → build scripts"
cp build-linux.sh "$PACKAGE_DIR/"
cp create-deb.sh "$PACKAGE_DIR/"
cp sketchatone-setup "$PACKAGE_DIR/"
cp python/sketchatone-linux.spec "$PACKAGE_DIR/python/"

# Make scripts executable
chmod +x "$PACKAGE_DIR/build-linux.sh"
chmod +x "$PACKAGE_DIR/create-deb.sh"
chmod +x "$PACKAGE_DIR/sketchatone-setup"

# Create a README for the Pi build
cat > "$PACKAGE_DIR/README-PI-BUILD.md" << 'README_EOF'
# Sketchatone - Raspberry Pi Build Package

This package contains everything needed to build Sketchatone on a Raspberry Pi or Zynthian.

## Prerequisites

On the Pi, you need:
- Python 3.8+ (included in Raspberry Pi OS)
- blankslate package (clone from GitHub)

## Build Instructions

```bash
# 1. Set up Python environment
cd python
python3 -m venv venv
source venv/bin/activate
pip install -e .

# 2. Install blankslate (adjust path as needed)
pip install -e /path/to/blankslate/python

# 3. Build standalone application
cd ..
./build-linux.sh

# 4. Create .deb package
./create-deb.sh

# 5. Install
sudo apt install ./dist/sketchatone-*.deb

# 6. Configure auto-start mode
sudo sketchatone-setup --mode usb-trigger
```

## Auto-Start Modes

- `usb-trigger` - Start when tablet is plugged in (recommended)
- `always-on` - Start on system boot
- `manual` - No auto-start

## More Information

See the full documentation at: https://bengfarrell.github.io/sketchatone/
README_EOF

# Create the tarball
echo ""
echo "📦 Creating tarball..."
cd "$TEMP_DIR"
tar czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
mv "${PACKAGE_NAME}.tar.gz" "$OLDPWD/dist/"
cd "$OLDPWD"

# Clean up
rm -rf "$TEMP_DIR"

# Show package info
TARBALL="dist/${PACKAGE_NAME}.tar.gz"
SIZE=$(ls -lh "$TARBALL" | awk '{print $5}')

echo ""
echo "=========================================="
echo "✅ Package created successfully!"
echo "=========================================="
echo ""
echo "Package: $TARBALL"
echo "Size: $SIZE"
echo ""
echo "To deploy to Raspberry Pi:"
echo ""
echo "  # Copy to Pi"
echo "  scp $TARBALL pi@<pi-hostname>:~/"
echo ""
echo "  # On the Pi:"
echo "  tar xzf ${PACKAGE_NAME}.tar.gz"
echo "  cd $PACKAGE_NAME"
echo "  # Follow instructions in README-PI-BUILD.md"
echo ""
