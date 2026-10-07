#!/bin/bash
# Build script for Sketchatone standalone application on Linux/Raspberry Pi
# This script must be run ON the Raspberry Pi (or compatible ARM system)

set -e  # Exit on error

echo "=========================================="
echo "Sketchatone - Linux Build Script"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "python/sketchatone-linux.spec" ]; then
    echo "❌ Error: Must be run from the sketchatone project root"
    echo "   Expected to find: python/sketchatone-linux.spec"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "python/venv" ]; then
    echo "🔧 Creating virtual environment..."
    cd python
    python3 -m venv venv
    cd ..
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source python/venv/bin/activate

# Install packages as REGULAR packages (not editable) for PyInstaller compatibility
# PyInstaller has issues with editable installs
echo "📦 Installing packages for PyInstaller..."

# Install sketchatone as a regular package
echo "  → Installing sketchatone..."
pip install ./python --quiet

# Install PyInstaller
echo "  → Installing PyInstaller..."
pip install pyinstaller --quiet

# Check if webapp is built
if [ ! -d "dist/public" ]; then
    echo "⚠️  Warning: dist/public not found"
    echo "Building webapp first..."
    npm run build
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/sketchatone build/

# Build the application
echo "🏗️  Building application with PyInstaller..."
cd python
pyinstaller sketchatone-linux.spec --clean
cd ..

# Check if build succeeded
if [ -d "python/dist/sketchatone" ]; then
    # Move to project dist directory
    mkdir -p dist
    rm -rf dist/sketchatone
    mv python/dist/sketchatone dist/
    
    # Create a launcher script
    cat > dist/sketchatone/sketchatone.sh << 'LAUNCHER_EOF'
#!/bin/bash
# Launcher script for Sketchatone

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the app directory
cd "$DIR"

echo "=========================================="
echo "Sketchatone - MIDI Strummer"
echo "=========================================="
echo ""
echo "Starting server..."
echo "Press Ctrl+C to stop"
echo ""

# Run the application with any passed arguments
./sketchatone "$@"

echo ""
echo "Server stopped."
LAUNCHER_EOF
    chmod +x dist/sketchatone/sketchatone.sh
    
    # Clean up PyInstaller artifacts
    rm -rf python/dist python/build
    
    echo ""
    echo "=========================================="
    echo "✅ Build successful!"
    echo "=========================================="
    echo ""
    echo "Application directory: dist/sketchatone/"
    echo ""
    echo "To test the app:"
    echo "  cd dist/sketchatone"
    echo "  ./sketchatone.sh -c configs/sample-config.json"
    echo ""
    echo "To create a Debian package installer:"
    echo "  ./create-deb.sh"
else
    echo ""
    echo "❌ Build failed - application not found in dist/"
    exit 1
fi
