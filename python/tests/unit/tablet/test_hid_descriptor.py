"""Tests for the minimal HID report-descriptor parser."""

from __future__ import annotations

from sketchatone.tablet.server.hid_descriptor import (
    USAGE_PAGE_DIGITIZER,
    USAGE_PAGE_GENERIC_DESKTOP,
    parse_descriptor,
    pick_pen_ranges,
)


def _usage_page(value: int) -> bytes:
    return bytes([0x05, value & 0xFF])


def _logical_max_u16(value: int) -> bytes:
    return bytes([0x26, value & 0xFF, (value >> 8) & 0xFF])


def _report_id(value: int) -> bytes:
    return bytes([0x85, value & 0xFF])


def _usage(value: int) -> bytes:
    return bytes([0x09, value & 0xFF])


def _input(flags: int = 0x02) -> bytes:
    return bytes([0x81, flags & 0xFF])


def _build_pen_descriptor(*, report_id: int, x_max: int, y_max: int,
                          pressure_max: int) -> bytes:
    parts = [
        _usage_page(USAGE_PAGE_GENERIC_DESKTOP),
        _report_id(report_id),
        _logical_max_u16(x_max),
        _usage(0x30),  # X
        _input(),
        _logical_max_u16(y_max),
        _usage(0x31),  # Y
        _input(),
        _usage_page(USAGE_PAGE_DIGITIZER),
        _logical_max_u16(pressure_max),
        _usage(0x30),  # Tip Pressure (Digitizer page)
        _input(),
    ]
    return b"".join(parts)


def test_parse_single_report_id_extracts_x_y_pressure() -> None:
    desc = _build_pen_descriptor(report_id=7, x_max=15200, y_max=9500,
                                 pressure_max=8191)
    parsed = parse_descriptor(desc)
    assert set(parsed.keys()) == {7}
    r = parsed[7]
    assert r.x_max == 15200
    assert r.y_max == 9500
    assert r.pressure_max == 8191


def test_parse_multiple_report_ids() -> None:
    desc = _build_pen_descriptor(report_id=1, x_max=100, y_max=200,
                                 pressure_max=1024) + \
           _build_pen_descriptor(report_id=2, x_max=300, y_max=400,
                                 pressure_max=2048)
    parsed = parse_descriptor(desc)
    assert parsed[1].x_max == 100 and parsed[1].y_max == 200
    assert parsed[2].x_max == 300 and parsed[2].pressure_max == 2048


def test_parse_ignores_unrelated_usage_pages() -> None:
    # A keyboard-page input shouldn't register as X/Y/pressure.
    desc = b"".join([
        _usage_page(0x07),  # Keyboard
        _report_id(3),
        _logical_max_u16(0xFF),
        _usage(0x04),
        _input(),
    ])
    parsed = parse_descriptor(desc)
    r = parsed.get(3)
    assert r is not None
    assert r.x_max is None and r.y_max is None and r.pressure_max is None


def test_pick_pen_ranges_returns_first_report_with_xy() -> None:
    # Report 1 has only X (no Y); report 2 has both -> pick report 2.
    partial = b"".join([
        _usage_page(USAGE_PAGE_GENERIC_DESKTOP),
        _report_id(1),
        _logical_max_u16(50),
        _usage(0x30),
        _input(),
    ])
    full = _build_pen_descriptor(report_id=2, x_max=500, y_max=600,
                                 pressure_max=4096)
    ranges = pick_pen_ranges(partial + full)
    assert ranges is not None
    assert ranges.x_max == 500
    assert ranges.y_max == 600


def test_pick_pen_ranges_returns_none_when_no_xy_present() -> None:
    assert pick_pen_ranges(b"") is None


def test_truncated_descriptor_does_not_raise() -> None:
    # Prefix says 2 data bytes follow but only 1 is present.
    parse_descriptor(bytes([0x26, 0xFF]))
