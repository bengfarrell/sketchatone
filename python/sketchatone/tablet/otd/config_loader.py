"""Loader and matcher for vendored OpenTabletDriver configurations."""

from __future__ import annotations

import base64
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


# Bundled alongside the module so the JSONs travel with any install of the
# ``sketchatone`` package (source checkout, wheel, or .deb) without the
# packaging scripts needing to know about them.
CONFIGS_ROOT = Path(__file__).resolve().parent / "configs"


@dataclass(frozen=True)
class DigitizerIdentifier:
    """One entry from a config's ``DigitizerIdentifiers`` array."""
    vendor_id: int
    product_id: int
    input_report_length: Optional[int]
    output_report_length: Optional[int]
    report_parser: str
    device_strings: Dict[str, str] = field(default_factory=dict)
    initialization_strings: Tuple[int, ...] = ()
    feature_init_reports: Tuple[bytes, ...] = ()
    output_init_reports: Tuple[bytes, ...] = ()


@dataclass(frozen=True)
class TabletSpecifications:
    """Subset of OTD Specifications we actually use for normalization."""
    digitizer_width_mm: float = 0.0
    digitizer_height_mm: float = 0.0
    digitizer_max_x: int = 0
    digitizer_max_y: int = 0
    pen_max_pressure: int = 0
    pen_button_count: int = 0
    aux_button_count: int = 0


@dataclass
class TabletConfiguration:
    """One vendored OTD configuration file."""
    name: str
    source_path: Path
    specifications: TabletSpecifications
    digitizer_identifiers: List[DigitizerIdentifier]
    libinput_override: bool = False

    @property
    def manufacturer(self) -> str:
        return self.name.split(" ", 1)[0]

    @property
    def model(self) -> str:
        parts = self.name.split(" ", 1)
        return parts[1] if len(parts) > 1 else self.name


def _parse_specs(raw: dict) -> TabletSpecifications:
    digi = raw.get("Digitizer") or {}
    pen = raw.get("Pen") or {}
    aux = raw.get("AuxiliaryButtons") or {}
    return TabletSpecifications(
        digitizer_width_mm=float(digi.get("Width", 0) or 0),
        digitizer_height_mm=float(digi.get("Height", 0) or 0),
        digitizer_max_x=int(digi.get("MaxX", 0) or 0),
        digitizer_max_y=int(digi.get("MaxY", 0) or 0),
        pen_max_pressure=int(pen.get("MaxPressure", 0) or 0),
        pen_button_count=int(pen.get("ButtonCount", 0) or 0),
        aux_button_count=int(aux.get("ButtonCount", 0) or 0),
    )


def _decode_report(value) -> bytes:
    """OTD serializes byte arrays in JSON as base64 strings."""
    if isinstance(value, str):
        return base64.b64decode(value)
    if isinstance(value, list):
        return bytes(int(b) & 0xFF for b in value)
    return b""


def _parse_identifier(raw: dict) -> DigitizerIdentifier:
    device_strings = raw.get("DeviceStrings") or {}
    init_strings = tuple(int(i) & 0xFF for i in (raw.get("InitializationStrings") or []))
    feature_init = tuple(_decode_report(r) for r in (raw.get("FeatureInitReport") or []))
    output_init = tuple(_decode_report(r) for r in (raw.get("OutputInitReport") or []))
    return DigitizerIdentifier(
        vendor_id=int(raw["VendorID"]),
        product_id=int(raw["ProductID"]),
        input_report_length=raw.get("InputReportLength"),
        output_report_length=raw.get("OutputReportLength"),
        report_parser=raw["ReportParser"],
        device_strings={str(k): str(v) for k, v in device_strings.items()},
        initialization_strings=init_strings,
        feature_init_reports=tuple(r for r in feature_init if r),
        output_init_reports=tuple(r for r in output_init if r),
    )


def load_config_file(path: Path) -> TabletConfiguration:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return TabletConfiguration(
        name=raw["Name"],
        source_path=path,
        specifications=_parse_specs(raw.get("Specifications") or {}),
        digitizer_identifiers=[_parse_identifier(d) for d in raw.get("DigitizerIdentifiers", [])],
        libinput_override=str((raw.get("Attributes") or {}).get("libinputoverride", "0")) != "0",
    )


def load_all_configs(root: Optional[Path] = None) -> List[TabletConfiguration]:
    base = root or CONFIGS_ROOT
    configs: List[TabletConfiguration] = []
    skipped: List[Tuple[Path, str]] = []
    if not base.is_dir():
        print(
            f"[OTD] Warning: tablet config directory not found: {base}",
            file=sys.stderr,
        )
        return configs
    for path in sorted(base.rglob("*.json")):
        try:
            configs.append(load_config_file(path))
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            skipped.append((path, type(e).__name__))
            continue
    if not configs:
        print(
            f"[OTD] Warning: no tablet configs loaded from {base} "
            f"({len(skipped)} file(s) skipped)",
            file=sys.stderr,
        )
    return configs


@dataclass
class ConfigMatch:
    """A configuration matched against a connected HID device."""
    config: TabletConfiguration
    identifier: DigitizerIdentifier


class ConfigIndex:
    """In-memory index for fast lookup by (VID, PID) and optionally report length."""

    def __init__(self, configs: Iterable[TabletConfiguration]):
        self._by_vid_pid: Dict[Tuple[int, int], List[ConfigMatch]] = {}
        for cfg in configs:
            for ident in cfg.digitizer_identifiers:
                self._by_vid_pid.setdefault((ident.vendor_id, ident.product_id), []).append(
                    ConfigMatch(config=cfg, identifier=ident)
                )

    @classmethod
    def from_vendored(cls) -> "ConfigIndex":
        return cls(load_all_configs())

    def find(self, vendor_id: int, product_id: int,
             input_report_length: Optional[int] = None) -> List[ConfigMatch]:
        candidates = list(self._by_vid_pid.get((vendor_id, product_id), []))
        if input_report_length is not None:
            narrowed = [
                m for m in candidates
                if m.identifier.input_report_length in (None, input_report_length)
            ]
            if narrowed:
                return narrowed
        return candidates

    def all_vid_pid_pairs(self) -> List[Tuple[int, int]]:
        return sorted(self._by_vid_pid)
