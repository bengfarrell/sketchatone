#!/bin/bash
# Optional native UI addon. The core package owns all runtime source and config.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' python/pyproject.toml | head -1)
PKG_NAME="sketchatone-ui_${VERSION}_all"
PKG_DIR="$OUTPUT_DIR/$PKG_NAME"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN" "$PKG_DIR/usr/bin"

cat > "$PKG_DIR/usr/bin/sketchatone-ui" << 'BINEOF'
#!/bin/bash
set -e
export PYTHONPATH="/opt/sketchatone/python:${PYTHONPATH:-}"
PYTHON=/opt/sketchatone/venv/bin/python
# Explicit URLs take precedence, with no duplicate --connect arguments.
for arg in "$@"; do
    case "$arg" in
        --connect|--connect=*) exec "$PYTHON" -m sketchatone.cli.ui "$@" ;;
    esac
done
URL="${SKETCHATONE_UI_URL:-}"
if [ -z "$URL" ]; then
    URL="$("$PYTHON" -c '
import sys
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
path = "/opt/sketchatone/configs/config.json"
try:
    config = MidiStrummerConfig.from_json_file(path)
except FileNotFoundError:
    port = 8081
except (OSError, ValueError, TypeError, AttributeError) as error:
    sys.exit(f"Cannot read Sketchatone service config {path}: {error}")
else:
    port = config.ws_port if config.ws_port is not None else 8081
    if isinstance(port, bool) or not str(port).isdigit() or not 1 <= int(port) <= 65535:
        sys.exit(f"Invalid WebSocket port in Sketchatone service config {path}: {port!r}")
print(f"ws://127.0.0.1:{port}")
')"
fi
exec "$PYTHON" -m sketchatone.cli.ui --connect "$URL" "$@"
BINEOF
chmod +x "$PKG_DIR/usr/bin/sketchatone-ui"

for helper in setup-ui-autostart.sh setup-pi-boot-trim.sh sketchatone-ui-configure; do
    case "$helper" in
        setup-ui-autostart.sh) name=sketchatone-ui-setup-autostart ;;
        setup-pi-boot-trim.sh) name=sketchatone-ui-boot-trim ;;
        *) name="$helper" ;;
    esac
    cp "$SCRIPT_DIR/$helper" "$PKG_DIR/usr/bin/$name"
    chmod +x "$PKG_DIR/usr/bin/$name"
done

cat > "$PKG_DIR/DEBIAN/control" << CONTROLEOF
Package: sketchatone-ui
Version: $VERSION
Section: sound
Priority: optional
Architecture: all
Depends: sketchatone (= $VERSION), python3-kivy, libmtdev1
Maintainer: Sketchatone Project
Description: Optional native Sketchatone UI
 Kivy client for the Sketchatone service using the core's shared Python
 environment. Installing this addon does not change service startup.
 Run sketchatone-ui to connect using the shared config's WebSocket port
 (default 8081); override the URL using SKETCHATONE_UI_URL or --connect.
CONTROLEOF

cat > "$PKG_DIR/DEBIAN/preinst" << 'PREINSTEOF'
#!/bin/bash
set -e
# Preserve legacy standalone UI presets before dpkg removes the old payload.
# Never copy them over the core's active config.
if [ -d /opt/sketchatone-ui/configs ]; then
    mkdir -p /opt/sketchatone/legacy-ui-configs
    cp -a -n /opt/sketchatone-ui/configs/. /opt/sketchatone/legacy-ui-configs/
fi
PREINSTEOF

cat > "$PKG_DIR/DEBIAN/postinst" << 'POSTINSTEOF'
#!/bin/bash
set -eE
trap 'echo "ERROR: UI addon installation failed at line $LINENO; fix the error and run sudo dpkg --configure sketchatone-ui." >&2' ERR
PYTHON=/opt/sketchatone/venv/bin/python
# The exact-version dependency guarantees the core has prepared this venv.
"$PYTHON" -m pip install --upgrade -e '/opt/sketchatone/python[ui]'
"$PYTHON" -c 'import kivy'
# Upgrade only: replace existing legacy managed launchers, never opt new
# accounts into autostart. The helper is a no-op without managed blocks.
if [ -n "${2:-}" ]; then
    /usr/bin/sketchatone-ui-setup-autostart --migrate-all
fi
echo "Sketchatone UI installed; startup is unchanged."
echo "Run sketchatone-ui, or opt in with sudo sketchatone-ui-configure."
POSTINSTEOF

# No udev/service teardown: those resources belong exclusively to the core.
cat > "$PKG_DIR/DEBIAN/prerm" << 'PRERMEOF'
#!/bin/bash
set -e
case "${1:-}" in
    remove|purge)
        /usr/bin/sketchatone-ui-setup-autostart --uninstall-all
        ;;
esac
exit 0
PRERMEOF
chmod +x "$PKG_DIR/DEBIAN/"{preinst,postinst,prerm}
find "$PKG_DIR" \( -name '._*' -o -name '.DS_Store' \) -delete

if [ "$TREE_ONLY" -eq 0 ] && command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --build "$PKG_DIR" "$OUTPUT_DIR/sketchatone-ui-${VERSION}.deb"
    rm -rf "$PKG_DIR"
else
    echo "Package tree: $PKG_DIR"
    echo "Use ./package-for-pi.sh for the unified release bundle and installer."
fi
