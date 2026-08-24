"""Convert OTD report objects into the websocket event shape the visualizer consumes."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from ..otd.config_loader import TabletConfiguration
from ..otd.reports import (
    DeviceReport,
    OutOfRangeReport,
    TabletReport,
    TiltTabletReport,
)


@dataclass
class TabletEvent:
    """Normalized tablet event broadcast to clients.

    Coordinate ranges:
        x, y       0.0 .. 1.0 (origin top-left)
        pressure   0.0 .. 1.0
        tiltX, Y   -1.0 .. 1.0
        tiltXY     0.0 .. 1.0 (magnitude)
    """
    type: str = "tablet-data"
    timestamp: float = 0.0
    state: str = "none"
    x: float = 0.0
    y: float = 0.0
    pressure: float = 0.0
    tiltX: float = 0.0
    tiltY: float = 0.0
    tiltXY: float = 0.0
    primaryButtonPressed: bool = False
    secondaryButtonPressed: bool = False
    auxCodes: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "timestamp": self.timestamp,
            "state": self.state,
            "x": self.x,
            "y": self.y,
            "pressure": self.pressure,
            "tiltX": self.tiltX,
            "tiltY": self.tiltY,
            "tiltXY": self.tiltXY,
            "primaryButtonPressed": self.primaryButtonPressed,
            "secondaryButtonPressed": self.secondaryButtonPressed,
            "auxCodes": list(self.auxCodes),
        }


class EventAdapter:
    """Stateful adapter: combines successive tablet + aux reports into events."""

    def __init__(self, config: TabletConfiguration):
        self.config = config
        self._max_x = max(1, config.specifications.digitizer_max_x)
        self._max_y = max(1, config.specifications.digitizer_max_y)
        self._max_p = max(1, config.specifications.pen_max_pressure)
        self._aux_codes_by_slot: Dict[Tuple[bytes, int], List[int]] = {}
        self._in_range: bool = False

    def override_ranges(self,
                        max_x: Optional[int] = None,
                        max_y: Optional[int] = None,
                        max_pressure: Optional[int] = None) -> None:
        """Replace the normalization denominators (e.g. with values read from
        the device's HID report descriptor when the OTD config's vendor-mode
        values don't match the interface we actually opened)."""
        if max_x:
            self._max_x = max(1, int(max_x))
        if max_y:
            self._max_y = max(1, int(max_y))
        if max_pressure:
            self._max_p = max(1, int(max_pressure))

    @staticmethod
    def _now_ms() -> float:
        return time.time() * 1000.0

    def _current_aux_codes(self) -> List[int]:
        seen: set = set()
        out: List[int] = []
        for codes in self._aux_codes_by_slot.values():
            for c in codes:
                if c not in seen:
                    seen.add(c)
                    out.append(c)
        return out

    def update_aux_codes(self, path: bytes, report_id: int, codes: List[int]) -> bool:
        """Record the active scan codes for one (path, report_id) slot.

        Composite aux interfaces multiplex several top-level collections
        over a single IOHIDDevice; keying state per report ID prevents a
        release on one collection from clobbering held buttons on
        another. Returns True if the union across all slots changed.
        """
        prev = self._current_aux_codes()
        slot = (path, report_id)
        if codes:
            self._aux_codes_by_slot[slot] = list(codes)
        else:
            self._aux_codes_by_slot.pop(slot, None)
        return self._current_aux_codes() != prev

    def _empty_event(self) -> TabletEvent:
        ev = TabletEvent(timestamp=self._now_ms())
        ev.auxCodes = self._current_aux_codes()
        return ev

    def adapt(self, report: Any) -> Optional[TabletEvent]:
        """Translate a parsed OTD report into a TabletEvent, or None to skip."""
        if isinstance(report, OutOfRangeReport):
            self._in_range = False
            return self._empty_event()

        if isinstance(report, (TabletReport, TiltTabletReport)) or hasattr(report, "position"):
            self._in_range = True
            x_raw, y_raw = report.position
            pressure_raw = getattr(report, "pressure", 0)
            ev = self._empty_event()
            ev.x = min(1.0, max(0.0, x_raw / self._max_x))
            ev.y = min(1.0, max(0.0, y_raw / self._max_y))
            ev.pressure = min(1.0, max(0.0, pressure_raw / self._max_p))
            pen_buttons = list(getattr(report, "pen_buttons", []) or [])
            ev.primaryButtonPressed = len(pen_buttons) > 0 and pen_buttons[0]
            ev.secondaryButtonPressed = len(pen_buttons) > 1 and pen_buttons[1]
            if hasattr(report, "tilt"):
                tx, ty = report.tilt
                ev.tiltX = max(-1.0, min(1.0, tx / 127.0))
                ev.tiltY = max(-1.0, min(1.0, ty / 127.0))
                ev.tiltXY = min(1.0, math.hypot(ev.tiltX, ev.tiltY))
            ev.state = "contact" if ev.pressure > 0 else "hover"
            return ev

        if isinstance(report, DeviceReport):
            return None

        return None
