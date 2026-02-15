#!/bin/bash
# Create a lightweight macOS app bundle for Sketchatone
# Uses a bundled Python venv with all dependencies

set -e

VERSION=$(node -p "require('./package.json').version")
APP_NAME="Sketchatone"
BUNDLE_DIR="dist/${APP_NAME}.app"
CONTENTS_DIR="${BUNDLE_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

echo "🍎 Creating macOS app bundle for ${APP_NAME} v${VERSION}"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check for python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 not found"
    exit 1
fi
echo "  ✓ python3 found: $(python3 --version)"

# Check for built webapp
if [ ! -d "dist/public" ]; then
    echo "❌ Error: dist/public not found. Run 'npm run build' first."
    exit 1
fi
echo "  ✓ Webapp built"

# Check for Python packages
if [ ! -d "python/sketchatone" ]; then
    echo "❌ Error: python/sketchatone not found"
    exit 1
fi
echo "  ✓ sketchatone package found"

if [ ! -d "../blankslate/python/blankslate" ]; then
    echo "❌ Error: ../blankslate/python/blankslate not found"
    exit 1
fi
echo "  ✓ blankslate package found"

# Clean previous build
echo ""
echo "🗑️  Cleaning previous build..."
rm -rf "$BUNDLE_DIR"

# Create app bundle structure
echo "📁 Creating app bundle structure..."
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR/configs"
mkdir -p "$RESOURCES_DIR/public"

# Create Python virtual environment
echo "🐍 Creating Python virtual environment..."
python3 -m venv "$RESOURCES_DIR/venv"

# Activate venv and install dependencies
echo "📦 Installing Python dependencies..."
source "$RESOURCES_DIR/venv/bin/activate"

# Install dependencies (hidapi, websockets, rtmidi, etc.)
pip install --upgrade pip --quiet
pip install hidapi websockets inquirer colorama python-rtmidi --quiet

# Install our packages in editable-like mode (copy them to site-packages)
cp -R python/sketchatone "$RESOURCES_DIR/venv/lib/python"*/site-packages/
cp -R ../blankslate/python/blankslate "$RESOURCES_DIR/venv/lib/python"*/site-packages/

deactivate

# Remove unnecessary files from venv to reduce size
echo "🧹 Cleaning up venv..."
find "$RESOURCES_DIR/venv" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/venv" -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/venv" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/venv" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
rm -rf "$RESOURCES_DIR/venv/include" 2>/dev/null || true
rm -rf "$RESOURCES_DIR/venv/share" 2>/dev/null || true

# Copy configs
echo "📦 Copying configs..."
cp -R public/configs/* "$RESOURCES_DIR/configs/"

# Copy webapp
echo "📦 Copying webapp..."
cp -R dist/public/* "$RESOURCES_DIR/public/"

# Create the server runner script (called by the main launcher)
echo "📝 Creating launcher scripts..."
cat > "$MACOS_DIR/sketchatone-server" << 'SERVEREOF'
#!/bin/bash
# Sketchatone Server
# Starts the Python server and opens the browser

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$(dirname "$SCRIPT_DIR")/Resources"

# Use the bundled Python venv
PYTHON="$RESOURCES_DIR/venv/bin/python3"

# Configuration
WS_PORT=8081
HTTP_PORT=8080

# Set environment variables for the server
export SKETCHATONE_PUBLIC_DIR="$RESOURCES_DIR/public"
export SKETCHATONE_CONFIG_DIR="$RESOURCES_DIR/configs"

echo "🎸 Starting Sketchatone..."
echo "   WebSocket: ws://localhost:$WS_PORT"
echo "   HTTP: http://localhost:$HTTP_PORT"
echo ""

# Function to open browser after a short delay
open_browser() {
    sleep 2
    open "http://localhost:$HTTP_PORT"
}

# Start browser opener in background
open_browser &

# Start the Python server using the bundled venv
# Use --poll to wait for device connection (user can override with args)
# Pass all arguments through (allows --config, etc.)
exec "$PYTHON" -m sketchatone.cli.server \
    --ws-port $WS_PORT \
    --http-port $HTTP_PORT \
    --poll 2000 \
    "$@"
SERVEREOF
chmod +x "$MACOS_DIR/sketchatone-server"

# Create the main launcher that opens Terminal
cat > "$MACOS_DIR/Sketchatone" << 'LAUNCHEREOF'
#!/bin/bash
# Sketchatone Launcher
# Opens Terminal and runs the server

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

osascript <<EOF
tell application "Terminal"
    activate
    do script "\"$SCRIPT_DIR/sketchatone-server\"; exit"
end tell
EOF
LAUNCHEREOF
chmod +x "$MACOS_DIR/Sketchatone"

# Create app icon from SVG
echo "🎨 Creating app icon..."
if command -v rsvg-convert &> /dev/null; then
    ICONSET_DIR="$RESOURCES_DIR/AppIcon.iconset"
    mkdir -p "$ICONSET_DIR"

    # Generate all required icon sizes
    for size in 16 32 64 128 256 512; do
        rsvg-convert -w $size -h $size "public/sketchatone-logo.svg" -o "$ICONSET_DIR/icon_${size}x${size}.png"
        # Also create @2x versions
        size2x=$((size * 2))
        if [ $size2x -le 1024 ]; then
            rsvg-convert -w $size2x -h $size2x "public/sketchatone-logo.svg" -o "$ICONSET_DIR/icon_${size}x${size}@2x.png"
        fi
    done
    # 512@2x is 1024
    rsvg-convert -w 1024 -h 1024 "public/sketchatone-logo.svg" -o "$ICONSET_DIR/icon_512x512@2x.png"

    # Convert iconset to icns
    iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns"
    rm -rf "$ICONSET_DIR"
    echo "  ✓ App icon created"
else
    echo "  ⚠ rsvg-convert not found, skipping icon (install with: brew install librsvg)"
fi

# Create Info.plist
echo "📝 Creating Info.plist..."
cat > "$CONTENTS_DIR/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.sketchatone.app</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>Sketchatone</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2024 Sketchatone</string>
</dict>
</plist>
PLIST

# Create a simple icon (placeholder - you can replace with a real .icns file)
# For now, we'll skip the icon

# Calculate size
echo ""
echo "📊 Calculating bundle size..."
BUNDLE_SIZE=$(du -sh "$BUNDLE_DIR" | cut -f1)

echo ""
echo "=========================================="
echo "✅ macOS app bundle created!"
echo "=========================================="
echo ""
echo "Bundle: $BUNDLE_DIR"
echo "Size: $BUNDLE_SIZE"
echo ""
echo "To install:"
echo "  cp -R '$BUNDLE_DIR' /Applications/"
echo ""
echo "To run:"
echo "  open /Applications/${APP_NAME}.app"
echo "  (or double-click in Finder)"
echo ""
echo "For tablets that need exclusive HID access (e.g., Huion buttons):"
echo "  sudo /Applications/${APP_NAME}.app/Contents/MacOS/Sketchatone"
echo "  (or use the 'Run Sketchatone (sudo).command' file)"
echo ""

# Also create a standalone .command file for easy sudo launching
cat > "dist/Run Sketchatone (sudo).command" << 'CMDFILE'
#!/bin/bash
# Double-click to run Sketchatone with sudo (for full tablet button access)
cd "$(dirname "$0")"
if [ -d "Sketchatone.app" ]; then
    sudo ./Sketchatone.app/Contents/MacOS/Sketchatone
elif [ -d "/Applications/Sketchatone.app" ]; then
    sudo /Applications/Sketchatone.app/Contents/MacOS/Sketchatone
else
    echo "Error: Sketchatone.app not found"
    echo "Please install to /Applications or run from the same directory"
    exit 1
fi
CMDFILE
chmod +x "dist/Run Sketchatone (sudo).command"

echo "Also created: dist/Run Sketchatone (sudo).command"
echo "  (Double-click this to run with sudo after installing)"
