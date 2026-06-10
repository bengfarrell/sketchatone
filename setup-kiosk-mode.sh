#!/bin/bash
# Sketchatone Kiosk Mode Setup
# Configures Raspberry Pi to auto-start Chromium in fullscreen kiosk mode
# Displays the Sketchatone web dashboard on boot

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# Default settings
# Matches the default http_port (80) in public/configs/default.json.
# Using localhost avoids mDNS/avahi dependencies since the kiosk runs on the same host.
# ?compact=1 switches the dashboard to single-panel navigation optimised for
# small device displays (e.g. 800x480 Pi touchscreens).
KIOSK_URL="http://localhost/?compact=1"
KIOSK_USER="${SUDO_USER:-pi}"

# Kiosk targets labwc (Wayland) on Raspberry Pi OS Bookworm or newer.
# Older LXDE/X11 sessions are not supported.
AUTOSTART_DIR="/home/$KIOSK_USER/.config/labwc"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"

# Chromium package/binary names are resolved at runtime (varies by distro).
# Bookworm/Debian 12+ ships "chromium"; older Raspberry Pi OS shipped "chromium-browser".
CHROMIUM_PKG=""
CHROMIUM_BIN=""

# Pick the available chromium apt package name.
detect_chromium_pkg() {
    local candidate
    for candidate in chromium-browser chromium; do
        if apt-cache policy "$candidate" 2>/dev/null \
            | grep -E "Candidate:" \
            | grep -vq "Candidate: (none)"; then
            CHROMIUM_PKG="$candidate"
            return 0
        fi
    done
    return 1
}

# Pick the installed chromium binary name.
detect_chromium_bin() {
    local candidate
    for candidate in chromium-browser chromium; do
        if command -v "$candidate" >/dev/null 2>&1; then
            CHROMIUM_BIN="$candidate"
            return 0
        fi
    done
    return 1
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Verify labwc (Wayland) is the active compositor.
# Raspberry Pi OS Bookworm (Oct 2024+) defaults to labwc on Pi 4/5.
check_labwc() {
    if ! command -v labwc >/dev/null 2>&1 && [ ! -d "/usr/share/wayland-sessions" ]; then
        print_error "labwc not found"
        print_info "Sketchatone kiosk requires Raspberry Pi OS Bookworm or newer"
        print_info "with the labwc Wayland session (default on Pi 4 and Pi 5)."
        print_info "Older LXDE/X11 sessions and wayfire are not supported."
        exit 1
    fi
}

# Install required packages
install_dependencies() {
    print_info "Installing kiosk dependencies..."

    apt-get update -qq

    if ! detect_chromium_pkg; then
        print_error "No chromium package available in apt (tried chromium-browser, chromium)"
        print_info "On Raspberry Pi OS, ensure 'sudo apt update' succeeds and the standard repos are enabled"
        exit 1
    fi
    print_info "Using chromium package: $CHROMIUM_PKG"

    local packages=(
        "$CHROMIUM_PKG"
    )

    apt-get install -y "${packages[@]}"

    if ! detect_chromium_bin; then
        print_error "chromium installed but no chromium/chromium-browser binary found on PATH"
        exit 1
    fi
    print_success "Dependencies installed (binary: $CHROMIUM_BIN)"
}

# Configure autostart directory
setup_autostart_dir() {
    print_info "Setting up autostart directory for user: $KIOSK_USER"
    
    # Create autostart directory if it doesn't exist
    if [ ! -d "$AUTOSTART_DIR" ]; then
        mkdir -p "$AUTOSTART_DIR"
        chown -R "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.config"
    fi
    
    # Backup existing autostart if it exists
    if [ -f "$AUTOSTART_FILE" ]; then
        cp "$AUTOSTART_FILE" "${AUTOSTART_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
        print_info "Backed up existing autostart file"
    fi
}

# Setup Chromium kiosk mode (labwc autostart, plain shell script)
setup_chromium_kiosk() {
    print_info "Configuring Chromium kiosk mode..."

    # Ask for URL
    echo ""
    read -p "Enter kiosk URL [default: $KIOSK_URL]: " user_url
    if [ -n "$user_url" ]; then
        KIOSK_URL="$user_url"
    fi

    # Resolve binary if install_dependencies was skipped (e.g., chromium already present)
    if [ -z "$CHROMIUM_BIN" ] && ! detect_chromium_bin; then
        print_error "No chromium binary found on PATH"
        exit 1
    fi

    # Remove any previous Sketchatone-managed block (between markers, inclusive)
    if [ -f "$AUTOSTART_FILE" ]; then
        sed -i '/# >>> Sketchatone Kiosk >>>/,/# <<< Sketchatone Kiosk <<</d' "$AUTOSTART_FILE"
    fi

    # Ensure shebang on a fresh file
    if [ ! -s "$AUTOSTART_FILE" ]; then
        echo '#!/bin/sh' > "$AUTOSTART_FILE"
    fi

    # Append Sketchatone-managed block. Backgrounded with & so labwc continues startup.
    # The loop polls the kiosk URL before launching Chromium (capped at ~120s) so we
    # don't land on ERR_CONNECTION_REFUSED when the sketchatone service is slow to bind.
    # --ozone-platform=wayland makes chromium use native Wayland instead of XWayland.
    cat >> "$AUTOSTART_FILE" << AUTOEOF

# >>> Sketchatone Kiosk >>>
(
  i=0
  until curl -sf --max-time 1 -o /dev/null $KIOSK_URL; do
    i=\$((i+1))
    [ "\$i" -ge 120 ] && break
    sleep 1
  done
  $CHROMIUM_BIN --kiosk --ozone-platform=wayland --noerrdialogs --disable-infobars --no-first-run --disable-translate --disable-features=TranslateUI --disk-cache-dir=/dev/null --password-store=basic $KIOSK_URL
) &
# <<< Sketchatone Kiosk <<<
AUTOEOF

    # labwc requires the autostart file to be executable
    chmod +x "$AUTOSTART_FILE"
    chown "$KIOSK_USER:$KIOSK_USER" "$AUTOSTART_FILE"

    print_success "Configured Chromium kiosk mode"
    print_info "URL: $KIOSK_URL"
    print_info "Binary: $CHROMIUM_BIN"
}

# Configure auto-login (optional)
setup_autologin() {
    echo ""
    print_info "Auto-login configuration"
    echo "For kiosk mode, you may want to auto-login on boot."
    read -p "Enable auto-login for user '$KIOSK_USER'? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Use raspi-config nonint method if available
        if command -v raspi-config &> /dev/null; then
            raspi-config nonint do_boot_behaviour B4
            print_success "Auto-login enabled"
        else
            print_warning "raspi-config not found, please enable auto-login manually"
            print_info "Run: sudo raspi-config → System Options → Boot / Auto Login"
        fi
    fi
}

# Ensure Sketchatone is running and starts on boot.
# Kiosk mode is useless without the server, so always-on is non-negotiable here.
ensure_sketchatone_service() {
    echo ""
    print_info "Checking Sketchatone service configuration..."

    if [ ! -f "/etc/systemd/system/sketchatone.service" ]; then
        print_error "Sketchatone service not found at /etc/systemd/system/sketchatone.service"
        print_info "Install the Sketchatone .deb package first, then re-run this script"
        exit 1
    fi

    if systemctl is-enabled --quiet sketchatone 2>/dev/null \
       && systemctl is-active --quiet sketchatone 2>/dev/null; then
        print_success "Sketchatone service is already enabled and running"
        return
    fi

    print_info "Configuring Sketchatone for always-on (required for kiosk)..."
    if [ -x /usr/bin/sketchatone-setup ]; then
        /usr/bin/sketchatone-setup --mode always-on
    else
        # Fallback if the setup helper isn't installed for some reason
        systemctl enable sketchatone
        systemctl start sketchatone
        print_success "Sketchatone service enabled and started"
    fi
}

# Verify the server is actually serving the kiosk URL before declaring success.
# Catches cases where the service is "active" but exiting in a restart loop
# (e.g. no tablet + missing --poll), which would otherwise only surface as a
# blank chromium error page after reboot.
verify_server_reachable() {
    echo ""
    print_info "Verifying Sketchatone is responding at $KIOSK_URL..."

    local deadline=$((SECONDS + 20))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if curl -sf --max-time 2 -o /dev/null "$KIOSK_URL"; then
            print_success "Sketchatone is serving the kiosk URL"
            return 0
        fi
        sleep 1
    done

    print_warning "Sketchatone is not responding at $KIOSK_URL after 20s"
    print_warning "Kiosk will boot but Chromium will show a connection error."
    print_info "Inspect the service with:"
    print_info "  systemctl status sketchatone --no-pager"
    print_info "  sudo journalctl -u sketchatone -n 80 --no-pager"
}

# Configure GPU memory for better performance
optimize_gpu_memory() {
    echo ""
    print_info "GPU memory optimization"
    echo "Chromium benefits from higher GPU memory allocation."
    echo "Recommended: 128MB or higher"
    
    read -p "Set GPU memory to 128MB? (Y/n) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        # Detect boot config
        local boot_config
        if [ -f /boot/firmware/config.txt ]; then
            boot_config="/boot/firmware/config.txt"
        elif [ -f /boot/config.txt ]; then
            boot_config="/boot/config.txt"
        else
            print_warning "Could not find boot config.txt"
            return
        fi
        
        # Update GPU memory
        if grep -q "^gpu_mem=" "$boot_config"; then
            sed -i 's/^gpu_mem=.*/gpu_mem=128/' "$boot_config"
        else
            echo "" >> "$boot_config"
            echo "# Sketchatone Kiosk - GPU memory for Chromium" >> "$boot_config"
            echo "gpu_mem=128" >> "$boot_config"
        fi
        
        print_success "Set GPU memory to 128MB"
        print_warning "Reboot required for GPU memory change"
    fi
}

# Show summary
show_summary() {
    echo ""
    echo "=========================================="
    print_success "Kiosk Mode Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Configuration:"
    echo "  • User: $KIOSK_USER"
    echo "  • URL: $KIOSK_URL"
    echo "  • Autostart: $AUTOSTART_FILE"
    echo ""
    echo "Features enabled:"
    echo "  ✓ Chromium fullscreen kiosk mode (Wayland / labwc)"
    echo ""
    echo "On next boot:"
    echo "  1. Desktop will auto-login (if enabled)"
    echo "  2. Sketchatone service will start"
    echo "  3. Chromium will open in kiosk mode"
    echo "  4. Dashboard will be displayed fullscreen"
    echo ""
    echo "To exit kiosk mode when running:"
    echo "  • Press Ctrl+Alt+Backspace (if enabled) to end the session"
    echo "  • Or switch to a TTY with Ctrl+Alt+F2 and 'sudo systemctl restart display-manager'"
    echo ""
    echo "To disable kiosk mode:"
    echo "  • Run: sudo sketchatone-setup-kiosk --uninstall"
    echo "  • Or edit/remove: $AUTOSTART_FILE"
    echo ""
    echo "To test without rebooting:"
    echo "  • Log out and log back in"
    echo "  • Or run on the Pi's local display:"
    echo "    ${CHROMIUM_BIN:-chromium} --kiosk --ozone-platform=wayland $KIOSK_URL"
    echo ""
}

# Uninstall kiosk mode
uninstall_kiosk() {
    print_info "Removing kiosk mode configuration..."

    if [ -f "$AUTOSTART_FILE" ]; then
        # Remove the Sketchatone-managed block (between markers, inclusive)
        sed -i '/# >>> Sketchatone Kiosk >>>/,/# <<< Sketchatone Kiosk <<</d' "$AUTOSTART_FILE"

        # If the file is now empty or only contains the shebang, remove it entirely
        if [ ! -s "$AUTOSTART_FILE" ] || [ "$(grep -cvE '^(#!|\s*$)' "$AUTOSTART_FILE")" = "0" ]; then
            rm -f "$AUTOSTART_FILE"
            print_success "Removed $AUTOSTART_FILE"
        else
            print_success "Removed Sketchatone kiosk block from $AUTOSTART_FILE"
        fi
    fi

    echo ""
    print_success "Kiosk mode removed"
    echo "Chromium is still installed if you need it."
}

# Show usage
show_usage() {
    cat << USAGE
Sketchatone Kiosk Mode Setup

Usage:
  sudo $0 [OPTIONS]

Options:
  --install         Install and configure kiosk mode (default)
  --uninstall       Remove kiosk mode configuration
  --help            Show this help message

Examples:
  sudo $0                          # Install kiosk mode
  sudo $0 --install                # Install kiosk mode
  sudo $0 --uninstall              # Remove kiosk mode

Description:
  Configures Raspberry Pi to display Sketchatone web dashboard
  in fullscreen kiosk mode on boot. Perfect for dedicated
  installations or live performance setups.

USAGE
}

# Main installation
main_install() {
    echo ""
    echo "=========================================="
    echo "Sketchatone Kiosk Mode Setup"
    echo "=========================================="
    echo ""
    echo "This will configure your Raspberry Pi to auto-start"
    echo "the Sketchatone web dashboard in fullscreen kiosk mode."
    echo ""
    echo "What this does:"
    echo "  • Installs Chromium browser"
    echo "  • Configures labwc autostart to launch Chromium in kiosk mode"
    echo "  • Optionally enables auto-login on boot"
    echo "  • Optionally bumps GPU memory for browser performance"
    echo ""
    print_warning "Requires Raspberry Pi OS Bookworm or newer with labwc (Pi 4 / Pi 5)"
    print_warning "Best used with auto-login enabled"
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi

    check_root
    check_labwc
    install_dependencies
    setup_autostart_dir
    setup_chromium_kiosk
    setup_autologin
    ensure_sketchatone_service
    verify_server_reachable
    optimize_gpu_memory
    show_summary
    
    echo ""
    read -p "Reboot now to start kiosk mode? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Rebooting in 3 seconds..."
        sleep 3
        reboot
    else
        print_info "Reboot or logout/login to start kiosk mode"
    fi
}

# Main entry point
case "${1:-}" in
    --install|"")
        main_install
        ;;
    --uninstall)
        check_root
        uninstall_kiosk
        ;;
    --help|-h)
        show_usage
        ;;
    *)
        print_error "Unknown option: $1"
        show_usage
        exit 1
        ;;
esac
