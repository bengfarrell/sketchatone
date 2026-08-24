"""Report parser registry.

OTD configurations identify their parser via a fully-qualified C# class name
(e.g. ``OpenTabletDriver.Plugin.Tablet.TabletReportParser``). The registry maps
those names to the Python implementations in this package.
"""

from __future__ import annotations

from typing import Callable, Dict

from .generic import (
    AuxReportParser,
    StandardDigitizerReportParser,
    TabletReportParser,
    TiltTabletReportParser,
)
from .uclogic import UCLogicTiltReportParser
from .huion import HuionTiltReportParser, InspiroyReportParser
from .xp_pen import XPPenReportParser


ParserFactory = Callable[[], object]

_REGISTRY: Dict[str, ParserFactory] = {
    "OpenTabletDriver.Plugin.Tablet.TabletReportParser": TabletReportParser,
    "OpenTabletDriver.Plugin.Tablet.TiltTabletReportParser": TiltTabletReportParser,
    "OpenTabletDriver.Plugin.Tablet.AuxReportParser": AuxReportParser,
    "OpenTabletDriver.Configurations.Parsers.UCLogic.UCLogicTiltReportParser": UCLogicTiltReportParser,
    "OpenTabletDriver.Configurations.Parsers.Huion.HuionTiltReportParser": HuionTiltReportParser,
    "OpenTabletDriver.Configurations.Parsers.Huion.InspiroyReportParser": InspiroyReportParser,
    "OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenReportParser": XPPenReportParser,
}


class UnknownParserError(LookupError):
    """Raised when a config references a parser class not in the registry."""


def get_parser(name: str):
    """Instantiate a parser by its fully-qualified OTD class name."""
    try:
        factory = _REGISTRY[name]
    except KeyError as exc:
        raise UnknownParserError(
            f"No Python implementation registered for OTD parser {name!r}."
        ) from exc
    return factory()


def known_parsers():
    """Return the list of OTD parser class names currently implemented."""
    return sorted(_REGISTRY)


__all__ = [
    "AuxReportParser",
    "HuionTiltReportParser",
    "InspiroyReportParser",
    "StandardDigitizerReportParser",
    "TabletReportParser",
    "TiltTabletReportParser",
    "UCLogicTiltReportParser",
    "UnknownParserError",
    "XPPenReportParser",
    "get_parser",
    "known_parsers",
]
