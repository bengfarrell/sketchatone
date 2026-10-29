"""Guided provisioning for a dedicated, headless Raspberry Pi."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys

from ..networking import NetworkConfigStore


NETWORK_CONFIG = "/etc/sketchatone/network.json"


def confirm(prompt: str, *, default: bool = False) -> bool:
    suffix = " [Y/n]: " if default else " [y/N]: "
    while True:
        answer = input(prompt + suffix).strip().lower()
        if answer in ("", "y", "yes", "n", "no"):
            return default if not answer else answer in ("y", "yes")
        print("Enter yes or no.")


def collect_network_settings(store: NetworkConfigStore) -> dict:
    """Read existing settings without prompting or changing OS networking."""
    return store.public_config()


def provision(settings: dict, store: NetworkConfigStore, *, iphone: bool, gadget: bool, trim: bool,
              native_ui: bool = False) -> None:
    store.validate(settings)
    if iphone:
        subprocess.run(["apt-get", "update"], check=True)
        subprocess.run([
            "apt-get", "install", "-y", "usbmuxd", "libimobiledevice-utils",
        ], check=True)
        subprocess.run(["modprobe", "ipheth"], check=True)
    if gadget:
        subprocess.run(["sketchatone-setup-usb-gadget", "--yes", "--no-reboot"], check=True)
    if trim:
        subprocess.run(["sketchatone-boot-trim", "--install"], check=True)
    if native_ui:
        subprocess.run(["sketchatone-ui-setup-autostart", "--install", "--no-reboot"], check=True)

    subprocess.run(["sketchatone-setup", "--mode", "always-on"], check=True)
    print("\nSketchatone will run at boot, even without a tablet.")
    print("Existing OS Wi-Fi settings and the network JSON have not been changed.")
    print("Manage networking later in the dashboard's Network panel or in " + store.path + ".")
    if settings["enabled"]:
        print("The service restart will use your existing network JSON and may disconnect SSH.")
    else:
        print("Sketchatone network management remains disabled; the Pi keeps its existing connection.")
    if gadget or trim or native_ui:
        print("A reboot is required for the selected boot changes; reboot when ready.")
    if iphone:
        print("On iPhone, enable Personal Hotspot and trust this Pi when connected.")
    print("Select your MIDI output in the dashboard if not using the configured USB MIDI gadget.")
    subprocess.run(["systemctl", "restart", "sketchatone"], check=True)


def main() -> int:
    if sys.platform != "linux" or os.geteuid() != 0:
        print("Run this setup as root on Raspberry Pi OS.", file=sys.stderr)
        return 1
    if not sys.stdin.isatty():
        print("Appliance setup requires an interactive terminal (use ssh -t).", file=sys.stderr)
        return 1
    model = Path("/proc/device-tree/model")
    if not model.exists() or "Raspberry Pi" not in model.read_text():
        print("The appliance profile is intended for a dedicated Raspberry Pi.", file=sys.stderr)
        return 1
    print("Sketchatone headless appliance setup")
    print("Sketchatone will start at boot and use the Pi's existing network connection.")
    print("Wi-Fi and tethering can be configured later in the web dashboard.")
    print("An existing " + NETWORK_CONFIG + " is preserved and used by the service.")
    print("No setup changes are applied until the final confirmation.")
    store = NetworkConfigStore(NETWORK_CONFIG)
    try:
        settings = collect_network_settings(store)
        store.validate(settings)
        iphone = False
        gadget = confirm("Configure the Pi's USB peripheral port as a MIDI device?")
        trim = confirm("Apply optional boot trimming (masks unused services and changes boot settings)?")
        native_ui = bool(shutil.which("sketchatone-ui-setup-autostart")) and confirm(
            "Configure the installed native UI to start on the local display?"
        )
        print("\nSelected: always-on; USB MIDI {}; boot trim {}; native UI {}.".format(
            gadget, trim, native_ui,
        ))
        if settings["enabled"]:
            print("Existing network management is enabled; restarting may interrupt SSH.")
        if not confirm("Apply this appliance setup?"):
            print("Setup cancelled; no settings saved.")
            return 0
        provision(settings, store, iphone=iphone, gadget=gadget, trim=trim, native_ui=native_ui)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Appliance setup failed: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nSetup interrupted.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
