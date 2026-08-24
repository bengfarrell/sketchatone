"""Decode raw scan codes from a tablet's auxiliary HID interface.

Tablets surface their hardware express keys through standard Keyboard
(usage page 0x01) or Consumer Control (usage page 0x0C) collections.
On macOS multiple top-level collections often share one IOHIDDevice
handle, so we dispatch on the Report ID rather than the path's
declared usage page. Clients receive the raw firmware-level
identifiers so they can build their own per-device mappings.
"""

from __future__ import annotations

from typing import List, Optional, Tuple


_KEYBOARD_USAGE_PAGE = 0x07
_CONSUMER_USAGE_PAGE = 0x0C


def _encode(report_id: int, page: int, code: int) -> int:
    return ((report_id & 0xFF) << 24) | ((page & 0xFF) << 16) | (code & 0xFFFF)


def _keyboard_keys_offset(body: bytes) -> Optional[int]:
    """Index in ``body`` where keycodes start for a keyboard-style report.

    Standard boot keyboard is 8 bytes ``[mod, reserved, k1..k6]``; many
    tablet firmwares ship a compressed 7-byte ``[mod, k1..k6]`` variant.
    Both have modifier in byte 0.
    """
    if len(body) == 8 and body[1] == 0:
        return 2
    if len(body) == 7:
        return 1
    return None


def parse_aux_report(data: bytes) -> Tuple[int, List[int]]:
    """Return ``(report_id, codes)`` for one aux HID report.

    Each code is encoded as ``(report_id << 24) | (page << 16) | code``
    so values are unique across report IDs and HID pages on the same
    composite interface, and stable per physical button. Keyboard
    presses combine the modifier byte and keycode into a single 16-bit
    payload so a chorded shortcut (e.g. Ctrl+1) yields one code rather
    than separate modifier / key codes that would alias across buttons.
    """
    if not data:
        return (0, [])
    report_id = data[0]
    body = bytes(data[1:])
    codes: List[int] = []

    keys_offset = _keyboard_keys_offset(body)
    if keys_offset is not None:
        modifier = body[0]
        active_keys = [k for k in body[keys_offset:] if k]
        if active_keys:
            for k in active_keys:
                codes.append(_encode(report_id, _KEYBOARD_USAGE_PAGE,
                                     (modifier << 8) | k))
        elif modifier:
            for bit in range(8):
                if modifier & (1 << bit):
                    codes.append(_encode(report_id, _KEYBOARD_USAGE_PAGE,
                                         0xE000 | (1 << bit)))
    elif len(body) in (1, 2, 3):
        code = (body[0] | (body[1] << 8)) if len(body) >= 2 else body[0]
        if code:
            codes.append(_encode(report_id, _CONSUMER_USAGE_PAGE, code))
    else:
        for i, b in enumerate(body):
            if b:
                codes.append(_encode(report_id, 0xFF, (i << 8) | b))

    seen: set = set()
    out: List[int] = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return (report_id, out)
