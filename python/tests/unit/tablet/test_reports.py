"""Byte-level parsing tests for the OTD report dataclasses."""

from __future__ import annotations

from sketchatone.tablet.otd.reports import (
    AuxReport,
    StandardDigitizerReport,
    TabletReport,
    TiltTabletReport,
    _bit,
    _s8,
    _u16le,
)


def test_helpers_u16le_s8_bit() -> None:
    assert _u16le(bytes([0, 0, 0x34, 0x12]), 2) == 0x1234
    assert _s8(0x7F) == 127
    assert _s8(0x80) == -128
    assert _s8(0xFF) == -1
    assert _bit(0b0000_0010, 1) is True
    assert _bit(0b0000_0010, 0) is False


def test_tablet_report_parses_position_pressure_and_buttons() -> None:
    # report_id, status=0b0000_0110 (btn1+btn2), x=0x0102, y=0x0304, p=0x0506
    data = bytes([0x10, 0b0000_0110, 0x02, 0x01, 0x04, 0x03, 0x06, 0x05])
    r = TabletReport.parse(data)
    assert r.position == (0x0102, 0x0304)
    assert r.pressure == 0x0506
    assert r.pen_buttons == [True, True, False]


def test_tilt_tablet_report_signed_tilt_and_inversion() -> None:
    # tilt_x byte at index 10, tilt_y byte at index 11
    data = bytes([0x01, 0b0000_0010, 0, 0, 0, 0, 0, 0, 0, 0, 0xFE, 0x05])
    r = TiltTabletReport.parse(data)
    assert r.tilt == (-2, 5)
    inv = TiltTabletReport.parse(data, invert_tilt_x=True, invert_tilt_y=True)
    assert inv.tilt == (2, -5)
    assert r.pen_buttons == [True, False, False]


def test_standard_digitizer_pen_sample_sets_in_range() -> None:
    # status bit7=1 (in range), bit0=1 (tip)
    status = 0b1000_0001
    data = bytes([0x07, status, 0x10, 0x00, 0x20, 0x00, 0x80, 0x01, 0x05, 0xFB])
    r = StandardDigitizerReport.parse(data)
    assert isinstance(r, StandardDigitizerReport)
    assert r.position == (0x0010, 0x0020)
    assert r.pressure == 0x0180
    assert r.in_range is True
    # default invert_tilt_y=True flips Y; X passes through.
    assert r.tilt == (5, 5)
    assert r.pen_buttons == [False, False]


def test_standard_digitizer_eraser_bit() -> None:
    status = 0b1000_0100  # in_range + barrel2/eraser
    data = bytes([0x07, status, 0, 0, 0, 0, 0, 0, 0, 0])
    r = StandardDigitizerReport.parse(data)
    assert r.eraser is True
    assert r.pen_buttons == [False, True]


def test_standard_digitizer_without_tilt_bytes_keeps_zero_tilt() -> None:
    # exactly 8 bytes: no tilt section.
    status = 0b1000_0001
    data = bytes([0x07, status, 0, 0, 0, 0, 0, 0])
    r = StandardDigitizerReport.parse(data)
    assert r.tilt == (0, 0)


def test_aux_report_parses_four_buttons_from_byte_three() -> None:
    data = bytes([0x06, 0, 0, 0b0000_1011])
    r = AuxReport.parse(data)
    assert r.aux_buttons == [True, True, False, True]
