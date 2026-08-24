"""Generate Linux udev rules so the daemon can read tablet HID nodes without root.

This is a Python port of OpenTabletDriver's ``generate-rules.sh``. It walks the
vendored configurations, dedupes by (VendorID, ProductID), and prints rules
that:

* tag matching hidraw / usb nodes with ``uaccess`` (gives logged-in users read
  access via systemd-logind),
* tell libinput to ignore devices that set the ``libinputoverride`` attribute,
  so the tablet's pointer events don't move the desktop cursor.

Usage:
    python -m sketchatone.tablet.udev > 99-sketchatone.rules
    sudo cp 99-sketchatone.rules /etc/udev/rules.d/
    sudo udevadm control --reload && sudo udevadm trigger
"""

from __future__ import annotations

import sys
from typing import Iterable, List, Tuple

from .otd.config_loader import TabletConfiguration, load_all_configs


HEADER = [
    "# sketchatone udev rules (derived from OpenTabletDriver configurations)",
    "# https://github.com/OpenTabletDriver/OpenTabletDriver",
    "",
]


def _group_by_vid_pid(configs: Iterable[TabletConfiguration]):
    """Return list of (vid, pid, names, libinput_override) tuples, sorted."""
    buckets: dict[Tuple[int, int], dict] = {}
    for cfg in configs:
        for ident in cfg.digitizer_identifiers:
            key = (ident.vendor_id, ident.product_id)
            entry = buckets.setdefault(key, {"names": set(), "libinput": False})
            entry["names"].add(cfg.name)
            if cfg.libinput_override:
                entry["libinput"] = True
    out = []
    for (vid, pid), entry in sorted(buckets.items()):
        out.append((vid, pid, sorted(entry["names"]), entry["libinput"]))
    return out


def generate_rules(configs: Iterable[TabletConfiguration]) -> List[str]:
    lines = list(HEADER)
    for vid, pid, names, libinput in _group_by_vid_pid(configs):
        vid_h = f"{vid:04x}"
        pid_h = f"{pid:04x}"
        for name in names:
            lines.append(f"# {name}")
        lines.append(
            f'KERNEL=="hidraw*", ATTRS{{idVendor}}=="{vid_h}", '
            f'ATTRS{{idProduct}}=="{pid_h}", TAG+="uaccess", TAG+="udev-acl"'
        )
        lines.append(
            f'SUBSYSTEM=="usb", ATTRS{{idVendor}}=="{vid_h}", '
            f'ATTRS{{idProduct}}=="{pid_h}", TAG+="uaccess", TAG+="udev-acl"'
        )
        if libinput:
            lines.append(
                f'SUBSYSTEM=="input", ATTRS{{idVendor}}=="{vid_h}", '
                f'ATTRS{{idProduct}}=="{pid_h}", ENV{{LIBINPUT_IGNORE_DEVICE}}="1"'
            )
        lines.append("")
    return lines


def main() -> int:
    configs = load_all_configs()
    for line in generate_rules(configs):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
