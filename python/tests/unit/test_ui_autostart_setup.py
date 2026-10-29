"""Validate UI setup lifecycle without changing host services or user accounts."""

from pathlib import Path
import shlex
import shutil
import subprocess
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[3]
UI_SETUP = ROOT / "install-scripts/setup-ui-autostart.sh"
CORE_SETUP = ROOT / "install-scripts/sketchatone-setup"
BEGIN = "# >>> Sketchatone UI >>>"
END = "# <<< Sketchatone UI <<<"


@pytest.fixture
def workspace():
    directory = ROOT / f".pytest-ui-autostart-{uuid.uuid4().hex}"
    directory.mkdir()
    try:
        yield directory
    finally:
        shutil.rmtree(directory)


def run_helper(commands, *, core=False, check=True):
    source = (CORE_SETUP if core else UI_SETUP).read_text()
    source = source.split('# Main\n' if core else 'ACTION="install"\n')[0]
    return subprocess.run(
        ["bash"], input=source + "\n" + commands, text=True,
        capture_output=True, check=check,
    )


def test_ui_has_no_core_device_or_config_ownership():
    source = UI_SETUP.read_text()
    assert "/etc/udev/" not in source
    assert "udevadm" not in source
    assert "setup_config_ownership" not in source
    assert "--enable-ws" not in source
    assert "exec $UI_BIN --fullscreen >>" in source
    assert source.index("sketchatone-setup --mode always-on\n") < source.index(
        "    setup_user_groups\n"
    )
    assert 'usermod -aG render,input,video,tty "$UI_USER"' in source


@pytest.mark.parametrize("flag", ["--install-hid", "--uninstall-hid"])
def test_hid_compatibility_flags_are_noops(flag):
    result = subprocess.run(["bash", str(UI_SETUP), flag], text=True,
                            capture_output=True, check=True)
    assert "core service owns devices and permissions" in result.stdout


def test_no_reboot_skips_reboot_prompt():
    result = run_helper("""
NO_REBOOT=true
check_root() { :; }
resolve_ui_user() { UI_USER=kiosk; UI_HOME=/home/kiosk; }
check_ui_installed() { :; }
setup_user_groups() { :; }
setup_bash_profile() { :; }
setup_autologin() { :; }
sketchatone-setup() { :; }
read() { REPLY=y; }
reboot() { echo UNEXPECTED_REBOOT; }
main_install
""")
    assert "UNEXPECTED_REBOOT" not in result.stdout
    assert "Reboot or logout/login" in result.stdout


def test_install_cleans_legacy_blocks_and_writes_only_packaged_launcher(workspace):
    home = workspace / "home"
    labwc = home / ".config/labwc"
    labwc.mkdir(parents=True)
    profile = home / ".bash_profile"
    legacy = labwc / "autostart"
    block = f"{BEGIN}\nold launch\n{END}\n"
    profile.write_text(f"export KEEP=1\n{block}")
    legacy.write_text(f"unrelated-command &\n{block}")
    marker = workspace / "etc/ui-autostart-user"
    run_helper(f"""
UI_HOME={shlex.quote(str(home))}
UI_USER=kiosk
UI_AUTOSTART_MARKER={shlex.quote(str(marker))}
chown() {{ :; }}
id() {{ echo kiosk; }}
setup_bash_profile
""")
    assert marker.read_text() == "kiosk\n"
    assert legacy.read_text() == "unrelated-command &\n"
    assert profile.read_text().count(BEGIN) == 1
    assert "old launch" not in profile.read_text()
    assert "export KEEP=1" in profile.read_text()
    assert "exec /usr/bin/sketchatone-ui --fullscreen >>" in profile.read_text()
    subprocess.run(["bash", "-n", str(profile)], check=True)


@pytest.mark.parametrize("tracked,removed", [("kiosk", True), ("other", False)])
def test_uninstall_only_clears_matching_user_marker(workspace, tracked, removed):
    marker = workspace / "ui-autostart-user"
    marker.write_text(tracked + "\n")
    profile = workspace / ".bash_profile"
    profile.write_text(f"keep\n{BEGIN}\nlaunch\n{END}\nafter\n")
    run_helper(f"""
UI_HOME={shlex.quote(str(workspace))}
UI_USER=kiosk
UI_AUTOSTART_MARKER={shlex.quote(str(marker))}
uninstall_autostart
""")
    assert marker.exists() is not removed
    assert profile.read_text() == "keep\nafter\n"


def test_cleanup_preserves_unclosed_blocks_and_symlinks(workspace):
    profile = workspace / ".bash_profile"
    original = f"before\n{BEGIN}\nunclosed\nafter\n"
    profile.write_text(original)
    link = workspace / "link"
    link.symlink_to(profile)
    run_helper(f"""
remove_managed_block {shlex.quote(str(profile))}
remove_managed_block {shlex.quote(str(link))}
""")
    assert profile.read_text() == original
    assert link.is_symlink()


def test_uninstall_all_without_resolving_login_user(workspace):
    homes = [workspace / "one", workspace / "two"]
    for home in homes:
        home.mkdir()
        (home / ".bash_profile").write_text(
            f"keep\n{BEGIN}\nlegacy-launch\n{END}\n"
        )
    marker = workspace / "ui-autostart-user"
    marker.write_text("removed-account\n")
    accounts = "".join(
        f"user{i}:x:100{i}:100{i}::{home}:/bin/bash\n"
        for i, home in enumerate(homes)
    )
    run_helper(f"""
UI_AUTOSTART_MARKER={shlex.quote(str(marker))}
UI_USER=ignored
SUDO_USER=ignored
try_resolve_ui_user() {{ return 1; }}
getent() {{ printf '%s' {shlex.quote(accounts)}; }}
uninstall_all
""")
    assert not marker.exists()
    assert all((home / ".bash_profile").read_text() == "keep\n" for home in homes)


def test_migrate_all_updates_only_existing_managed_launchers(workspace):
    homes = [workspace / "legacy", workspace / "unmanaged"]
    for home in homes:
        home.mkdir()
    profile = homes[0] / ".bash_profile"
    profile.write_text(
        f"keep\n{BEGIN}\nexec sketchatone-ui -c old.json --enable-ws\n{END}\n"
    )
    unmanaged = homes[1] / ".bash_profile"
    unmanaged.write_text("unrelated-command\n")
    marker = workspace / "etc/ui-autostart-user"
    accounts = "".join(
        f"user{i}:x:100{i}:100{i}::{home}:/bin/bash\n"
        for i, home in enumerate(homes)
    )
    result = run_helper(f"""
UI_AUTOSTART_MARKER={shlex.quote(str(marker))}
getent() {{ printf '%s' {shlex.quote(accounts)}; }}
check_ui_installed() {{ :; }}
setup_user_groups() {{ :; }}
chown() {{ :; }}
id() {{ echo users; }}
sketchatone-setup() {{ echo CORE_ALWAYS_ON; }}
migrate_all
""")
    assert result.stdout.count("CORE_ALWAYS_ON") == 1
    assert result.stdout.index("CORE_ALWAYS_ON") < result.stdout.index("Configured packaged")
    assert "old.json" not in profile.read_text()
    assert "exec /usr/bin/sketchatone-ui --fullscreen >>" in profile.read_text()
    assert unmanaged.read_text() == "unrelated-command\n"
    assert marker.read_text() == "user0\n"


def test_migrate_all_does_not_enable_core_without_existing_ui():
    result = run_helper("""
getent() { :; }
sketchatone-setup() { echo UNEXPECTED_CORE_CHANGE; }
migrate_all
""")
    assert "UNEXPECTED_CORE_CHANGE" not in result.stdout


@pytest.mark.parametrize("mode,allowed", [
    ("usb-trigger", False), ("manual", False), ("always-on", True),
])
def test_core_mode_guard(workspace, mode, allowed):
    marker = workspace / "ui-autostart-user"
    marker.write_text("kiosk\n")
    result = run_helper(f"""
UI_AUTOSTART_MARKER={shlex.quote(str(marker))}
check_ui_autostart_mode {mode}
""", core=True, check=False)
    assert (result.returncode == 0) is allowed
    if not allowed:
        assert "--uninstall --user kiosk" in result.stdout
        assert "--uninstall-all" in result.stdout
