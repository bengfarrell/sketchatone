"""Huion vendor-specific report parsers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from ..reports import DeviceReport, OutOfRangeReport, TiltTabletReport, _bit
from .uclogic import UCLogicAuxReport


@dataclass
class InspiroyAuxReport:
    """Port of OpenTabletDriver.Configurations.Parsers.UCLogic.InspiroyAuxReport.

    Same layout as UCLogicAuxReport with one bit re-purposed for a wheel button.
    """
    raw: bytes
    aux_buttons: List[bool] = field(default_factory=list)
    wheel_buttons: List[List[bool]] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes) -> "InspiroyAuxReport":
        aux = (
            [_bit(data[4], i) for i in range(8)]
            + [_bit(data[5], i) for i in (0, 1, 2, 3, 5, 6, 7)]
            + [_bit(data[6], i) for i in range(4)]
        )
        wheel = [[_bit(data[5], 4)]]
        return cls(raw=data, aux_buttons=aux, wheel_buttons=wheel)


@dataclass
class InspiroyRelWheelReport:
    """Stub for InspiroyRelWheelReport - just preserves raw bytes."""
    raw: bytes


@dataclass
class HuionWheelReport:
    """Stub for HuionWheelReport - just preserves raw bytes."""
    raw: bytes


class InspiroyReportParser:
    """Port of OpenTabletDriver.Configurations.Parsers.Huion.InspiroyReportParser."""

    def parse(self, data: bytes):
        b = data[1]
        if b == 0xE0:
            return UCLogicAuxReport.parse(data)
        if b == 0xE3:
            return UCLogicAuxReport.parse(data)
        if b == 0xF1:
            return InspiroyRelWheelReport(raw=data)
        if b == 0x00:
            return OutOfRangeReport(raw=data)
        if _bit(b, 7):
            return TiltTabletReport.parse(data, invert_tilt_x=False, invert_tilt_y=True)
        return DeviceReport(raw=data)


class HuionTiltReportParser:
    """Port of OpenTabletDriver.Configurations.Parsers.Huion.HuionTiltReportParser."""

    def parse(self, data: bytes):
        b = data[1]
        if b == 0xE0:
            return InspiroyAuxReport.parse(data)
        if b == 0xF0:
            return HuionWheelReport(raw=data)
        return TiltTabletReport.parse(data)
