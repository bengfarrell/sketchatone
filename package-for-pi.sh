#!/bin/bash
# Package Sketchatone for Raspberry Pi / Zynthian
# Creates a ready-to-install .deb package (no build needed on Pi)
#
# Usage:
#   ./package-for-pi.sh                  # default web variant (current behavior)
#   ./package-for-pi.sh --variant web    # explicit web variant
#   ./package-for-pi.sh --variant ui     # Kivy UI variant (no webapp)

set -e

VARIANT="web"
while [ $# -gt 0 ]; do
    case "$1" in
        --variant)
            VARIANT="${2:-}"
            shift 2
            ;;
        --variant=*)
            VARIANT="${1#--variant=}"
            shift
            ;;
        *)
            echo "❌ Unknown argument: $1"
            echo "Usage: $0 [--variant web|ui]"
            exit 1
            ;;
    esac
done

if [ "$VARIANT" != "web" ] && [ "$VARIANT" != "ui" ]; then
    echo "❌ Invalid variant: '$VARIANT' (expected 'web' or 'ui')"
    exit 1
fi

echo "=========================================="
echo "Sketchatone - Package for Raspberry Pi"
echo "Variant: $VARIANT"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "python/pyproject.toml" ]; then
    echo "❌ Error: Must be run from the sketchatone project root"
    exit 1
fi

# Get version from pyproject.toml (compatible with both GNU and BSD grep)
VERSION=$(grep '^version = ' python/pyproject.toml 2>/dev/null | head -1 | sed 's/version = "\(.*\)"/\1/' || echo "1.0.0")
echo "📦 Version: $VERSION"

# Webapp build is only needed for the web variant.
if [ "$VARIANT" = "web" ] && [ ! -d "dist/public" ]; then
    echo ""
    echo "🔨 Building webapp..."
    npm run build
fi

echo ""
echo "📁 Setting up package structure..."

# Create dist directory if needed
mkdir -p dist

# Run the appropriate create-deb script for the chosen variant
echo ""
if [ "$VARIANT" = "ui" ]; then
    ./install-scripts/create-deb-ui.sh
    PKG_BASE="sketchatone-ui"
    INSTALLER_SCRIPT="install-sketchatone-ui.sh"
else
    ./install-scripts/create-deb.sh
    PKG_BASE="sketchatone"
    INSTALLER_SCRIPT="install-sketchatone.sh"
fi

# Show final package info based on what was created
DEB_FILE="dist/${PKG_BASE}-${VERSION}.deb"
TARBALL="dist/${PKG_BASE}-${VERSION}-deb-pkg.tar.gz"

if [ -f "$DEB_FILE" ]; then
    # Direct .deb was created (Linux)
    SIZE=$(ls -lh "$DEB_FILE" | awk '{print $5}')
    echo ""
    echo "=========================================="
    echo "✅ Ready-to-install package created!"
    echo "=========================================="
    echo ""
    echo "Package: $DEB_FILE"
    echo "Size: $SIZE"
    echo ""
    echo "To install on Raspberry Pi / Zynthian:"
    echo ""
    echo "  # Copy to Pi"
    echo "  scp $DEB_FILE sketchy@sketchatone.local:~/"
    echo ""
    echo "  # On the Pi (that's it!):"
    echo "  apt install ./${PKG_BASE}-${VERSION}.deb"
    echo ""
elif [ -f "$TARBALL" ]; then
    # Tarball was created (macOS)
    SIZE=$(ls -lh "$TARBALL" | awk '{print $5}')
    echo ""
    echo "=========================================="
    echo "✅ Package files created!"
    echo "=========================================="
    echo ""
    echo "Package: $TARBALL ($SIZE)"
    echo "Installer: dist/${INSTALLER_SCRIPT}"
    echo ""
    echo "To install on Raspberry Pi / Zynthian:"
    echo ""
    echo "  # Copy files to Pi"
    echo "  scp $TARBALL dist/${INSTALLER_SCRIPT} sketchy@sketchatone.local:~/"
    echo ""
    echo "  # On the Pi:"
    echo "  ./${INSTALLER_SCRIPT}"
    echo ""
fi
