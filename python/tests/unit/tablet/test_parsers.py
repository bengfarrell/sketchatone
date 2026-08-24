"""Tests for the OTD parser registry and per-vendor dispatch."""

from __future__ import annotations

import pytest

from sketchatone.tablet.otd.parsers import (
    StandardDigitizerReportParser,
    UnknownParserError,
    get_parser,
    known_parsers,
)
from sketchatone.tablet.otd.parsers.huion import (
    HuionTiltReportParser,
    InspiroyAuxReport,
    InspiroyReportParser,
)
from sketchatone.tablet.otd.parsers.uclogic import (
    UCLogicAuxReport,
    UCLogicTiltReportParser,
)
from sketchatone.tablet.otd.parsers.xp_pen import (
    XPPenAuxReport,
    XPPenReportParser,
    XPPenTabletOverflowReport,
    XPPenTabletReport,
)
from sketchatone.tablet.otd.reports import (
    DeviceReport,
    OutOfRangeReport,
    StandardDigitizerReport,
    TiltTabletReport,
)


def test_registry_lists_known_parsers() -> None:
    names = known_parsers()
    assert "OpenTabletDriver.Plugin.Tablet.TabletReportParser" in names
    assert "OpenTabletDriver.Configurations.Parsers.Huion.InspiroyReportParser" in names


def test_get_parser_returns_fresh_instance() -> None:
    p1 = get_parser("OpenTabletDriver.Plugin.Tablet.TabletReportParser")
    p2 = get_parser("OpenTabletDriver.Plugin.Tablet.TabletReportParser")
    assert p1 is not p2
    assert hasattr(p1, "parse")


def test_get_parser_unknown_raises() -> None:
    with pytest.raises(UnknownParserError):
        get_parser("Made.Up.Parser")


def test_standard_digitizer_parser_returns_none_for_short_packet() -> None:
    parser = StandardDigitizerReportParser()
    assert parser.parse(b"\x07\x80\x00") is None


def test_standard_digitizer_parser_status_zero_is_out_of_range() -> None:
    parser = StandardDigitizerReportParser()
    res = parser.parse(bytes([0x07, 0x00, 0, 0, 0, 0, 0, 0]))
    assert isinstance(res, OutOfRangeReport)


def test_standard_digitizer_parser_ignores_non_pen_status() -> None:
    # bit 7 clear and not exactly 0 -> ignored.
    parser = StandardDigitizerReportParser()
    assert parser.parse(bytes([0x07, 0x42, 0, 0, 0, 0, 0, 0])) is None


def test_standard_digitizer_parser_returns_pen_sample_when_bit7_set() -> None:
    parser = StandardDigitizerReportParser()
    res = parser.parse(bytes([0x07, 0x81, 0x10, 0x00, 0x20, 0x00, 0x00, 0x01]))
    assert isinstance(res, StandardDigitizerReport)
    assert res.position == (0x10, 0x20)


def test_uclogic_tilt_parser_routes_aux_when_status_bit6_set() -> None:
    parser = UCLogicTiltReportParser()
    aux_status = 1 << 6
    data = bytes([1, aux_status, 0, 0, 0xFF, 0x00, 0x0F, 0, 0, 0, 0, 0])
    res = parser.parse(data)
    assert isinstance(res, UCLogicAuxReport)
    # 20 button bits across data[4..6].
    assert len(res.aux_buttons) == 20
    assert res.aux_buttons[:8] == [True] * 8


def test_uclogic_tilt_parser_falls_through_to_tilt_tablet() -> None:
    parser = UCLogicTiltReportParser()
    data = bytes([1, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    res = parser.parse(data)
    assert isinstance(res, TiltTabletReport)


def test_inspiroy_parser_dispatches_all_status_branches() -> None:
    parser = InspiroyReportParser()
    aux = parser.parse(bytes([1, 0xE0] + [0] * 10))
    assert isinstance(aux, UCLogicAuxReport)
    oor = parser.parse(bytes([1, 0x00] + [0] * 10))
    assert isinstance(oor, OutOfRangeReport)
    tilt = parser.parse(bytes([1, 0x80] + [0] * 10))
    assert isinstance(tilt, TiltTabletReport)
    rel = parser.parse(bytes([1, 0xF1] + [0] * 10))
    assert type(rel).__name__ == "InspiroyRelWheelReport"
    unknown = parser.parse(bytes([1, 0x05] + [0] * 10))
    assert isinstance(unknown, DeviceReport)


def test_huion_tilt_parser_routes_aux_and_wheel() -> None:
    parser = HuionTiltReportParser()
    aux = parser.parse(bytes([1, 0xE0] + [0] * 10))
    assert isinstance(aux, InspiroyAuxReport)
    wheel = parser.parse(bytes([1, 0xF0] + [0] * 10))
    assert type(wheel).__name__ == "HuionWheelReport"


def test_xp_pen_parser_dispatch() -> None:
    parser = XPPenReportParser()
    assert isinstance(
        parser.parse(bytes([1, 0xC0] + [0] * 10)), OutOfRangeReport,
    )
    aux_status = 1 << 4
    aux = parser.parse(bytes([1, aux_status] + [0] * 14))
    assert isinstance(aux, XPPenAuxReport)
    overflow = parser.parse(bytes([1, 0x80] + [0] * 14))
    assert isinstance(overflow, XPPenTabletOverflowReport)
    short = parser.parse(bytes([1, 0x80] + [0] * 8))
    assert isinstance(short, XPPenTabletReport)
