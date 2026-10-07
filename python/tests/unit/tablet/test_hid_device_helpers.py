"""Tests for the device-list helper functions in server.hid_device."""

from __future__ import annotations

from sketchatone.tablet.otd.config_loader import ConfigMatch
from sketchatone.tablet.server.hid_device import (
    is_standard_digitizer,
    pick_aux_interfaces,
    pick_best_match,
    pick_digitizer_interface,
)

from .conftest import make_config, make_device, make_identifier


def _match(name: str) -> ConfigMatch:
    cfg = make_config(name=name, identifiers=[make_identifier()])
    return ConfigMatch(config=cfg, identifier=cfg.digitizer_identifiers[0])


def test_is_standard_digitizer_only_for_usage_page_0d() -> None:
    pen = make_device(usage_page=0x0D)
    aux = make_device(usage_page=0x01)
    assert is_standard_digitizer(pen) is True
    assert is_standard_digitizer(aux) is False


def test_pick_digitizer_interface_prefers_standard_digitizer() -> None:
    pen = make_device(path=b"pen", interface_number=1, usage_page=0x0D)
    vendor = make_device(path=b"vendor", interface_number=0, usage_page=0xFF0A)
    pick = pick_digitizer_interface([vendor, pen])
    assert pick is pen


def test_pick_digitizer_interface_falls_back_to_highest_usage_page() -> None:
    a = make_device(path=b"a", interface_number=0, usage_page=0xFF00)
    b = make_device(path=b"b", interface_number=1, usage_page=0xFF0A)
    pick = pick_digitizer_interface([a, b])
    assert pick is b


def test_pick_digitizer_interface_returns_none_for_empty() -> None:
    assert pick_digitizer_interface([]) is None


def test_pick_aux_interfaces_excludes_pen_and_dedupes_paths() -> None:
    pen = make_device(path=b"pen", interface_number=0, usage_page=0x0D)
    kb_a = make_device(path=b"aux", interface_number=1, usage_page=0x01)
    consumer_a = make_device(path=b"aux", interface_number=1, usage_page=0x0C)
    consumer_b = make_device(path=b"aux2", interface_number=2, usage_page=0x0C)
    out = pick_aux_interfaces([pen, kb_a, consumer_a, consumer_b])
    paths = [d.path for d in out]
    assert b"pen" not in paths
    # The (path=aux) pair shares a path, so only one entry survives.
    assert paths.count(b"aux") == 1
    assert b"aux2" in paths


def test_pick_aux_interfaces_skips_aux_on_same_iface_as_pen() -> None:
    # An aux collection that shares an interface number with the pen is
    # treated as part of the pen device and excluded.
    pen = make_device(path=b"pen", interface_number=0, usage_page=0x0D)
    aux_on_pen = make_device(path=b"pen-aux", interface_number=0, usage_page=0x01)
    aux_separate = make_device(path=b"aux", interface_number=2, usage_page=0x01)
    out = pick_aux_interfaces([pen, aux_on_pen, aux_separate])
    assert [d.path for d in out] == [b"aux"]


def test_pick_aux_interfaces_ignores_non_aux_usage_pages() -> None:
    pen = make_device(path=b"pen", interface_number=0, usage_page=0x0D)
    other = make_device(path=b"other", interface_number=3, usage_page=0xFF00)
    assert pick_aux_interfaces([pen, other]) == []


def test_pick_aux_interfaces_returns_keyboard_and_consumer_pages() -> None:
    # Both platforms use the same hidraw path so express-key IDs match.
    # On Linux KeyboardListener skips tablet-VID/PID evdev nodes to
    # avoid double-firing with this reader.
    pen = make_device(path=b"pen", interface_number=0, usage_page=0x0D)
    kb = make_device(path=b"kb", interface_number=1, usage_page=0x01, usage=0x06)
    consumer = make_device(path=b"cons", interface_number=2, usage_page=0x0C, usage=0x01)
    out = pick_aux_interfaces([pen, kb, consumer])
    assert [d.path for d in out] == [b"kb", b"cons"]


def test_pick_best_match_prefers_manufacturer_match() -> None:
    artisul = _match("Artisul A1201")
    gaomon = _match("Gaomon S630")
    huion = _match("Huion H640P")
    picked = pick_best_match([artisul, gaomon, huion], "Huion Tablet_H640P", "HUION")
    assert picked.config.name == "Huion H640P"


def test_pick_best_match_falls_back_to_model_substring() -> None:
    artisul = _match("Artisul A1201")
    huion = _match("Huion H640P")
    picked = pick_best_match([artisul, huion], "Tablet H640P", "")
    assert picked.config.name == "Huion H640P"


def test_pick_best_match_returns_first_when_no_signal() -> None:
    artisul = _match("Artisul A1201")
    huion = _match("Huion H640P")
    picked = pick_best_match([artisul, huion], "Unknown Tablet", "Generic")
    assert picked.config.name == "Artisul A1201"


def test_pick_best_match_is_case_insensitive() -> None:
    artisul = _match("Artisul A1201")
    huion = _match("Huion H640P")
    picked = pick_best_match([artisul, huion], "anything", "huion")
    assert picked.config.name == "Huion H640P"
