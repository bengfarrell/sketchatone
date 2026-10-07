"""XP-Pen vendor-specific report parsers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple

from ..reports import OutOfRangeReport, TabletReport, _bit, _s8, _u16le


@dataclass
class XPPenTabletReport:
    """Port of OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenTabletReport."""
    raw: bytes
    position: Tuple[int, int] = (0, 0)
    pressure: int = 0
    tilt: Tuple[int, int] = (0, 0)
    pen_buttons: List[bool] = field(default_factory=list)
    eraser: bool = False

    @classmethod
    def parse(cls, data: bytes) -> "XPPenTabletReport":
        return cls(
            raw=data,
            position=(_u16le(data, 2), _u16le(data, 4)),
            pressure=_u16le(data, 6),
            tilt=(_s8(data[8]), _s8(data[9])),
            pen_buttons=[_bit(data[1], 1), _bit(data[1], 2)],
            eraser=_bit(data[1], 3),
        )


@dataclass
class XPPenTabletOverflowReport:
    """Port of OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenTabletOverflowReport.

    24-bit X/Y position assembled from low ushort + high byte from tilt slots.
    """
    raw: bytes
    position: Tuple[int, int] = (0, 0)
    pressure: int = 0
    tilt: Tuple[int, int] = (0, 0)
    pen_buttons: List[bool] = field(default_factory=list)
    eraser: bool = False

    @classmethod
    def parse(cls, data: bytes) -> "XPPenTabletOverflowReport":
        x = _u16le(data, 2) | (data[10] << 16)
        y = _u16le(data, 4) | (data[11] << 16)
        return cls(
            raw=data,
            position=(x, y),
            pressure=_u16le(data, 6),
            tilt=(_s8(data[8]), _s8(data[9])),
            pen_buttons=[_bit(data[1], 1), _bit(data[1], 2)],
            eraser=_bit(data[1], 3),
        )


@dataclass
class XPPenAuxReport:
    """Port of OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenAuxReport."""
    raw: bytes
    aux_buttons: List[bool] = field(default_factory=list)
    analog_deltas: List[int] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes, aux_index: int = 2, wheel_index: int = 7) -> "XPPenAuxReport":
        buttons = (
            [_bit(data[aux_index], i) for i in range(8)]
            + [_bit(data[aux_index + 1], i) for i in range(8)]
            + [_bit(data[aux_index + 2], i) for i in range(4)]
        )
        w = data[wheel_index]
        deltas = [
            1 if _bit(w, 0) else (-1 if _bit(w, 1) else 0),
            1 if _bit(w, 4) else (-1 if _bit(w, 5) else 0),
        ]
        return cls(raw=data, aux_buttons=buttons, analog_deltas=deltas)


class XPPenReportParser:
    """Port of OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenReportParser."""

    def parse(self, data: bytes):
        if data[1] == 0xC0:
            return OutOfRangeReport(raw=data)
        if _bit(data[1], 4):
            return XPPenAuxReport.parse(data)
        if len(data) >= 12:
            return XPPenTabletOverflowReport.parse(data)
        if len(data) >= 10:
            return XPPenTabletReport.parse(data)
        return TabletReport.parse(data)
