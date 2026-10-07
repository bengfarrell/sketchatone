"""Tests for the EventAdapter (report → websocket event translation)."""

from __future__ import annotations

import math

from sketchatone.tablet.otd.reports import (
    DeviceReport,
    OutOfRangeReport,
    StandardDigitizerReport,
    TabletReport,
    TiltTabletReport,
)
from sketchatone.tablet.server.event_adapter import EventAdapter

from .conftest import make_config


def test_out_of_range_report_emits_empty_event() -> None:
    adapter = EventAdapter(make_config())
    ev = adapter.adapt(OutOfRangeReport(raw=b""))
    assert ev is not None
    assert ev.x == 0.0 and ev.y == 0.0 and ev.pressure == 0.0
    assert ev.state == "none"
    assert adapter._in_range is False


def test_tablet_report_normalizes_position_and_pressure() -> None:
    adapter = EventAdapter(make_config(max_x=1000, max_y=500, max_pressure=8192))
    report = TabletReport(raw=b"", position=(500, 250), pressure=4096,
                          pen_buttons=[True, False, False])
    ev = adapter.adapt(report)
    assert ev is not None
    assert ev.x == 0.5
    assert ev.y == 0.5
    assert ev.pressure == 0.5
    assert ev.primaryButtonPressed is True
    assert ev.secondaryButtonPressed is False
    assert ev.state == "contact"


def test_hover_state_when_pressure_zero() -> None:
    adapter = EventAdapter(make_config())
    ev = adapter.adapt(TabletReport(raw=b"", position=(100, 50), pressure=0))
    assert ev is not None and ev.state == "hover"


def test_values_clamp_to_unit_range() -> None:
    adapter = EventAdapter(make_config(max_x=100, max_y=100, max_pressure=100))
    ev = adapter.adapt(TabletReport(raw=b"", position=(10_000, -50), pressure=999))
    assert ev is not None
    assert ev.x == 1.0 and ev.y == 0.0 and ev.pressure == 1.0


def test_override_ranges_replaces_normalization_denominators() -> None:
    adapter = EventAdapter(make_config(max_x=100, max_y=100, max_pressure=100))
    adapter.override_ranges(max_x=1000, max_y=500, max_pressure=8192)
    ev = adapter.adapt(TabletReport(raw=b"", position=(500, 250), pressure=4096))
    assert ev is not None
    assert ev.x == 0.5 and ev.y == 0.5 and ev.pressure == 0.5


def test_tilt_magnitude_and_components() -> None:
    adapter = EventAdapter(make_config())
    report = TiltTabletReport(raw=b"", position=(0, 0), pressure=0,
                              tilt=(127, -127), pen_buttons=[])
    ev = adapter.adapt(report)
    assert ev is not None
    assert ev.tiltX == 1.0
    assert ev.tiltY == -1.0
    # hypot(1, -1) clamps to 1.0.
    assert ev.tiltXY == 1.0
    half = adapter.adapt(TiltTabletReport(raw=b"", position=(0, 0), pressure=0,
                                          tilt=(64, 0)))
    assert half is not None
    assert math.isclose(half.tiltX, 64 / 127.0)
    assert half.tiltY == 0.0


def test_standard_digitizer_report_routes_through_position_branch() -> None:
    adapter = EventAdapter(make_config(max_x=1000, max_y=1000, max_pressure=1000))
    r = StandardDigitizerReport(raw=b"", position=(250, 500), pressure=100,
                                 tilt=(0, 0), pen_buttons=[True, False],
                                 in_range=True)
    ev = adapter.adapt(r)
    assert ev is not None
    assert ev.x == 0.25 and ev.y == 0.5
    assert ev.primaryButtonPressed is True


def test_unknown_device_report_returns_none() -> None:
    adapter = EventAdapter(make_config())
    assert adapter.adapt(DeviceReport(raw=b"\x00")) is None


def test_aux_codes_multiplex_across_slots_and_dedup() -> None:
    adapter = EventAdapter(make_config())
    changed_a = adapter.update_aux_codes(b"path-a", 1, [0x01, 0x02])
    changed_b = adapter.update_aux_codes(b"path-b", 2, [0x02, 0x03])
    assert changed_a and changed_b
    assert adapter._current_aux_codes() == [0x01, 0x02, 0x03]

    # Release slot A; B's codes remain (including the shared 0x02).
    released = adapter.update_aux_codes(b"path-a", 1, [])
    assert released is True
    assert adapter._current_aux_codes() == [0x02, 0x03]


def test_aux_code_update_no_change_returns_false() -> None:
    adapter = EventAdapter(make_config())
    adapter.update_aux_codes(b"p", 1, [0x10])
    assert adapter.update_aux_codes(b"p", 1, [0x10]) is False


def test_empty_event_includes_current_aux_codes() -> None:
    adapter = EventAdapter(make_config())
    adapter.update_aux_codes(b"p", 1, [0xAB])
    ev = adapter.adapt(OutOfRangeReport(raw=b""))
    assert ev is not None
    assert ev.auxCodes == [0xAB]
    assert ev.to_dict()["auxCodes"] == [0xAB]


def test_to_dict_contains_expected_keys() -> None:
    adapter = EventAdapter(make_config())
    ev = adapter.adapt(TabletReport(raw=b"", position=(0, 0), pressure=0))
    assert ev is not None
    d = ev.to_dict()
    assert set(d.keys()) == {
        "type", "timestamp", "state", "x", "y", "pressure",
        "tiltX", "tiltY", "tiltXY",
        "primaryButtonPressed", "secondaryButtonPressed", "auxCodes",
    }
