"""Generic report parsers (port of OpenTabletDriver.Plugin.Tablet)."""

from __future__ import annotations

from typing import Optional

from ..reports import (
    AuxReport,
    OutOfRangeReport,
    StandardDigitizerReport,
    TabletReport,
    TiltTabletReport,
)


class TabletReportParser:
    """Port of OpenTabletDriver.Plugin.Tablet.TabletReportParser."""

    def parse(self, data: bytes) -> TabletReport:
        return TabletReport.parse(data)


class TiltTabletReportParser:
    """Port of OpenTabletDriver.Plugin.Tablet.TiltTabletReportParser."""

    def parse(self, data: bytes) -> TiltTabletReport:
        return TiltTabletReport.parse(data)


class AuxReportParser:
    """Port of OpenTabletDriver.Plugin.Tablet.AuxReportParser."""

    def parse(self, data: bytes) -> AuxReport:
        return AuxReport.parse(data)


class StandardDigitizerReportParser:
    """Parses standard HID Digitizer pen reports (UsagePage 0x0D).

    Used when we open the tablet's OS-compatibility digitizer interface
    instead of its vendor interface (which would require firmware-specific
    initialization that we can't always perform on macOS).

    Returns ``None`` for packets that don't look like pen reports so the
    service can quietly ignore button/touch frames muxed onto the same
    interface.
    """

    def parse(self, data: bytes) -> Optional[object]:
        if len(data) < 8:
            return None
        status = data[1]
        # Mirror OTD's InspiroyReportParser dispatch: status==0 is the
        # explicit pen-left-proximity frame; only bit 7 frames are pen
        # samples. Other status bytes (aux/wheel) are ignored here.
        if status == 0x00:
            return OutOfRangeReport(raw=data)
        if not (status & 0x80):
            return None
        return StandardDigitizerReport.parse(data)
