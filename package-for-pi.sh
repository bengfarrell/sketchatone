#!/bin/bash
# One release bundle: core by default, optional native UI at installation.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
while [ $# -gt 0 ]; do
    case "$1" in
        --variant)
            [ $# -ge 2 ] || { echo "Missing --variant value" >&2; exit 2; }
            case "$2" in web|ui) ;; *) echo "Unknown variant: $2" >&2; exit 2 ;; esac
            echo "Deprecated: --variant now builds the same unified bundle; select --with-ui when installing." >&2
            shift 2 ;;
        --variant=web|--variant=ui)
            echo "Deprecated: --variant now builds the same unified bundle; select --with-ui when installing." >&2
            shift ;;
        *) echo "Usage: $0 (install with --with-ui and/or --appliance on the Pi)" >&2; exit 2 ;;
    esac
done
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' python/pyproject.toml | head -1)
[ -n "$VERSION" ] || { echo "Missing package version" >&2; exit 1; }
mkdir -p dist
# Unique staging beneath the project; failed builds retain artifacts for diagnosis.
STAGE="$SCRIPT_DIR/dist/.pi-release-${VERSION}-$$"
mkdir "$STAGE"
./install-scripts/create-deb.sh --output-dir "$STAGE"
./install-scripts/create-deb-ui.sh --output-dir "$STAGE"
BUNDLE="sketchatone-${VERSION}-pi-bundle.tar.gz"
COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='.DS_Store' \
    -czf "dist/$BUNDLE" -C "$STAGE" .
rm -rf "$STAGE"

# A versioned header lets the script body remain literal and syntax-checkable.
printf '#!/bin/bash\nVERSION=%q\n' "$VERSION" > dist/install-sketchatone.sh
cat >> dist/install-sketchatone.sh << 'INSTALLEOF'
set -eE
WORK=""
trap 'echo "Installation failed at line $LINENO. Bundle and installer retained; retry with the same options. Extracted files: ${WORK:-not yet extracted}" >&2' ERR
WITH_UI=0
APPLIANCE=0
for arg in "$@"; do
    case "$arg" in
        --with-ui) WITH_UI=1 ;;
        --appliance) APPLIANCE=1 ;;
        *) echo "Usage: sudo bash install-sketchatone.sh [--with-ui] [--appliance]" >&2; exit 2 ;;
    esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run this installer as root (sudo)." >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="$SCRIPT_DIR/sketchatone-${VERSION}-pi-bundle.tar.gz"
[ -f "$BUNDLE" ] || { echo "Missing bundle: $BUNDLE" >&2; exit 1; }
umask 077
WORK="$SCRIPT_DIR/.sketchatone-install-${VERSION}-$$"
mkdir "$WORK"
tar xzf "$BUNDLE" -C "$WORK"
PACKAGES=()
SELECTED=(sketchatone)
[ "$WITH_UI" -eq 0 ] || SELECTED+=(sketchatone-ui)
for package in "${SELECTED[@]}"; do
    DEB="$WORK/${package}-${VERSION}.deb"
    if [ ! -f "$DEB" ]; then
        dpkg-deb --build "$WORK/${package}_${VERSION}_all" "$DEB"
    fi
    PACKAGES+=("$DEB")
done
# Resolve the addon and its exact-version core dependency in one transaction.
apt install -y --allow-downgrades "${PACKAGES[@]}"
if [ "$APPLIANCE" -eq 1 ]; then
    sketchatone-configure --appliance
fi
# Delete only the extraction directory this invocation created, never inputs.
rm -rf "$WORK"
echo "Sketchatone installed. Bundle and installer retained for reuse."
INSTALLEOF
chmod +x dist/install-sketchatone.sh
echo "Release: dist/$BUNDLE"
echo "Installer: dist/install-sketchatone.sh"
echo ""
echo "Copy to the Pi (replace sketchy@sketchatone.local if your SSH user or hostname differs):"
echo "  scp dist/$BUNDLE dist/install-sketchatone.sh sketchy@sketchatone.local:~/"
echo "Copy both files to the Pi, then: sudo bash install-sketchatone.sh [--with-ui] [--appliance]"
