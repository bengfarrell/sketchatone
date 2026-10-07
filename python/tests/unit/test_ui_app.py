"""
Tests for helpers in ``sketchatone.ui.app`` that are safe to exercise
without booting the Kivy event loop.
"""

from __future__ import annotations

from sketchatone.ui import app as app_mod
from sketchatone.ui.app import _ws_host


class TestWsHost:
    """
    Guards the status-bar URL host so the label shown on the Pi's screen
    stays useful for LAN clients (mDNS-resolvable) and never regresses
    back to ``localhost``.
    """

    def test_appends_local_on_linux(self, monkeypatch):
        monkeypatch.setattr(app_mod.socket, 'gethostname', lambda: 'raspberrypi')
        monkeypatch.setattr(app_mod.sys, 'platform', 'linux')
        assert _ws_host() == 'raspberrypi.local'

    def test_preserves_existing_local_suffix_on_linux(self, monkeypatch):
        monkeypatch.setattr(app_mod.socket, 'gethostname', lambda: 'raspberrypi.local')
        monkeypatch.setattr(app_mod.sys, 'platform', 'linux')
        assert _ws_host() == 'raspberrypi.local'

    def test_no_suffix_on_macos(self, monkeypatch):
        # macOS's ``gethostname()`` typically already returns a ``.local``
        # name; the helper must not double-append and must not add
        # ``.local`` when the platform isn't Linux.
        monkeypatch.setattr(app_mod.socket, 'gethostname', lambda: 'my-mac')
        monkeypatch.setattr(app_mod.sys, 'platform', 'darwin')
        assert _ws_host() == 'my-mac'

    def test_falls_back_to_localhost_on_empty_hostname(self, monkeypatch):
        monkeypatch.setattr(app_mod.socket, 'gethostname', lambda: '')
        monkeypatch.setattr(app_mod.sys, 'platform', 'linux')
        assert _ws_host() == 'localhost'

    def test_falls_back_to_localhost_on_exception(self, monkeypatch):
        def _boom() -> str:
            raise OSError('nope')
        monkeypatch.setattr(app_mod.socket, 'gethostname', _boom)
        monkeypatch.setattr(app_mod.sys, 'platform', 'linux')
        assert _ws_host() == 'localhost'
