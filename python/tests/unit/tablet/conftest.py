"""Shared fixtures and helpers for the tablet test suite."""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import pytest

from sketchatone.tablet.otd.config_loader import (
    DigitizerIdentifier,
    TabletConfiguration,
    TabletSpecifications,
)
from sketchatone.tablet.server.hid_device import DiscoveredDevice
from sketchatone.tablet.otd.config_loader import ConfigMatch


def make_config(
    *,
    name: str = "Test Tablet",
    max_x: int = 1000,
    max_y: int = 500,
    max_pressure: int = 8192,
    identifiers: Optional[List[DigitizerIdentifier]] = None,
) -> TabletConfiguration:
    return TabletConfiguration(
        name=name,
        source_path=Path("/dev/null"),
        specifications=TabletSpecifications(
            digitizer_max_x=max_x,
            digitizer_max_y=max_y,
            pen_max_pressure=max_pressure,
        ),
        digitizer_identifiers=identifiers or [],
    )


def make_identifier(
    *,
    vendor_id: int = 0x256C,
    product_id: int = 0x006E,
    input_report_length: Optional[int] = 12,
    parser: str = "OpenTabletDriver.Plugin.Tablet.TabletReportParser",
) -> DigitizerIdentifier:
    return DigitizerIdentifier(
        vendor_id=vendor_id,
        product_id=product_id,
        input_report_length=input_report_length,
        output_report_length=None,
        report_parser=parser,
    )


def make_device(
    *,
    vendor_id: int = 0x256C,
    product_id: int = 0x006E,
    path: bytes = b"DevA",
    interface_number: int = 0,
    usage_page: int = 0x0D,
    usage: int = 0x02,
    match: Optional[ConfigMatch] = None,
) -> DiscoveredDevice:
    cfg = make_config(identifiers=[make_identifier(vendor_id=vendor_id,
                                                   product_id=product_id)])
    return DiscoveredDevice(
        vendor_id=vendor_id,
        product_id=product_id,
        path=path,
        interface_number=interface_number,
        usage_page=usage_page,
        usage=usage,
        product_string="Test",
        manufacturer_string="Test Co",
        serial_number="",
        input_report_length=None,
        match=match or ConfigMatch(config=cfg, identifier=cfg.digitizer_identifiers[0]),
    )


@pytest.fixture
def basic_config() -> TabletConfiguration:
    return make_config()
