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
KIOSK_URL="http://localhost:8080"
KIOSK_USER="${SUDO_USER:-pi}"
AUTOSTART_DIR="/home/$KIOSK_USER/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check if desktop environment exists
check_desktop() {
    if [ ! -d "/usr/share/xsessions" ]; then
        print_error "No desktop environment detected"
        print_info "Kiosk mode requires a desktop environment (e.g., LXDE, PIXEL)"
        print_info "Install with: sudo apt install raspberrypi-ui-mods"
        exit 1
    fi
}

# Install required packages
install_dependencies() {
    print_info "Installing kiosk dependencies..."
    
    apt-get update -qq
    
    # Install chromium and utilities
    local packages=(
        "chromium-browser"
        "unclutter"           # Hide mouse cursor
        "x11-xserver-utils"   # For xset commands
    )
    
    apt-get install -y "${packages[@]}"
    print_success "Dependencies installed"
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

# Disable screensaver and power management
disable_screensaver() {
    print_info "Configuring display settings..."
    
    # Create or append to autostart
    touch "$AUTOSTART_FILE"
    
    # Remove existing screensaver settings
    sed -i '/@xset s/d' "$AUTOSTART_FILE"
    sed -i '/@xset -dpms/d' "$AUTOSTART_FILE"
    
    # Add screensaver disable commands
    cat >> "$AUTOSTART_FILE" << AUTOEOF

# Sketchatone Kiosk - Disable screensaver and power management
@xset s noblank
@xset s off
@xset -dpms
AUTOEOF
    
    print_success "Disabled screensaver and power management"
}

# Hide mouse cursor
setup_cursor_hiding() {
    print_info "Configuring cursor auto-hide..."
    
    # Remove existing unclutter entry
    sed -i '/@unclutter/d' "$AUTOSTART_FILE"
    
    # Add unclutter
    cat >> "$AUTOSTART_FILE" << AUTOEOF

# Sketchatone Kiosk - Hide mouse cursor when idle
@unclutter -idle 0.5 -root
AUTOEOF
    
    print_success "Configured cursor auto-hide"
}

# Setup Chromium kiosk mode
setup_chromium_kiosk() {
    print_info "Configuring Chromium kiosk mode..."
    
    # Ask for URL
    echo ""
    read -p "Enter kiosk URL [default: $KIOSK_URL]: " user_url
    if [ -n "$user_url" ]; then
        KIOSK_URL="$user_url"
    fi
    
    # Remove existing chromium entries
    sed -i '/chromium-browser.*--kiosk/d' "$AUTOSTART_FILE"
    
    # Add chromium kiosk startup
    cat >> "$AUTOSTART_FILE" << AUTOEOF

# Sketchatone Kiosk - Auto-start Chromium in kiosk mode
@bash -c 'sleep 5 && chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate --disable-features=TranslateUI --disk-cache-dir=/dev/null --password-store=basic $KIOSK_URL'
AUTOEOF
    
    # Set ownership
    chown "$KIOSK_USER:$KIOSK_USER" "$AUTOSTART_FILE"
    
    print_success "Configured Chromium kiosk mode"
    print_info "URL: $KIOSK_URL"
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

# Ensure Sketchatone starts before kiosk
ensure_sketchatone_service() {
    echo ""
    print_info "Checking Sketchatone service configuration..."
    
    if [ ! -f "/etc/systemd/system/sketchatone.service" ]; then
        print_warning "Sketchatone service not found"
        print_info "Install Sketchatone first, or the kiosk will show an error page"
        return
    fi
    
    # Check if service is enabled
    if systemctl is-enabled --quiet sketchatone 2>/dev/null; then
        print_success "Sketchatone service is enabled (starts on boot)"
    else
        print_warning "Sketchatone service is not enabled for boot"
        print_info "The kiosk relies on Sketchatone running at $KIOSK_URL"
        
        read -p "Enable Sketchatone to start on boot? (Y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            # Check current mode
            if [ -f /etc/udev/rules.d/99-sketchatone.rules ]; then
                print_info "Detected USB-trigger mode, switching to always-on for kiosk..."
                /usr/bin/sketchatone-setup --mode always-on
            else
                systemctl enable sketchatone
                print_success "Enabled Sketchatone service"
            fi
        fi
    fi
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
    echo "  ✓ Chromium fullscreen kiosk mode"
    echo "  ✓ Screensaver disabled"
    echo "  ✓ Power management disabled"
    echo "  ✓ Mouse cursor auto-hide"
    echo ""
    echo "On next boot:"
    echo "  1. Desktop will auto-login (if enabled)"
    echo "  2. Sketchatone service will start"
    echo "  3. Chromium will open in kiosk mode"
    echo "  4. Dashboard will be displayed fullscreen"
    echo ""
    echo "To exit kiosk mode when running:"
    echo "  • Press Alt+F4 to close Chromium"
    echo "  • Or press Ctrl+Alt+F1 to switch to console"
    echo ""
    echo "To disable kiosk mode:"
    echo "  • Edit or remove: $AUTOSTART_FILE"
    echo "  • Or run: sudo systemctl set-default multi-user.target"
    echo ""
    echo "To test without rebooting:"
    echo "  • Log out and log back in"
    echo "  • Or run: DISPLAY=:0 chromium-browser --kiosk $KIOSK_URL"
    echo ""
}

# Uninstall kiosk mode
uninstall_kiosk() {
    print_info "Removing kiosk mode configuration..."
    
    if [ -f "$AUTOSTART_FILE" ]; then
        # Remove Sketchatone kiosk entries
        sed -i '/# Sketchatone Kiosk/d' "$AUTOSTART_FILE"
        sed -i '/@xset s/d' "$AUTOSTART_FILE"
        sed -i '/@xset -dpms/d' "$AUTOSTART_FILE"
        sed -i '/@unclutter/d' "$AUTOSTART_FILE"
        sed -i '/chromium-browser.*--kiosk/d' "$AUTOSTART_FILE"
        
        # Remove empty lines
        sed -i '/^$/N;/^\n$/D' "$AUTOSTART_FILE"
        
        print_success "Removed kiosk configuration from $AUTOSTART_FILE"
    fi
    
    echo ""
    print_success "Kiosk mode removed"
    echo "Chromium and unclutter are still installed if you need them."
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
    echo "  • Installs Chromium browser and utilities"
    echo "  • Configures auto-start in kiosk mode"
    echo "  • Disables screensaver and power management"
    echo "  • Hides mouse cursor when idle"
    echo "  • Optimizes GPU memory for browser performance"
    echo ""
    print_warning "Best used with auto-login enabled"
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    
    check_root
    check_desktop
    install_dependencies
    setup_autostart_dir
    disable_screensaver
    setup_cursor_hiding
    setup_chromium_kiosk
    setup_autologin
    ensure_sketchatone_service
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
