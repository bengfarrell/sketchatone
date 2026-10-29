#!/bin/bash
# Configure the optional UI addon on tty1; the core service owns all devices.
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

UI_USER="${UI_USER:-}"
UI_HOME=""
UI_BIN="/usr/bin/sketchatone-ui"
UI_AUTOSTART_MARKER="/etc/sketchatone/ui-autostart-user"
KMS_CARD_INDEX="${KMS_CARD_INDEX:-1}"
NO_REBOOT=false

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

try_resolve_ui_user() {
    if [ -z "$UI_USER" ] && [ -n "${SUDO_USER:-}" ]; then
        UI_USER="$SUDO_USER"
    fi
    if [ -z "$UI_USER" ]; then
        local candidates=() d u
        for d in /home/*; do
            [ -d "$d" ] || continue
            u="$(basename "$d")"
            id -u "$u" >/dev/null 2>&1 || continue
            [ "$(id -u "$u")" -ge 1000 ] || continue
            candidates+=("$u")
        done
        [ "${#candidates[@]}" -eq 1 ] || return 1
        UI_USER="${candidates[0]}"
    fi
    id "$UI_USER" >/dev/null 2>&1 || return 1
    UI_HOME="$(getent passwd "$UI_USER" | cut -d: -f6)"
    [ -n "$UI_HOME" ] && [ "$UI_HOME" != "/" ] && [ -d "$UI_HOME" ]
}

resolve_ui_user() {
    if ! try_resolve_ui_user; then
        print_error "Could not resolve a login user and home directory."
        print_info "Specify one with: $0 --user <name>"
        exit 1
    fi
}

check_ui_installed() {
    if [ ! -x "$UI_BIN" ]; then
        print_error "sketchatone-ui not found at $UI_BIN"
        print_info "Install the sketchatone-ui addon package first."
        exit 1
    fi
    if ! command -v sketchatone-setup >/dev/null 2>&1; then
        print_error "Install the sketchatone core package first (sketchatone-setup is missing)."
        exit 1
    fi
}

setup_user_groups() {
    print_info "Adding $UI_USER to render,input,video,tty for local display access"
    usermod -aG render,input,video,tty "$UI_USER"
}

# Remove only complete managed blocks, preserving unrelated content, ownership,
# and malformed/unclosed blocks. Never follow a user-controlled file symlink.
remove_managed_block() {
    python3 - "$1" <<'PY'
import errno
import os
import stat
import sys

path = sys.argv[1]
try:
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
except FileNotFoundError:
    sys.exit(0)
except OSError as exc:
    if exc.errno in (errno.ELOOP, errno.EISDIR):
        print(f"Skipping symlink or directory: {path}", file=sys.stderr)
        sys.exit(0)
    print(f"Refusing to edit {path}: {exc}", file=sys.stderr)
    sys.exit(1)
with os.fdopen(fd, "r+", encoding="utf-8", newline="") as stream:
    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
        print(f"Skipping non-regular file: {path}", file=sys.stderr)
        sys.exit(0)
    lines = stream.readlines()
    result = []
    pending = None
    for line in lines:
        marker = line.rstrip("\r\n")
        if marker == "# >>> Sketchatone UI >>>" and pending is None:
            pending = [line]
        elif pending is not None:
            pending.append(line)
            if marker == "# <<< Sketchatone UI <<<":
                pending = None
        else:
            result.append(line)
    if pending is not None:
        result.extend(pending)
    if result != lines:
        stream.seek(0)
        stream.writelines(result)
        stream.truncate()
PY
}

cleanup_user_blocks() {
    remove_managed_block "$UI_HOME/.config/labwc/autostart"
    remove_managed_block "$UI_HOME/.bash_profile"
}

setup_bash_profile() {
    local bp="$UI_HOME/.bash_profile"
    cleanup_user_blocks
    if [ -L "$bp" ] || { [ -e "$bp" ] && [ ! -f "$bp" ]; }; then
        print_error "Refusing to replace non-regular file or symlink: $bp"
        exit 1
    fi
    touch "$bp"
    chown "$UI_USER:$(id -gn "$UI_USER")" "$bp"
    # %q keeps custom account home paths safe in the generated shell script.
    local log_dir log_file
    printf -v log_dir '%q' "$UI_HOME/.local/share"
    printf -v log_file '%q' "$UI_HOME/.local/share/sketchatone-ui.log"
    cat >> "$bp" << BPEOF

# >>> Sketchatone UI >>>
if [ "\$(tty)" = "/dev/tty1" ]; then
    export SDL_VIDEODRIVER=kmsdrm
    export SDL_VIDEO_KMSDRM_DEVICE_INDEX=$KMS_CARD_INDEX
    export KIVY_WINDOW=sdl2
    export KIVY_GL_BACKEND=sdl2
    mkdir -p $log_dir
    exec $UI_BIN --fullscreen >> $log_file 2>&1
fi
# <<< Sketchatone UI <<<
BPEOF
    install -d -m 755 "$(dirname "$UI_AUTOSTART_MARKER")"
    printf '%s\n' "$UI_USER" > "$UI_AUTOSTART_MARKER"
    print_success "Configured packaged UI launcher in $bp"
}

setup_autologin() {
    echo ""
    print_info "Console auto-login configuration"
    read -p "Enable tty1 auto-login for user '$UI_USER'? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if command -v raspi-config >/dev/null 2>&1; then
            # B2 selects console autologin, not the desktop display manager.
            raspi-config nonint do_boot_behaviour B2
            print_success "Console auto-login enabled"
        else
            print_warning "Enable console auto-login for $UI_USER manually."
            print_info "Run: sudo raspi-config → System Options → Boot / Auto Login"
        fi
    fi
}

uninstall_autostart() {
    cleanup_user_blocks
    if [ -f "$UI_AUTOSTART_MARKER" ] \
       && [ "$(cat "$UI_AUTOSTART_MARKER")" = "$UI_USER" ]; then
        rm -f "$UI_AUTOSTART_MARKER"
        # Legacy installations may have launched the UI for several accounts.
        # Keep the core-mode guard until the final managed launcher is removed.
        local account home
        while IFS=: read -r account _ _ _ _ home _; do
            [ -n "$home" ] && [ "$home" != "/" ] && [ -d "$home" ] || continue
            if has_managed_block "$home/.bash_profile" \
               || has_managed_block "$home/.config/labwc/autostart"; then
                printf '%s\n' "$account" > "$UI_AUTOSTART_MARKER"
                break
            fi
        done < <(getent passwd)
    fi
    print_success "UI autostart removed for $UI_USER; core service and device rules unchanged."
}

uninstall_all() {
    # Package removal has no reliable SUDO_USER. Include the tracked account
    # and legacy managed blocks in account homes, never whole user files.
    local tracked="" account home
    if [ -f "$UI_AUTOSTART_MARKER" ]; then
        tracked="$(cat "$UI_AUTOSTART_MARKER")"
    fi
    if [ -n "$tracked" ]; then
        UI_USER="$tracked"
        if try_resolve_ui_user; then
            uninstall_autostart
        else
            print_warning "Tracked UI user '$tracked' no longer exists; clearing its marker."
            [ "$(cat "$UI_AUTOSTART_MARKER")" != "$tracked" ] || rm -f "$UI_AUTOSTART_MARKER"
        fi
    fi
    while IFS=: read -r account _ _ _ _ home _; do
        [ -n "$home" ] && [ "$home" != "/" ] && [ -d "$home" ] || continue
        UI_USER="$account"
        UI_HOME="$home"
        uninstall_autostart
    done < <(getent passwd)
    print_success "All managed UI autostart blocks removed; core service and device rules unchanged."
}

has_managed_block() {
    [ -f "$1" ] && [ ! -L "$1" ] || return 1
    awk '
        $0 == "# >>> Sketchatone UI >>>" { opened = 1 }
        $0 == "# <<< Sketchatone UI <<<" && opened { found = 1 }
        END { exit !found }
    ' "$1"
}

migrate_all() {
    # An addon upgrade must not leave old config/backend launch arguments
    # pointing the attached UI back at its former private backend.
    local account home configured=false
    while IFS=: read -r account _ _ _ _ home _; do
        [ -n "$home" ] && [ "$home" != "/" ] && [ -d "$home" ] || continue
        if ! has_managed_block "$home/.bash_profile" \
           && ! has_managed_block "$home/.config/labwc/autostart"; then
            continue
        fi
        if [ "$configured" = false ]; then
            check_ui_installed
            [[ "$KMS_CARD_INDEX" =~ ^[0-9]+$ ]] || {
                print_error "KMS_CARD_INDEX must be a non-negative integer"; exit 1;
            }
            sketchatone-setup --mode always-on
            configured=true
        fi
        UI_USER="$account"
        UI_HOME="$home"
        setup_user_groups
        setup_bash_profile
        print_success "Migrated existing UI autostart for $UI_USER."
    done < <(getent passwd)
}

show_usage() {
    cat << USAGE
Sketchatone UI Autostart Setup

Usage: sudo $0 [OPTIONS]

Options:
  --install         Configure tty1 fullscreen UI autostart (default)
  --uninstall       Remove the resolved user's UI autostart
  --uninstall-all   Non-interactively remove all managed UI autostart blocks
                    (for addon removal; no login user required)
  --migrate-all     Non-interactively update existing managed UI launchers
                    (for addon upgrades; does not enable new login accounts)
  --no-reboot       Skip the reboot prompt after installation
  --install-hid     Compatibility no-op: core owns devices and permissions
  --uninstall-hid   Compatibility no-op: core owns devices and permissions
  --user <name>     Target login account (overrides UI_USER / SUDO_USER)
  --help            Show this help message

The optional UI addon connects to the core service automatically.
Installation first selects core always-on mode. Uninstall never changes
the core service, device rules, configuration ownership, or login settings.

Environment:
  UI_USER           Target login account (otherwise auto-detected)
  KMS_CARD_INDEX    DRM card index for the panel (default: 1)
USAGE
}

main_install() {
    check_root
    resolve_ui_user
    check_ui_installed
    [[ "$KMS_CARD_INDEX" =~ ^[0-9]+$ ]] || {
        print_error "KMS_CARD_INDEX must be a non-negative integer"; exit 1;
    }
    if [ -e "$UI_AUTOSTART_MARKER" ] \
       && [ "$(cat "$UI_AUTOSTART_MARKER")" != "$UI_USER" ]; then
        print_error "UI autostart is already tracked for another user."
        print_info "First run: sudo sketchatone-ui-setup-autostart --uninstall-all"
        exit 1
    fi
    echo ""
    echo "This enables the core service at boot and launches its fullscreen UI on tty1."
    echo "Only local render,input,video,tty groups and managed login blocks are changed."
    read -p "Continue with setup? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi

    sketchatone-setup --mode always-on
    setup_user_groups
    setup_bash_profile
    setup_autologin
    echo ""
    print_success "UI autostart configured for $UI_USER."
    print_info "Launcher: $UI_HOME/.bash_profile (KMSDRM direct)"
    print_info "Log: $UI_HOME/.local/share/sketchatone-ui.log"
    print_info "Backend and configs: sketchatone core service in /opt/sketchatone"
    print_info "Disable: sudo sketchatone-ui-setup-autostart --uninstall --user $UI_USER"
    if [ "$NO_REBOOT" = true ]; then
        print_info "Reboot or logout/login to start the UI."
        return
    fi
    read -p "Reboot now to start the UI? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        reboot
    else
        print_info "Reboot or logout/login to start the UI."
    fi
}

ACTION="install"
while [ $# -gt 0 ]; do
    case "$1" in
        --install) ACTION="install" ;;
        --uninstall) ACTION="uninstall" ;;
        --uninstall-all) ACTION="uninstall-all" ;;
        --migrate-all) ACTION="migrate-all" ;;
        --no-reboot) NO_REBOOT=true ;;
        --install-hid|--uninstall-hid) ACTION="hid-compat" ;;
        --user)
            [ -n "${2:-}" ] || { print_error "--user requires a value"; exit 1; }
            UI_USER="$2"; shift ;;
        --help|-h) show_usage; exit 0 ;;
        *) print_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
    shift
done

case "$ACTION" in
    install) main_install ;;
    uninstall) check_root; resolve_ui_user; uninstall_autostart ;;
    uninstall-all) check_root; uninstall_all ;;
    migrate-all) check_root; migrate_all ;;
    hid-compat) print_info "No action: the sketchatone core service owns devices and permissions." ;;
esac
