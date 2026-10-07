"""Tests for tablet_client runtime diagnostics (blocked-device detection)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

import pytest

from sketchatone.tablet import tablet_client
from sketchatone.tablet.otd.config_loader import ConfigIndex
from sketchatone.tablet.tablet_client import (
    BlockedTablet,
    _parse_hid_id,
    find_blocked_tablets,
    wait_for_device,
)

from .conftest import make_config, make_identifier


def _index_with(vid: int, pid: int) -> ConfigIndex:
    cfg = make_config(identifiers=[make_identifier(vendor_id=vid, product_id=pid)])
    return ConfigIndex([cfg])


def _make_sysfs_hidraw(root: Path, name: str, vid: int, pid: int,
                       bus: int = 0x0003) -> None:
    """Create a fake /sys/class/hidraw/<name>/device/uevent entry."""
    dev_dir = root / name / "device"
    dev_dir.mkdir(parents=True)
    (dev_dir / "uevent").write_text(
        f"DRIVER=hid-generic\nHID_ID={bus:04X}:{vid:08X}:{pid:08X}\n",
        encoding="utf-8",
    )


class TestParseHidId:
    def test_parses_valid_line(self) -> None:
        assert _parse_hid_id("HID_ID=0003:0000256C:00000064\n") == (0x256C, 0x0064)

    def test_returns_none_when_missing(self) -> None:
        assert _parse_hid_id("DRIVER=hid-generic\n") is None

    def test_returns_none_on_malformed(self) -> None:
        assert _parse_hid_id("HID_ID=0003:not-hex:00000064") is None
        assert _parse_hid_id("HID_ID=0003:0000256C") is None


class TestFindBlockedTablets:
    def test_empty_when_no_hidraw_nodes(self, tmp_path: Path,
                                        monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(tablet_client, "HIDRAW_SYSFS_ROOT", str(tmp_path))
        assert find_blocked_tablets(_index_with(0x256C, 0x0064)) == []

    def test_empty_when_vid_pid_unknown(self, tmp_path: Path,
                                        monkeypatch: pytest.MonkeyPatch) -> None:
        _make_sysfs_hidraw(tmp_path, "hidraw0", 0xDEAD, 0xBEEF)
        monkeypatch.setattr(tablet_client, "HIDRAW_SYSFS_ROOT", str(tmp_path))
        monkeypatch.setattr(os, "access", lambda _p, _m: False)
        assert find_blocked_tablets(_index_with(0x256C, 0x0064)) == []

    def test_empty_when_node_is_readable(self, tmp_path: Path,
                                         monkeypatch: pytest.MonkeyPatch) -> None:
        _make_sysfs_hidraw(tmp_path, "hidraw0", 0x256C, 0x0064)
        monkeypatch.setattr(tablet_client, "HIDRAW_SYSFS_ROOT", str(tmp_path))
        monkeypatch.setattr(os, "access", lambda _p, _m: True)
        assert find_blocked_tablets(_index_with(0x256C, 0x0064)) == []

    def test_returns_entry_when_matched_but_blocked(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _make_sysfs_hidraw(tmp_path, "hidraw0", 0x256C, 0x0064)
        monkeypatch.setattr(tablet_client, "HIDRAW_SYSFS_ROOT", str(tmp_path))
        monkeypatch.setattr(os, "access", lambda _p, _m: False)
        blocked = find_blocked_tablets(_index_with(0x256C, 0x0064))
        assert blocked == [(0x256C, 0x0064, "/dev/hidraw0")]

    def test_deduplicates_repeated_vid_pid_path(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Two interfaces of the same tablet expose separate hidraw
        # nodes; each contributes its own entry (different node paths).
        _make_sysfs_hidraw(tmp_path, "hidraw0", 0x256C, 0x0064)
        _make_sysfs_hidraw(tmp_path, "hidraw1", 0x256C, 0x0064)
        monkeypatch.setattr(tablet_client, "HIDRAW_SYSFS_ROOT", str(tmp_path))
        monkeypatch.setattr(os, "access", lambda _p, _m: False)
        blocked = find_blocked_tablets(_index_with(0x256C, 0x0064))
        assert blocked == [
            (0x256C, 0x0064, "/dev/hidraw0"),
            (0x256C, 0x0064, "/dev/hidraw1"),
        ]


class TestWaitForDeviceBlockedNotification:
    def test_on_blocked_fires_once_before_client_appears(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        index = _index_with(0x256C, 0x0064)
        fake_client = object()
        discover_calls = {"n": 0}

        def fake_discover(**_kwargs: object) -> object:
            discover_calls["n"] += 1
            return None if discover_calls["n"] == 1 else fake_client

        blocked_entry: List[BlockedTablet] = [(0x256C, 0x0064, "/dev/hidraw0")]

        monkeypatch.setattr(tablet_client.TabletClient, "discover",
                            staticmethod(fake_discover))
        monkeypatch.setattr(tablet_client, "find_blocked_tablets",
                            lambda _idx: list(blocked_entry))
        monkeypatch.setattr(tablet_client.time, "sleep", lambda _s: None)

        blocked_calls: List[List[BlockedTablet]] = []
        waiting_calls = {"n": 0}

        def on_blocked(entries: List[BlockedTablet]) -> None:
            blocked_calls.append(entries)

        def on_waiting() -> None:
            waiting_calls["n"] += 1

        result = wait_for_device(
            interval_ms=1,
            config_index=index,
            on_waiting=on_waiting,
            on_blocked=on_blocked,
        )
        assert result is fake_client
        assert blocked_calls == [blocked_entry]
        assert waiting_calls["n"] == 1

    def test_on_blocked_not_called_when_no_blocked_devices(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_client = object()
        discover_calls = {"n": 0}

        def fake_discover(**_kwargs: object) -> object:
            discover_calls["n"] += 1
            return None if discover_calls["n"] == 1 else fake_client

        monkeypatch.setattr(tablet_client.TabletClient, "discover",
                            staticmethod(fake_discover))
        monkeypatch.setattr(tablet_client, "find_blocked_tablets", lambda _idx: [])
        monkeypatch.setattr(tablet_client.time, "sleep", lambda _s: None)

        blocked_calls: List[object] = []
        wait_for_device(
            interval_ms=1,
            config_index=_index_with(0x256C, 0x0064),
            on_blocked=lambda entries: blocked_calls.append(entries),
        )
        assert blocked_calls == []
