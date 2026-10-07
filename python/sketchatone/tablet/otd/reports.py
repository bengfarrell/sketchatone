"""Python ports of OpenTabletDriver's IDeviceReport hierarchy.

All values are kept in the tablet's native units; normalization happens in the
event adapter layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple


def _u16le(data: bytes, offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8)


def _s8(b: int) -> int:
    return b - 256 if b >= 128 else b


def _bit(b: int, n: int) -> bool:
    return (b >> n) & 1 == 1


@dataclass
class DeviceReport:
    """Base report, returned when no more specific type applies."""
    raw: bytes


@dataclass
class OutOfRangeReport:
    """Pen left proximity / went out of range."""
    raw: bytes


@dataclass
class TabletReport:
    """Generic absolute-position tablet report (matches OTD's TabletReport)."""
    raw: bytes
    position: Tuple[int, int] = (0, 0)
    pressure: int = 0
    pen_buttons: List[bool] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes) -> "TabletReport":
        return cls(
            raw=data,
            position=(_u16le(data, 2), _u16le(data, 4)),
            pressure=_u16le(data, 6),
            pen_buttons=[_bit(data[1], 1), _bit(data[1], 2), _bit(data[1], 3)],
        )


@dataclass
class TiltTabletReport:
    """Absolute-position report with tilt (matches OTD's TiltTabletReport)."""
    raw: bytes
    position: Tuple[int, int] = (0, 0)
    pressure: int = 0
    tilt: Tuple[int, int] = (0, 0)
    pen_buttons: List[bool] = field(default_factory=list)
    eraser: bool = False

    @classmethod
    def parse(cls, data: bytes, invert_tilt_x: bool = False, invert_tilt_y: bool = False) -> "TiltTabletReport":
        sx = -1 if invert_tilt_x else 1
        sy = -1 if invert_tilt_y else 1
        return cls(
            raw=data,
            position=(_u16le(data, 2), _u16le(data, 4)),
            pressure=_u16le(data, 6),
            tilt=(sx * _s8(data[10]), sy * _s8(data[11])),
            pen_buttons=[_bit(data[1], 1), _bit(data[1], 2), _bit(data[1], 3)],
        )


@dataclass
class StandardDigitizerReport:
    """Pen report from a tablet's standard HID digitizer interface.

    Layout observed on Huion, XP-Pen and similar tablets when reading
    their OS-compatibility (UsagePage 0x0D) interface without sending
    the vendor mode-switch init:

        byte 0     report id
        byte 1     status bits
                     bit 0  tip switch (contact)
                     bit 1  barrel switch
                     bit 2  barrel switch 2 / eraser
                     bit 7  in range
        bytes 2-3  X (little-endian u16)
        bytes 4-5  Y (little-endian u16)
        bytes 6-7  pressure (little-endian u16)
        bytes 8-9  tilt X / tilt Y (signed bytes, optional)

    Mirrors how OTD's InspiroyReportParser interprets byte 1 for
    in-range detection.
    """
    raw: bytes
    position: Tuple[int, int] = (0, 0)
    pressure: int = 0
    tilt: Tuple[int, int] = (0, 0)
    pen_buttons: List[bool] = field(default_factory=list)
    eraser: bool = False
    in_range: bool = True

    @classmethod
    def parse(cls, data: bytes, invert_tilt_y: bool = True) -> "StandardDigitizerReport":
        status = data[1]
        tilt = (0, 0)
        if len(data) >= 10:
            sy = -1 if invert_tilt_y else 1
            tilt = (_s8(data[8]), sy * _s8(data[9]))
        return cls(
            raw=data,
            position=(_u16le(data, 2), _u16le(data, 4)),
            pressure=_u16le(data, 6),
            tilt=tilt,
            pen_buttons=[_bit(status, 1), _bit(status, 2)],
            eraser=_bit(status, 2),
            in_range=_bit(status, 7),
        )


@dataclass
class AuxReport:
    """Generic auxiliary-button report (matches OTD's AuxReport)."""
    raw: bytes
    aux_buttons: List[bool] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes) -> "AuxReport":
        b = data[3]
        return cls(raw=data, aux_buttons=[_bit(b, i) for i in range(4)])
