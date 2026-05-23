#!/bin/bash
# Package Sketchatone for Raspberry Pi / Zynthian
# Creates a ready-to-install .deb package (no build needed on Pi)

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

# Get version from pyproject.toml (compatible with both GNU and BSD grep)
VERSION=$(grep '^version = ' python/pyproject.toml 2>/dev/null | head -1 | sed 's/version = "\(.*\)"/\1/' || echo "1.0.0")
echo "📦 Version: $VERSION"

# Check if webapp needs to be built
if [ ! -d "dist/public" ]; then
    echo ""
    echo "🔨 Building webapp..."
    npm run build
fi

# Set up blankslate directory structure for create-deb.sh
# Source is fetched into a git-ignored local cache pinned to BLANKSLATE_REF.
BLANKSLATE_REPO="https://github.com/bengfarrell/blankslate.git"
BLANKSLATE_REF="v1.0.0"
BLANKSLATE_CACHE=".blankslate-build"
BLANKSLATE_SRC="$BLANKSLATE_CACHE/python"
BLANKSLATE_DEST="blankslate"

echo ""
echo "📁 Setting up package structure..."

# Ensure the cached blankslate source exists at the expected ref.
ensure_blankslate_cache() {
    if [ -d "$BLANKSLATE_CACHE/.git" ]; then
        local current_ref
        current_ref=$(git -C "$BLANKSLATE_CACHE" describe --tags --exact-match 2>/dev/null \
            || git -C "$BLANKSLATE_CACHE" rev-parse HEAD)
        if [ "$current_ref" = "$BLANKSLATE_REF" ]; then
            echo "  → blankslate cache present at $BLANKSLATE_REF"
            return 0
        fi
        echo "  → blankslate cache at '$current_ref', updating to '$BLANKSLATE_REF'..."
        git -C "$BLANKSLATE_CACHE" fetch --tags --depth 1 origin "$BLANKSLATE_REF" \
            || { echo "❌ Error: failed to fetch '$BLANKSLATE_REF' from $BLANKSLATE_REPO"; exit 1; }
        git -C "$BLANKSLATE_CACHE" checkout --quiet "$BLANKSLATE_REF" \
            || { echo "❌ Error: failed to checkout '$BLANKSLATE_REF'"; exit 1; }
    else
        echo "  → Cloning blankslate $BLANKSLATE_REF into $BLANKSLATE_CACHE..."
        rm -rf "$BLANKSLATE_CACHE"
        git clone --depth 1 --branch "$BLANKSLATE_REF" "$BLANKSLATE_REPO" "$BLANKSLATE_CACHE" \
            || { echo "❌ Error: failed to clone $BLANKSLATE_REPO at '$BLANKSLATE_REF'"; exit 1; }
    fi
}

ensure_blankslate_cache

if [ ! -d "$BLANKSLATE_SRC" ]; then
    echo "❌ Error: blankslate python source not found at $BLANKSLATE_SRC after fetch"
    exit 1
fi

echo "  → Staging blankslate dependency..."
rm -rf "$BLANKSLATE_DEST"
mkdir -p "$BLANKSLATE_DEST"
cp "$BLANKSLATE_SRC/pyproject.toml" "$BLANKSLATE_DEST/"
cp -R "$BLANKSLATE_SRC/blankslate" "$BLANKSLATE_DEST/"
find "$BLANKSLATE_DEST" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Create dist directory if needed
mkdir -p dist

# Run create-deb.sh to build the package
echo ""
./create-deb.sh

# Clean up temporary blankslate directory
echo "🧹 Cleaning up temporary files..."
rm -rf "$BLANKSLATE_DEST"

# Show final package info based on what was created
DEB_FILE="dist/sketchatone-${VERSION}.deb"
TARBALL="dist/sketchatone-${VERSION}-deb-pkg.tar.gz"

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
    echo "  scp $DEB_FILE root@synth.local:~/"
    echo ""
    echo "  # On the Pi (that's it!):"
    echo "  apt install ./sketchatone-${VERSION}.deb"
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
    echo "Installer: dist/install-sketchatone.sh"
    echo ""
    echo "To install on Raspberry Pi / Zynthian:"
    echo ""
    echo "  # Copy files to Pi"
    echo "  scp $TARBALL dist/install-sketchatone.sh root@synth.local:~/"
    echo ""
    echo "  # On the Pi:"
    echo "  ./install-sketchatone.sh"
    echo ""
fi
