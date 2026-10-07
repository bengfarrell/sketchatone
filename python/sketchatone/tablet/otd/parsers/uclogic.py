"""UCLogic-family report parsers (used by Huion / Gaomon / etc.)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from ..reports import TiltTabletReport, _bit


@dataclass
class UCLogicAuxReport:
    """Port of OpenTabletDriver.Configurations.Parsers.UCLogic.UCLogicAuxReport.

    Maps 20 button bits across data[4]..data[6] (bits 0-3 of data[6]).
    """
    raw: bytes
    aux_buttons: List[bool] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes) -> "UCLogicAuxReport":
        buttons = [_bit(data[4], i) for i in range(8)] + \
                  [_bit(data[5], i) for i in range(8)] + \
                  [_bit(data[6], i) for i in range(4)]
        return cls(raw=data, aux_buttons=buttons)


class UCLogicTiltReportParser:
    """Port of OpenTabletDriver.Configurations.Parsers.UCLogic.UCLogicTiltReportParser."""

    def parse(self, data: bytes):
        if _bit(data[1], 6):
            return UCLogicAuxReport.parse(data)
        return TiltTabletReport.parse(data, invert_tilt_x=False, invert_tilt_y=True)
