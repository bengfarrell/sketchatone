"""Minimal HID report-descriptor parser.

The standard digitizer interface on most tablets uses a coordinate range
that differs from the vendor interface OTD configs are calibrated for.
We parse the descriptor returned by ``hid.device.get_report_descriptor()``
to read the actual Logical Maximum for X, Y, and Tip Pressure so the
normalization layer can use the right denominators.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional


USAGE_PAGE_GENERIC_DESKTOP = 0x01
USAGE_PAGE_DIGITIZER = 0x0D
USAGE_X = 0x30
USAGE_Y = 0x31
USAGE_TIP_PRESSURE = 0x30  # under the Digitizer page


@dataclass
class PenRanges:
    """Logical maximums for one pen report, keyed by Report ID."""
    x_max: Optional[int] = None
    y_max: Optional[int] = None
    pressure_max: Optional[int] = None


def parse_descriptor(desc: bytes) -> Dict[int, PenRanges]:
    """Walk a HID report descriptor; return ranges per Report ID.

    Implements just enough of the HID 1.11 item-stream format to extract
    Global Logical Maximum values bound to X, Y and Tip Pressure usages.
    Unknown items are skipped.
    """
    out: Dict[int, PenRanges] = {}

    usage_page = 0
    logical_max = 0
    report_id = 0
    usages: list[tuple[int, int]] = []

    _SIZE_BYTES = {0: 0, 1: 1, 2: 2, 3: 4}

    i = 0
    n = len(desc)
    while i < n:
        prefix = desc[i]
        i += 1
        if prefix == 0xFE:
            # Long items are rare in HID descriptors; skip safely.
            if i >= n:
                break
            size = desc[i]
            i += 2 + size
            continue

        size = _SIZE_BYTES[prefix & 0x03]
        item_type = (prefix >> 2) & 0x03
        item_tag = (prefix >> 4) & 0x0F

        if i + size > n:
            break
        raw = desc[i:i + size]
        i += size
        udata = int.from_bytes(raw, "little", signed=False) if size else 0
        sdata = int.from_bytes(raw, "little", signed=True) if size else 0

        if item_type == 1:  # Global
            if item_tag == 0x0:
                usage_page = udata
            elif item_tag == 0x2:
                logical_max = sdata
            elif item_tag == 0x8:
                report_id = udata
        elif item_type == 2:  # Local
            if item_tag == 0x0:
                # 16-bit usage may carry an inline page in the high byte.
                if size == 4:
                    page = (udata >> 16) & 0xFFFF
                    usage = udata & 0xFFFF
                else:
                    page = usage_page
                    usage = udata
                usages.append((page, usage))
        elif item_type == 0:  # Main
            if item_tag == 0x8:  # Input
                ranges = out.setdefault(report_id, PenRanges())
                for page, usage in usages:
                    if page == USAGE_PAGE_GENERIC_DESKTOP and usage == USAGE_X:
                        if ranges.x_max is None:
                            ranges.x_max = logical_max
                    elif page == USAGE_PAGE_GENERIC_DESKTOP and usage == USAGE_Y:
                        if ranges.y_max is None:
                            ranges.y_max = logical_max
                    elif page == USAGE_PAGE_DIGITIZER and usage == USAGE_TIP_PRESSURE:
                        if ranges.pressure_max is None:
                            ranges.pressure_max = logical_max
            # All Main items clear Local state per HID 1.11 §6.2.2.8.
            usages = []

    return out


def pick_pen_ranges(descriptor: bytes) -> Optional[PenRanges]:
    """Return the first Report ID's ranges that has both X and Y maxes set."""
    parsed = parse_descriptor(descriptor)
    for report_id in sorted(parsed):
        r = parsed[report_id]
        if r.x_max and r.y_max:
            return r
    return None
