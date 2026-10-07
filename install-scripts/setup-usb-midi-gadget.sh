#!/bin/bash
# Sketchatone USB MIDI Gadget Setup
# Configures Raspberry Pi to act as a USB MIDI device
# Allows direct USB connection to MIDI hardware (e.g., Akai MPC One+)

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

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check if running on Raspberry Pi
check_raspberry_pi() {
    if [ ! -f /proc/device-tree/model ] || ! grep -q "Raspberry Pi" /proc/device-tree/model; then
        print_error "This script is designed for Raspberry Pi only"
        exit 1
    fi
    
    local model=$(cat /proc/device-tree/model)
    print_info "Detected: $model"
    
    # Warn if not Pi 4 or 5 (USB gadget mode works best on Pi 4/5)
    if ! echo "$model" | grep -qE "Raspberry Pi (4|5)"; then
        print_warning "USB gadget mode is recommended for Raspberry Pi 4 or 5"
        echo "Your model: $model"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Detect boot config location
detect_boot_config() {
    if [ -f /boot/firmware/config.txt ]; then
        echo "/boot/firmware/config.txt"
    elif [ -f /boot/config.txt ]; then
        echo "/boot/config.txt"
    else
        print_error "Could not find boot config.txt"
        exit 1
    fi
}

# Configure boot config for USB gadget mode
setup_boot_config() {
    local boot_config=$(detect_boot_config)
    print_info "Configuring USB gadget mode in $boot_config..."
    
    # Check if already configured
    if grep -q "dtoverlay=dwc2,dr_mode=peripheral" "$boot_config"; then
        print_warning "USB gadget mode already configured in $boot_config"
    else
        echo "" >> "$boot_config"
        echo "# Sketchatone USB MIDI Gadget Mode" >> "$boot_config"
        echo "dtoverlay=dwc2,dr_mode=peripheral" >> "$boot_config"
        print_success "Added USB gadget configuration to $boot_config"
    fi
}

# Configure kernel modules
setup_kernel_modules() {
    print_info "Configuring kernel modules..."
    
    # Check if modules already configured
    if grep -q "^g_midi$" /etc/modules && grep -q "^dwc2$" /etc/modules; then
        print_warning "Kernel modules already configured in /etc/modules"
    else
        # Backup original
        cp /etc/modules /etc/modules.backup-$(date +%Y%m%d-%H%M%S)
        
        # Remove any existing entries (avoid duplicates)
        sed -i '/^dwc2$/d' /etc/modules
        sed -i '/^g_midi$/d' /etc/modules
        
        # Add modules
        echo "" >> /etc/modules
        echo "# Sketchatone USB MIDI Gadget" >> /etc/modules
        echo "dwc2" >> /etc/modules
        echo "g_midi" >> /etc/modules
        
        print_success "Added kernel modules to /etc/modules"
    fi
}

# Install required packages
install_dependencies() {
    print_info "Installing dependencies..."
    apt-get update -qq
    apt-get install -y alsa-utils
    print_success "Dependencies installed"
}

# Update Sketchatone config to use f_midi
update_sketchatone_config() {
    local config_file="/opt/sketchatone/configs/config.json"
    
    if [ ! -f "$config_file" ]; then
        print_warning "Sketchatone config not found at $config_file"
        print_info "You'll need to manually set midi_output_id to 'f_midi' after installation"
        return
    fi
    
    print_info "Would you like to update Sketchatone config to use USB MIDI gadget?"
    echo "This will set midi_output_id to 'f_midi' and midi_output_backend to 'rtmidi'"
    read -p "Update config? (Y/n) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        # Backup config
        cp "$config_file" "${config_file}.backup-$(date +%Y%m%d-%H%M%S)"
        
        # Update config using Python to preserve JSON structure
        python3 << PYTHON_EOF
import json
with open("$config_file", "r") as f:
    config = json.load(f)

if "midi" not in config:
    config["midi"] = {}

config["midi"]["midi_output_backend"] = "rtmidi"
config["midi"]["midi_output_id"] = "f_midi"

with open("$config_file", "w") as f:
    json.dump(config, f, indent=2)
PYTHON_EOF
        
        print_success "Updated Sketchatone config"
    fi
}

# Show verification steps
show_verification() {
    echo ""
    echo "=========================================="
    print_success "USB MIDI Gadget Setup Complete!"
    echo "=========================================="
    echo ""
    print_warning "REBOOT REQUIRED for changes to take effect"
    echo ""
    echo "After reboot, verify the setup:"
    echo ""
    echo "1. Check g_midi module loaded:"
    echo "   lsmod | grep g_midi"
    echo ""
    echo "2. Check ALSA MIDI ports:"
    echo "   aconnect -l"
    echo "   (Should show 'MIDI Gadget')"
    echo ""
    echo "3. Check hardware MIDI device:"
    echo "   amidi -l"
    echo "   (Should show 'f_midi' at hw:X,0,0)"
    echo ""
    echo "4. Connect USB-C cable from Pi to MIDI hardware"
    echo "   - Use USB-C data cable (not charge-only)"
    echo "   - Connect to MIDI hardware's USB port"
    echo "   - Check MIDI settings on hardware (e.g., MPC Settings → MIDI → USB)"
    echo ""
    echo "Troubleshooting:"
    echo "  - Check boot config: $(detect_boot_config)"
    echo "  - Check kernel logs: dmesg | grep -E 'dwc2|g_midi'"
    echo "  - Check sound cards: cat /proc/asound/cards"
    echo ""
    echo "To revert to normal USB mode:"
    echo "  - Remove 'dtoverlay=dwc2,dr_mode=peripheral' from boot config"
    echo "  - Reboot"
    echo ""
}

# Main installation
main() {
    echo ""
    echo "=========================================="
    echo "Sketchatone USB MIDI Gadget Setup"
    echo "=========================================="
    echo ""
    echo "This will configure your Raspberry Pi to act as a USB MIDI device."
    echo ""
    echo "What this does:"
    echo "  • Enables USB gadget mode (Pi acts as USB peripheral)"
    echo "  • Loads g_midi kernel module (MIDI gadget driver)"
    echo "  • Creates 'f_midi' MIDI port for Sketchatone to use"
    echo "  • Allows direct USB connection to MIDI hardware"
    echo ""
    echo "Requirements:"
    echo "  • Raspberry Pi 4 or 5 (recommended)"
    echo "  • USB-C data cable (not charge-only)"
    echo "  • MIDI hardware with USB host port"
    echo ""
    print_warning "This will modify boot config and kernel modules"
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    
    check_root
    check_raspberry_pi
    install_dependencies
    setup_boot_config
    setup_kernel_modules
    update_sketchatone_config
    show_verification
    
    echo ""
    read -p "Reboot now to apply changes? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Rebooting in 3 seconds..."
        sleep 3
        reboot
    else
        print_warning "Remember to reboot before testing!"
    fi
}

main "$@"
