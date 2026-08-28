#!/bin/bash
# Sketchatone UI Autostart Setup
# Configures Raspberry Pi to auto-launch the native (Kivy) UI fullscreen
# directly on tty1 via SDL2's kmsdrm backend (no Wayland compositor).

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# Default settings — match create-deb-ui.sh layout.
# UI_USER may be set via env var or --user; otherwise resolved later by
# resolve_ui_user (falls back to SUDO_USER, then to the lone /home user).
UI_USER="${UI_USER:-}"
UI_BIN="/usr/bin/sketchatone-ui"
# `devices` next to this file is a directory of per-tablet JSONs (see
# DEVICES_DIR below); the UI's -c flag wants the combined config file
# that create-deb-ui.sh's postinst materialises from default.json.
UI_CONFIG="/opt/sketchatone-ui/configs/config.json"

# Source-of-truth directory for tablet device JSON configs. Used by the
# udev rule generator to mint one hidraw permission rule per supported
# device. Fixed regardless of the user's --config selection (which may
# point at a single device JSON instead of the whole directory).
DEVICES_DIR="/opt/sketchatone-ui/configs/devices"
UDEV_RULES_FILE="/etc/udev/rules.d/99-sketchatone.rules"
UDEV_GROUP="plugdev"
UDEV_MODE="0660"

# DRM card index for the DSI panel. Pi 4/5 with mainline vc4 typically
# enumerates the display-capable card as index 1 (card0 is the v3d GPU).
KMS_CARD_INDEX="${KMS_CARD_INDEX:-1}"

# AUTOSTART_FILE is the legacy labwc autostart path. Kept only so that
# --uninstall can clean up installs predating the KMSDRM switch.
AUTOSTART_DIR=""
AUTOSTART_FILE=""

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Determine which user owns the tty1 session that will run the UI.
# Order: explicit UI_USER → SUDO_USER → lone non-system user in /home.
# Validates the result with `id` so callers can't silently chown to a
# nonexistent account (modern Pi OS Lite no longer auto-creates `pi`).
# Non-fatal variant of resolve_ui_user for callers that can degrade
# gracefully (e.g. postinst running under dpkg with no SUDO_USER). Sets
# UI_USER on success, leaves it empty on failure, and returns 0/1
# accordingly without printing errors or exiting.
try_resolve_ui_user() {
    if [ -z "$UI_USER" ] && [ -n "${SUDO_USER:-}" ]; then
        UI_USER="$SUDO_USER"
    fi
    if [ -z "$UI_USER" ]; then
        local candidates=()
        for d in /home/*; do
            [ -d "$d" ] || continue
            local u; u="$(basename "$d")"
            id -u "$u" >/dev/null 2>&1 || continue
            [ "$(id -u "$u")" -ge 1000 ] || continue
            candidates+=("$u")
        done
        if [ "${#candidates[@]}" -eq 1 ]; then
            UI_USER="${candidates[0]}"
        else
            return 1
        fi
    fi
    if ! id "$UI_USER" >/dev/null 2>&1; then
        UI_USER=""
        return 1
    fi
    AUTOSTART_DIR="/home/$UI_USER/.config/labwc"
    AUTOSTART_FILE="$AUTOSTART_DIR/autostart"
    return 0
}

resolve_ui_user() {
    if try_resolve_ui_user; then
        [ -n "${SUDO_USER:-}" ] || print_info "Auto-detected user: $UI_USER"
        return 0
    fi
    if [ -z "$UI_USER" ]; then
        print_error "Could not auto-detect a non-system user in /home."
    else
        print_error "User '$UI_USER' does not exist"
    fi
    print_info  "Specify one with: $0 --user <name>"
    exit 1
}

check_ui_installed() {
    if [ ! -x "$UI_BIN" ]; then
        print_error "sketchatone-ui not found at $UI_BIN"
        print_info "Install the sketchatone-ui .deb package first, then re-run this script"
        exit 1
    fi
}

# Add the UI user to the groups required for direct DRM/KMS + libinput
# access. Needed because we drive the panel via SDL2's kmsdrm backend
# instead of a Wayland compositor — no seatd/labwc mediation. The
# `input` group also grants read access to /dev/input/event* so the
# server-side keyboard listener (evdev) can capture key presses without
# root. The plugdev membership pairs with the udev rules below to grant
# hidraw access to supported tablets.
setup_user_groups() {
    print_info "Adding $UI_USER to render,input,video,tty,$UDEV_GROUP groups"
    usermod -aG "render,input,video,tty,$UDEV_GROUP" "$UI_USER"
}

# Extract vendor/product IDs from device config JSONs.
# Emits one "vendor:product:name" line per config. Uses grep -oP
# (GNU/PCRE) to avoid a jq dependency. Vendor/product are normalized
# to the lower-case 4-hex form udev expects in ATTRS{idVendor/Product}
# (e.g. "256c", "0067") regardless of whether the JSON used "0x..."
# casing or not.
get_device_ids() {
    local dir="$1"
    [ -d "$dir" ] || return 0
    for f in "$dir"/*.json; do
        [ -f "$f" ] || continue
        local v p n
        v=$(grep -oP '"vendorId"\s*:\s*"\K[^"]+'  "$f" 2>/dev/null | head -1)
        p=$(grep -oP '"productId"\s*:\s*"\K[^"]+' "$f" 2>/dev/null | head -1)
        n=$(grep -oP '"name"\s*:\s*"\K[^"]+'      "$f" 2>/dev/null | head -1)
        [ -n "$v" ] && [ -n "$p" ] || continue
        v="${v#0x}"; v="${v#0X}"; v=$(printf '%04s' "$v" | tr ' A-F' '0a-f')
        p="${p#0x}"; p="${p#0X}"; p=$(printf '%04s' "$p" | tr ' A-F' '0a-f')
        echo "$v:$p:$n"
    done
}

# Write one hidraw permission rule per device JSON in $DEVICES_DIR.
# Grants $UDEV_GROUP read/write so the UI (running as $UI_USER, added
# to that group above) can open the tablet via hid.open_path(). Mirrors
# what the webapp variant's sketchatone-setup does, minus the
# systemd-trigger rules (the UI process is owned by tty1, not by a
# usb-add unit).
setup_udev_rules() {
    print_info "Generating udev rules from $DEVICES_DIR"
    local lines=()
    while IFS=: read -r vendor product name; do
        [ -n "$vendor" ] || continue
        lines+=("# $name")
        lines+=("SUBSYSTEM==\"hidraw\", ATTRS{idVendor}==\"$vendor\", ATTRS{idProduct}==\"$product\", MODE=\"$UDEV_MODE\", GROUP=\"$UDEV_GROUP\"")
        lines+=("SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"$vendor\", ATTRS{idProduct}==\"$product\", ATTR{power/autosuspend_delay_ms}=\"-1\"")
    done < <(get_device_ids "$DEVICES_DIR")

    if [ "${#lines[@]}" -eq 0 ]; then
        print_warning "No device configs found in $DEVICES_DIR; skipping udev rules"
        return 0
    fi

    {
        echo "# Sketchatone UI udev rules - auto-generated by sketchatone-ui-setup-autostart"
        echo "# Re-run the setup script to regenerate after adding new device configs."
        echo ""
        printf '%s\n' "${lines[@]}"
    } > "$UDEV_RULES_FILE"

    udevadm control --reload-rules
    udevadm trigger --subsystem-match=hidraw --subsystem-match=usb 2>/dev/null || udevadm trigger
    local count=$(( ${#lines[@]} / 3 ))
    print_success "Wrote $UDEV_RULES_FILE ($count device(s))"
}

remove_udev_rules() {
    if [ -f "$UDEV_RULES_FILE" ]; then
        rm -f "$UDEV_RULES_FILE"
        udevadm control --reload-rules 2>/dev/null || true
        print_success "Removed $UDEV_RULES_FILE"
    fi
}

# Write the UI launcher block into ~/.bash_profile so an autologin on
# tty1 launches the app directly via SDL2's kmsdrm backend. Skips the
# labwc/Wayland compositor entirely — saves ~6s of boot time on Pi 4.
setup_bash_profile() {
    local bp="/home/$UI_USER/.bash_profile"

    echo ""
    read -p "Config path [default: $UI_CONFIG]: " user_config
    if [ -n "$user_config" ]; then
        UI_CONFIG="$user_config"
    fi

    # A missing or non-file config path would make sketchatone-ui exit(1)
    # immediately at boot; combined with autologin + `exec` in .bash_profile
    # that produces an unrecoverable login-loop on tty1. Refuse to write the
    # launcher block unless the target is a readable regular file.
    if [ ! -f "$UI_CONFIG" ]; then
        print_error "Config file not found or not a regular file: $UI_CONFIG"
        if [ -d "$UI_CONFIG" ]; then
            print_info "That path is a directory; sketchatone-ui -c expects a JSON file."
        fi
        print_info "Expected default: /opt/sketchatone-ui/configs/config.json"
        print_info "(created by the sketchatone-ui .deb postinst from default.json)"
        exit 1
    fi

    echo ""
    echo "Enable WebSocket server? Lets other devices on the LAN connect to"
    echo "this Pi (dashboard in a browser, remote MIDI clients, etc.)."
    read -p "Enable WebSocket server? (Y/n) " -n 1 -r ws_reply
    echo
    if [[ "$ws_reply" =~ ^[Nn]$ ]]; then
        local ws_flag=""
        print_info "WebSocket server disabled (in-process UI only)"
    else
        local ws_flag="--enable-ws "
        print_info "WebSocket server enabled on port 8081"
    fi

    print_info "Configuring KMSDRM launch in $bp"
    touch "$bp"
    chown "$UI_USER:$UI_USER" "$bp"
    if grep -q '# >>> Sketchatone UI >>>' "$bp"; then
        sed -i '/# >>> Sketchatone UI >>>/,/# <<< Sketchatone UI <<</d' "$bp"
    fi
    cat >> "$bp" << BPEOF

# >>> Sketchatone UI >>>
if [ "\$(tty)" = "/dev/tty1" ]; then
    export SDL_VIDEODRIVER=kmsdrm
    export SDL_VIDEO_KMSDRM_DEVICE_INDEX=$KMS_CARD_INDEX
    export KIVY_WINDOW=sdl2
    export KIVY_GL_BACKEND=sdl2
    mkdir -p /home/$UI_USER/.local/share
    exec $UI_BIN --fullscreen ${ws_flag}-c "$UI_CONFIG" \\
        >> /home/$UI_USER/.local/share/sketchatone-ui.log 2>&1
fi
# <<< Sketchatone UI <<<
BPEOF
    chown "$UI_USER:$UI_USER" "$bp"

    print_success "Configured Sketchatone UI launch"
    print_info "Config: $UI_CONFIG"
    print_info "Log:    /home/$UI_USER/.local/share/sketchatone-ui.log"
}

# Ensure the resolved config file (and, when it's the default path, its
# parent directory) is writable by $UI_USER. The .deb postinst runs as
# root and creates /opt/sketchatone-ui/configs/config.json owned by
# root:root, but the UI runs as $UI_USER on tty1 — without this fixup
# every _persist_config_to_file() call fails with PermissionError and
# UI changes silently revert on reboot. Idempotent; safe to re-run.
setup_config_ownership() {
    if [ -f "$UI_CONFIG" ]; then
        chown "$UI_USER:$UI_USER" "$UI_CONFIG"
        print_info "Set ownership of $UI_CONFIG to $UI_USER"
    fi
    # Only touch the default configs dir; a user-supplied path may live
    # under $HOME or elsewhere and shouldn't have its parent rewritten.
    if [ "$UI_CONFIG" = "/opt/sketchatone-ui/configs/config.json" ] \
       && [ -d /opt/sketchatone-ui/configs ]; then
        chown "$UI_USER:$UI_USER" /opt/sketchatone-ui/configs
    fi
}

setup_autologin() {
    echo ""
    print_info "Auto-login configuration"
    echo "For unattended boot, you'll want the desktop to auto-login."
    read -p "Enable auto-login for user '$UI_USER'? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if command -v raspi-config >/dev/null 2>&1; then
            # B2 = Console autologin. Do NOT use B4 (Desktop autologin):
            # it pulls in lightdm + xserver-xorg-core and boots into X,
            # which defeats the whole tty1 + KMSDRM launch path.
            raspi-config nonint do_boot_behaviour B2
            print_success "Console auto-login enabled"
        else
            print_warning "raspi-config not found, enable auto-login manually"
            print_info "Run: sudo raspi-config → System Options → Boot / Auto Login"
        fi
    fi
}

show_summary() {
    echo ""
    echo "=========================================="
    print_success "UI Autostart Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Configuration:"
    echo "  • User:      $UI_USER"
    echo "  • Binary:    $UI_BIN --fullscreen"
    echo "  • Config:    $UI_CONFIG"
    echo "  • Launcher:  /home/$UI_USER/.bash_profile (KMSDRM direct)"
    echo "  • Log:       /home/$UI_USER/.local/share/sketchatone-ui.log"
    echo "  • udev:      $UDEV_RULES_FILE (hidraw $UDEV_MODE $UDEV_GROUP)"
    echo ""
    echo "On next boot:"
    echo "  1. tty1 auto-login (if enabled)"
    echo "  2. .bash_profile execs sketchatone-ui under SDL2 kmsdrm"
    echo "  3. Sketchatone UI fills the panel"
    echo ""
    echo "To disable autostart:"
    echo "  sudo sketchatone-ui-setup-autostart --uninstall"
    echo ""
}

uninstall_autostart() {
    print_info "Removing Sketchatone UI autostart..."
    if [ -f "$AUTOSTART_FILE" ]; then
        sed -i '/# >>> Sketchatone UI >>>/,/# <<< Sketchatone UI <<</d' "$AUTOSTART_FILE"
        if [ ! -s "$AUTOSTART_FILE" ] || [ "$(grep -cvE '^(#!|\s*$)' "$AUTOSTART_FILE")" = "0" ]; then
            rm -f "$AUTOSTART_FILE"
            print_success "Removed $AUTOSTART_FILE"
        else
            print_success "Removed Sketchatone UI block from $AUTOSTART_FILE"
        fi
    fi
    local bp="/home/$UI_USER/.bash_profile"
    if [ -f "$bp" ] && grep -q '# >>> Sketchatone UI >>>' "$bp"; then
        sed -i '/# >>> Sketchatone UI >>>/,/# <<< Sketchatone UI <<</d' "$bp"
        print_success "Removed UI launch block from $bp"
    fi
    remove_udev_rules
    echo ""
    print_success "UI autostart removed"
}

show_usage() {
    cat << USAGE
Sketchatone UI Autostart Setup

Usage:
  sudo $0 [OPTIONS]

Options:
  --install         Install and configure UI autostart (default)
  --uninstall       Remove UI autostart configuration
  --install-hid     Non-interactive: install udev rules + group membership
                    only (no tty1 autologin, no bash_profile). Suitable for
                    invocation from a .deb postinst.
  --uninstall-hid   Non-interactive: remove the udev rules file only.
  --user <name>     Target user account (overrides SUDO_USER / auto-detect)
  --help            Show this help message

Description:
  Configures Raspberry Pi (Bookworm) to auto-launch the Sketchatone
  Kivy UI fullscreen on boot via SDL2's kmsdrm backend (no Wayland
  compositor). When run from a root shell, the target user is
  auto-detected from /home/ (must be unique) or taken from the
  UI_USER env var / --user flag.

Environment variables:
  KMS_CARD_INDEX    DRM card index for the DSI panel (default: 1)
USAGE
}

main_install() {
    echo ""
    echo "=========================================="
    echo "Sketchatone UI Autostart Setup"
    echo "=========================================="
    echo ""
    echo "What this does:"
    echo "  • Writes a tty1 launcher to ~/.bash_profile (SDL2 kmsdrm)"
    echo "  • Adds the user to render,input,video,tty,$UDEV_GROUP groups"
    echo "  • Generates udev rules for every device JSON in $DEVICES_DIR"
    echo "  • Optionally enables auto-login"
    echo ""
    print_warning "Requires Raspberry Pi OS Bookworm or newer (Pi 4 / Pi 5)"
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi

    check_root
    resolve_ui_user
    check_ui_installed
    setup_user_groups
    setup_udev_rules
    setup_bash_profile
    setup_config_ownership
    setup_autologin
    show_summary

    echo ""
    read -p "Reboot now to start the UI? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Rebooting in 3 seconds..."
        sleep 3
        reboot
    else
        print_info "Reboot or logout/login to start the UI"
    fi
}

# Non-interactive HID-only setup. Writes just the udev rules and, if a
# UI user can be resolved without prompting, adds them to the tablet
# access groups. Never prompts, never fails: postinst uses this path
# and a nonzero exit would abort the whole dpkg install.
main_install_hid() {
    check_root
    if try_resolve_ui_user; then
        print_info "Configuring HID access for user: $UI_USER"
        setup_user_groups || print_warning "usermod failed; continuing with udev rules only"
    else
        print_warning "No UI user resolved; installing udev rules only."
        print_info    "Run 'sudo sketchatone-ui-setup-autostart --install-hid --user <name>'"
        print_info    "later to add a user to the tablet access groups."
    fi
    setup_udev_rules || print_warning "udev rule generation failed"
    exit 0
}

main_uninstall_hid() {
    check_root
    remove_udev_rules
    exit 0
}

ACTION="install"
while [ $# -gt 0 ]; do
    case "$1" in
        --install)       ACTION="install" ;;
        --uninstall)     ACTION="uninstall" ;;
        --install-hid)   ACTION="install-hid" ;;
        --uninstall-hid) ACTION="uninstall-hid" ;;
        --user)
            [ -n "${2:-}" ] || { print_error "--user requires a value"; exit 1; }
            UI_USER="$2"; shift
            ;;
        --help|-h)       show_usage; exit 0 ;;
        *)               print_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
    shift
done

case "$ACTION" in
    install)        main_install ;;
    uninstall)      check_root; resolve_ui_user; uninstall_autostart ;;
    install-hid)    main_install_hid ;;
    uninstall-hid)  main_uninstall_hid ;;
esac
