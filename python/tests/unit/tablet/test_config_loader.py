"""Tests for OTD configuration loading and indexing."""

from __future__ import annotations

import base64
import json
from pathlib import Path

from sketchatone.tablet.otd.config_loader import (
    ConfigIndex,
    TabletConfiguration,
    load_all_configs,
    load_config_file,
)


def _write_config(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _sample_payload(*,
                    name: str = "Maker Test 100",
                    vid: int = 0x256C,
                    pid: int = 0x006E,
                    irl: int = 12,
                    parser: str = "OpenTabletDriver.Plugin.Tablet.TabletReportParser") -> dict:
    return {
        "Name": name,
        "Attributes": {"libinputoverride": "1"},
        "DigitizerIdentifiers": [
            {
                "VendorID": vid,
                "ProductID": pid,
                "InputReportLength": irl,
                "OutputReportLength": 64,
                "ReportParser": parser,
                "DeviceStrings": {"1": "Tablet"},
                "InitializationStrings": [200, 201],
                "FeatureInitReport": [base64.b64encode(b"\x02\x03").decode("ascii")],
                "OutputInitReport": [[2, 0xB0, 0x04]],
            }
        ],
        "Specifications": {
            "Digitizer": {"Width": 152.4, "Height": 95.25,
                          "MaxX": 15200, "MaxY": 9500},
            "Pen": {"MaxPressure": 8191, "ButtonCount": 2},
            "AuxiliaryButtons": {"ButtonCount": 8},
        },
    }


def test_load_config_file_parses_specs_and_identifier(tmp_path: Path) -> None:
    p = _write_config(tmp_path / "tablet.json", _sample_payload())
    cfg = load_config_file(p)
    assert isinstance(cfg, TabletConfiguration)
    assert cfg.name == "Maker Test 100"
    assert cfg.manufacturer == "Maker"
    assert cfg.model == "Test 100"
    assert cfg.libinput_override is True
    assert cfg.specifications.digitizer_max_x == 15200
    assert cfg.specifications.pen_max_pressure == 8191
    assert cfg.specifications.aux_button_count == 8

    [ident] = cfg.digitizer_identifiers
    assert ident.vendor_id == 0x256C
    assert ident.product_id == 0x006E
    assert ident.input_report_length == 12
    assert ident.initialization_strings == (200, 201)
    # Base64 string survives round-trip into bytes.
    assert ident.feature_init_reports == (b"\x02\x03",)
    # List-of-ints decoded byte-by-byte.
    assert ident.output_init_reports == (bytes([2, 0xB0, 0x04]),)


def test_load_config_handles_missing_optional_sections(tmp_path: Path) -> None:
    payload = {
        "Name": "Bare Tablet",
        "DigitizerIdentifiers": [{
            "VendorID": 1, "ProductID": 2,
            "ReportParser": "OpenTabletDriver.Plugin.Tablet.TabletReportParser",
        }],
    }
    cfg = load_config_file(_write_config(tmp_path / "bare.json", payload))
    assert cfg.specifications.digitizer_max_x == 0
    assert cfg.libinput_override is False
    assert cfg.digitizer_identifiers[0].input_report_length is None
    assert cfg.digitizer_identifiers[0].initialization_strings == ()


def test_load_all_configs_skips_invalid_files(tmp_path: Path) -> None:
    _write_config(tmp_path / "ok.json", _sample_payload())
    (tmp_path / "broken.json").write_text("{not valid json", encoding="utf-8")
    (tmp_path / "missing.json").write_text(json.dumps({"foo": "bar"}),
                                           encoding="utf-8")
    cfgs = load_all_configs(tmp_path)
    assert len(cfgs) == 1
    assert cfgs[0].name == "Maker Test 100"


def test_config_index_finds_by_vid_pid(tmp_path: Path) -> None:
    cfg = load_config_file(_write_config(tmp_path / "t.json", _sample_payload()))
    index = ConfigIndex([cfg])
    matches = index.find(0x256C, 0x006E)
    assert len(matches) == 1
    assert matches[0].config is cfg
    assert index.find(0xDEAD, 0xBEEF) == []
    assert index.all_vid_pid_pairs() == [(0x256C, 0x006E)]


def test_config_index_narrows_by_input_report_length(tmp_path: Path) -> None:
    cfg_a = load_config_file(_write_config(
        tmp_path / "a.json",
        _sample_payload(name="A One", irl=12)))
    cfg_b = load_config_file(_write_config(
        tmp_path / "b.json",
        _sample_payload(name="B Two", irl=64)))
    index = ConfigIndex([cfg_a, cfg_b])

    only_12 = index.find(0x256C, 0x006E, input_report_length=12)
    assert [m.config.name for m in only_12] == ["A One"]

    only_64 = index.find(0x256C, 0x006E, input_report_length=64)
    assert [m.config.name for m in only_64] == ["B Two"]


def test_config_index_falls_back_when_no_irl_matches(tmp_path: Path) -> None:
    cfg = load_config_file(_write_config(tmp_path / "t.json", _sample_payload(irl=12)))
    index = ConfigIndex([cfg])
    # 99 doesn't match 12 and identifier IRL is not None -> narrowed is empty
    # -> fall back to all candidates rather than returning nothing.
    matches = index.find(0x256C, 0x006E, input_report_length=99)
    assert len(matches) == 1


def test_config_index_keeps_identifiers_with_null_report_length(tmp_path: Path) -> None:
    payload = _sample_payload()
    payload["DigitizerIdentifiers"][0]["InputReportLength"] = None
    cfg = load_config_file(_write_config(tmp_path / "t.json", payload))
    index = ConfigIndex([cfg])
    matches = index.find(0x256C, 0x006E, input_report_length=64)
    assert len(matches) == 1


def test_vendored_configs_are_bundled_with_package() -> None:
    # Regression guard: the OTD JSONs live next to the module so they
    # travel with any install method (source, wheel, .deb). If
    # CONFIGS_ROOT is ever repointed or the configs stop shipping,
    # ConfigIndex.from_vendored() silently returns an empty set and
    # every keyboard-listener-classified tablet on Linux gets misrouted
    # as a keyboard. Assert at least one well-known tablet is present.
    pairs = set(ConfigIndex.from_vendored().all_vid_pid_pairs())
    assert pairs, "no vendored tablet configs loaded (bundling regression)"
    # Huion H951P — configs/Huion/H951P.json, VID 9580 (0x256C), PID 103 (0x0067).
    assert (9580, 103) in pairs, (
        f"Huion H951P missing from vendored index ({len(pairs)} tablets loaded)"
    )
