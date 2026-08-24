#!/bin/bash
# Boot-time optimization for a Sketchatone UI appliance on Pi OS Lite
# (Bookworm or newer). Disables services and tweaks firmware config to
# get from power-on to the Kivy UI in roughly 8-15s on a Pi 4/5.
#
# Safe to re-run. Use --restore to undo. Run AFTER installing the
# sketchatone-ui .deb so autostart wiring already exists.

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# Services masked on --install. Kept out of bluetooth.target etc.
# entirely (mask, not just disable) so they can't be pulled in by deps.
DISABLE_SERVICES=(
    bluetooth.service hciuart.service bthelper@.service
    ModemManager.service
    triggerhappy.service triggerhappy.socket
    cups.service cups-browsed.service
    dphys-swapfile.service
    NetworkManager-wait-online.service
    systemd-networkd-wait-online.service
    keyboard-setup.service console-setup.service
    rpi-eeprom-update.service
    rpi-resize-swap-file.service
    serial-getty@ttyAMA0.service
)
# Packages purged on --install. cloud-init in particular adds 20+ seconds
# of boot time on Pi OS Lite and is pointless on a fixed appliance.
PURGE_PACKAGES=(
    cloud-init
)
# Periodic timers — don't affect boot, but reduce background CPU on a
# pinned-CPU UI. Skip if you actually want unattended apt upgrades.
DISABLE_TIMERS=(
    apt-daily.timer apt-daily-upgrade.timer
    man-db.timer e2scrub_all.timer logrotate.timer fstrim.timer
)

# Bookworm moved firmware config under /boot/firmware. Fall back to
# /boot for older images.
if [ -d /boot/firmware ]; then
    BOOT_DIR=/boot/firmware
else
    BOOT_DIR=/boot
fi
CONFIG_TXT="$BOOT_DIR/config.txt"
CMDLINE_TXT="$BOOT_DIR/cmdline.txt"
MARK_BEGIN="# >>> Sketchatone boot-trim >>>"
MARK_END="# <<< Sketchatone boot-trim <<<"

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "Run as root (use sudo)"; exit 1
    fi
}

backup_once() {
    local f="$1"
    [ -f "$f" ] && [ ! -f "${f}.sketchatone.bak" ] && cp "$f" "${f}.sketchatone.bak"
}

mask_services() {
    print_info "Masking unused services..."
    for s in "${DISABLE_SERVICES[@]}"; do
        if systemctl list-unit-files "$s" >/dev/null 2>&1; then
            systemctl disable --now "$s" 2>/dev/null || true
            systemctl mask "$s" 2>/dev/null || true
            echo "  • masked $s"
        fi
    done
    for t in "${DISABLE_TIMERS[@]}"; do
        if systemctl list-unit-files "$t" >/dev/null 2>&1; then
            systemctl disable --now "$t" 2>/dev/null || true
            echo "  • disabled $t"
        fi
    done
}

purge_packages() {
    print_info "Purging packages that slow boot..."
    for p in "${PURGE_PACKAGES[@]}"; do
        if dpkg -s "$p" >/dev/null 2>&1; then
            DEBIAN_FRONTEND=noninteractive apt-get purge -y "$p" 2>/dev/null || true
            echo "  • purged $p"
        fi
    done
    DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>/dev/null || true
}

socket_activate_ssh() {
    # Switch ssh.service → ssh.socket so sshd doesn't block boot until a
    # connection actually arrives. Harmless if sshd isn't installed.
    if ! systemctl list-unit-files ssh.socket >/dev/null 2>&1; then
        return 0
    fi
    print_info "Switching SSH to socket activation..."
    systemctl disable --now ssh.service 2>/dev/null || true
    systemctl enable --now ssh.socket 2>/dev/null || true
    echo "  • ssh.service disabled, ssh.socket enabled"
}

setup_getty_no_idle() {
    # The upstream getty@tty1 unit uses Type=idle which makes agetty wait
    # ~5-9s for the system to "settle" before showing the login prompt.
    # On an appliance with autologin we want the prompt (and `exec labwc`)
    # as early as possible.
    print_info "Removing Type=idle delay from getty@tty1..."
    local dir=/etc/systemd/system/getty@tty1.service.d
    mkdir -p "$dir"
    cat > "$dir/no-idle.conf" << 'EOF'
[Service]
Type=simple
EOF
    systemctl daemon-reload
    echo "  • $dir/no-idle.conf installed"
}

patch_config_txt() {
    print_info "Patching $CONFIG_TXT"
    backup_once "$CONFIG_TXT"
    sed -i "/$MARK_BEGIN/,/$MARK_END/d" "$CONFIG_TXT"
    cat >> "$CONFIG_TXT" << CFGEOF
$MARK_BEGIN
disable_splash=1
boot_delay=0
dtoverlay=disable-bt
$MARK_END
CFGEOF
}

patch_cmdline_txt() {
    print_info "Patching $CMDLINE_TXT (single line — kernel cmdline)"
    backup_once "$CMDLINE_TXT"
    # cmdline.txt must remain a single line. Add quiet/no-cursor flags
    # only if not already present. video=DSI-1 pre-negotiates the panel
    # mode in the kernel so labwc doesn't pay the ~10s DSI handshake at
    # session start (Hosyond 800x480 DSI panel).
    local line; line=$(tr -d '\n' < "$CMDLINE_TXT")
    for flag in "quiet" "loglevel=1" "logo.nologo" "vt.global_cursor_default=0" "video=DSI-1:800x480M@60"; do
        grep -qE "(^| )${flag//./\\.}( |$)" <<< "$line" || line="$line $flag"
    done
    echo "$line" > "$CMDLINE_TXT"
}

install_trim() {
    check_root
    purge_packages
    mask_services
    socket_activate_ssh
    setup_getty_no_idle
    patch_config_txt
    patch_cmdline_txt
    print_success "Boot-trim applied. Reboot to take effect."
    echo ""
    echo "Notes:"
    echo "  • Bluetooth disabled at the device-tree level. Don't enable"
    echo "    this if you plan to use Bluetooth MIDI."
    echo "  • SSH now starts on first connection (ssh.socket)."
    echo "  • cloud-init purged — re-install manually if needed."
    echo "  • Backups: ${CONFIG_TXT}.sketchatone.bak / ${CMDLINE_TXT}.sketchatone.bak"
    echo "  • Run with --restore to undo."
}

restore_trim() {
    check_root
    print_info "Restoring services..."
    for s in "${DISABLE_SERVICES[@]}"; do
        systemctl unmask "$s" 2>/dev/null || true
        systemctl enable "$s" 2>/dev/null || true
    done
    for t in "${DISABLE_TIMERS[@]}"; do
        systemctl enable "$t" 2>/dev/null || true
    done
    print_info "Restoring ssh.service..."
    systemctl disable --now ssh.socket 2>/dev/null || true
    systemctl enable --now ssh.service 2>/dev/null || true
    print_info "Removing getty@tty1 no-idle drop-in..."
    rm -f /etc/systemd/system/getty@tty1.service.d/no-idle.conf
    rmdir /etc/systemd/system/getty@tty1.service.d 2>/dev/null || true
    systemctl daemon-reload
    print_info "Restoring $CONFIG_TXT / $CMDLINE_TXT from backups..."
    [ -f "${CONFIG_TXT}.sketchatone.bak" ] && cp "${CONFIG_TXT}.sketchatone.bak" "$CONFIG_TXT"
    [ -f "${CMDLINE_TXT}.sketchatone.bak" ] && cp "${CMDLINE_TXT}.sketchatone.bak" "$CMDLINE_TXT"
    print_warning "cloud-init was purged on --install. Re-install with: sudo apt install cloud-init"
    print_success "Restored. Reboot to take effect."
}

case "${1:---install}" in
    --install) install_trim ;;
    --restore) restore_trim ;;
    --help|-h)
        cat << USAGE
Usage: sudo $0 [--install|--restore]

  --install   (default) Mask unused services, patch $BOOT_DIR/config.txt
              and $BOOT_DIR/cmdline.txt for faster boot.
  --restore   Re-enable everything and restore firmware config from .bak.
USAGE
        ;;
    *) print_error "Unknown option: $1"; exit 1 ;;
esac
