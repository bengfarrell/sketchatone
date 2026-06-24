"""
Tests for the Sketchatone UI CLI bootstrap (sketchatone.cli.ui).

These tests guard the CLI surface and the lazy-import boundary around
Kivy: the module must import cleanly without Kivy installed, and the
argument parser must accept the documented flags. They do not launch
the Kivy event loop.
"""

import os
import subprocess
import sys

import pytest

from sketchatone.cli import ui as ui_cli


class TestUICliImport:
    """Module-level import must not require Kivy."""

    def test_module_imports_without_kivy(self):
        assert hasattr(ui_cli, 'main')
        assert hasattr(ui_cli, 'build_arg_parser')
        assert hasattr(ui_cli, 'run_app')


class TestUICliArgParser:
    """Argument parser exposes the stable CLI surface."""

    def test_defaults(self):
        args = ui_cli.build_arg_parser().parse_args([])
        assert args.config is None
        assert args.strummer_config is None
        assert args.enable_ws is False
        assert args.ws_port == 8081
        assert args.throttle == 150
        assert args.poll == 2000
        assert args.dev is False
        assert args.fullscreen is False
        assert args.dry_run is False
        assert args.hot_reload is False

    def test_poll_override(self):
        args = ui_cli.build_arg_parser().parse_args(['--poll', '500'])
        assert args.poll == 500

    def test_dev_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['--dev'])
        assert args.dev is True

    def test_short_config_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['-c', '/tmp/x.json'])
        assert args.config == '/tmp/x.json'

    def test_long_config_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['--config', '/tmp/x.json'])
        assert args.config == '/tmp/x.json'

    def test_short_strummer_config_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['-s', '/tmp/cfg.json'])
        assert args.strummer_config == '/tmp/cfg.json'
        assert args.config is None

    def test_long_strummer_config_flag(self):
        args = ui_cli.build_arg_parser().parse_args(
            ['--strummer-config', '/tmp/cfg.json'])
        assert args.strummer_config == '/tmp/cfg.json'

    def test_config_and_strummer_config_are_independent(self):
        args = ui_cli.build_arg_parser().parse_args([
            '-c', '/devices/huion.json',
            '-s', '/configs/my.json',
        ])
        assert args.config == '/devices/huion.json'
        assert args.strummer_config == '/configs/my.json'

    def test_ws_port_override(self):
        args = ui_cli.build_arg_parser().parse_args(['--ws-port', '9000'])
        assert args.ws_port == 9000
        # ws_port is only honoured when --enable-ws is passed.
        assert args.enable_ws is False

    def test_enable_ws_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['--enable-ws'])
        assert args.enable_ws is True

    def test_throttle_override(self):
        args = ui_cli.build_arg_parser().parse_args(['--throttle', '50'])
        assert args.throttle == 50

    def test_fullscreen_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['--fullscreen'])
        assert args.fullscreen is True

    def test_hot_reload_flag(self):
        args = ui_cli.build_arg_parser().parse_args(['--hot-reload'])
        assert args.hot_reload is True


class TestResolveStrummerConfig:
    """`-s` resolves relative paths against cwd, then the repo root."""

    def test_none_passes_through(self):
        assert ui_cli._resolve_strummer_config(None) is None

    def test_absolute_existing_path_returns_as_is(self, tmp_path):
        target = tmp_path / 'cfg.json'
        target.write_text('{}')
        resolved = ui_cli._resolve_strummer_config(str(target))
        assert resolved == str(target)

    def test_relative_path_resolves_against_cwd(self, tmp_path, monkeypatch):
        (tmp_path / 'cfg.json').write_text('{}')
        monkeypatch.chdir(tmp_path)
        resolved = ui_cli._resolve_strummer_config('cfg.json')
        assert resolved == str((tmp_path / 'cfg.json').resolve())

    def test_relative_path_falls_back_to_repo_root(self, monkeypatch, tmp_path):
        # cwd has no match; the resolver should try _REPO_ROOT.
        monkeypatch.chdir(tmp_path)
        # public/configs/default.json ships at the repo root.
        resolved = ui_cli._resolve_strummer_config('public/configs/default.json')
        expected = os.path.join(ui_cli._REPO_ROOT, 'public/configs/default.json')
        assert resolved == expected
        assert os.path.isfile(resolved)

    def test_missing_path_exits_with_message(self, capsys):
        with pytest.raises(SystemExit) as excinfo:
            ui_cli._resolve_strummer_config('does/not/exist.json')
        assert excinfo.value.code == 1
        captured = capsys.readouterr()
        assert 'not found' in captured.out.lower()
        assert 'does/not/exist.json' in captured.out


class TestUICliDryRun:
    """--dry-run exits 0 without touching Kivy."""

    def test_dry_run_exits_zero(self, capsys):
        with pytest.raises(SystemExit) as excinfo:
            sys.argv = ['ui', '--dry-run']
            ui_cli.main()
        assert excinfo.value.code == 0
        captured = capsys.readouterr()
        assert 'dry run' in captured.out.lower()

    def test_help_exits_zero(self):
        result = subprocess.run(
            [sys.executable, '-m', 'sketchatone.cli.ui', '--help'],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert 'Sketchatone' in result.stdout


class TestUICliRunAppWithoutKivy:
    """If Kivy isn't importable, run_app must return non-zero rather than crash."""

    def test_run_app_returns_error_when_kivy_missing(self, monkeypatch):
        # Force the lazy import inside run_app to fail. The cli delegates
        # to sketchatone.ui.app, which imports kivy at module load, so we
        # block both kivy and the ui.app shim that loads it.
        import builtins
        import sys as _sys
        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name.startswith('kivy') or name == 'sketchatone.ui.app':
                raise ImportError(f'{name} not available in test')
            return real_import(name, *args, **kwargs)

        # Ensure no cached successful import bypasses the patch.
        _sys.modules.pop('sketchatone.ui.app', None)
        monkeypatch.setattr(builtins, '__import__', fake_import)
        rc = ui_cli.run_app(None, None, 150, False)
        assert rc == 1


class TestHotReloadApp:
    """Guarantees the Kaki hot-reload wrapper composes correctly and
    that the missing-extra fallback path stays user-friendly."""

    def test_kaki_app_precedes_sketchatone_app_in_mro(self):
        # Skip when the [hotreload] extra isn't installed in this env.
        pytest.importorskip('kivy')
        pytest.importorskip('kaki')
        from kaki.app import App as KakiApp
        from sketchatone.ui.app import SketchatoneUIApp
        from sketchatone.ui.hotreload import HotReloadUIApp
        mro = HotReloadUIApp.__mro__
        # KakiApp must come before SketchatoneUIApp so Kaki's build()
        # drives the rebuild lifecycle; reversing this would silently
        # disable hot reload.
        assert mro.index(KakiApp) < mro.index(SketchatoneUIApp)

    def test_run_app_hot_reload_returns_friendly_error_without_kaki(
        self, monkeypatch, capsys,
    ):
        pytest.importorskip('kivy')
        from sketchatone.ui import app as ui_app

        # Stub the bridge so we don't spin up the real asyncio worker
        # just to exercise the missing-extra fallback.
        class _StubBridge:
            def __init__(self, **kwargs):
                pass

            def start(self):
                pass

            def stop(self):
                pass

        monkeypatch.setattr(ui_app, 'UIBridge', _StubBridge)

        # Mark the hotreload module unimportable. Setting the sys.modules
        # entry to None makes any `from .hotreload import ...` raise
        # ImportError without us having to patch __import__.
        import sys as _sys
        monkeypatch.setitem(_sys.modules, 'sketchatone.ui.hotreload', None)

        rc = ui_app.run_app(
            config=None, ws_port=None, throttle_ms=150, fullscreen=False,
            hot_reload=True,
        )
        assert rc == 1
        out = capsys.readouterr().out.lower()
        assert 'hot reload' in out
        assert 'hotreload' in out  # install hint mentions the extra


class TestPanelRegistry:
    """Panel registry mirrors the web build's panel-visibility.ts."""

    def test_panels_match_web_ids(self):
        from sketchatone.ui.panels import PANELS, DEFAULT_PANEL_ID, find_panel
        ids = [p.id for p in PANELS]
        # Spot-check a few stable ids — full list is checked by snapshot.
        for expected in ('performance', 'tabletVisualizer', 'events', 'serverSettings'):
            assert expected in ids
        assert DEFAULT_PANEL_ID == 'performance'
        assert find_panel('events').label == 'Events'

    def test_find_panel_raises_on_unknown(self):
        from sketchatone.ui.panels import find_panel
        with pytest.raises(KeyError):
            find_panel('not-a-real-panel')


class TestTheme:
    """Theme tokens are well-formed RGBA tuples."""

    def test_hex_to_rgba(self):
        from sketchatone.ui.theme import hex_to_rgba
        assert hex_to_rgba('#000000') == (0.0, 0.0, 0.0, 1.0)
        assert hex_to_rgba('#ffffff', 0.5) == (1.0, 1.0, 1.0, 0.5)

    def test_hex_to_rgba_rejects_bad_input(self):
        from sketchatone.ui.theme import hex_to_rgba
        with pytest.raises(ValueError):
            hex_to_rgba('#abc')

    def test_semantic_tokens_present(self):
        from sketchatone.ui import theme
        for name in ('BG_PAGE', 'BG_SURFACE', 'TEXT_PRIMARY', 'ACCENT'):
            value = getattr(theme, name)
            assert isinstance(value, tuple) and len(value) == 4
            assert all(0.0 <= c <= 1.0 for c in value)

    def test_default_theme_is_dark(self):
        from sketchatone.ui import theme
        theme.set_theme('dark')
        assert theme.ACTIVE == 'dark'
        # In dark mode the page background is near-black (gray-50 inverted).
        r, g, b, _a = theme.BG_PAGE
        assert max(r, g, b) < 0.2

    def test_set_theme_swaps_palette(self):
        from sketchatone.ui import theme
        try:
            theme.set_theme('light')
            assert theme.ACTIVE == 'light'
            r, g, b, _a = theme.BG_PAGE
            assert min(r, g, b) > 0.9  # near-white in light mode
        finally:
            theme.set_theme('dark')

    def test_set_theme_rejects_unknown(self):
        from sketchatone.ui import theme
        with pytest.raises(ValueError):
            theme.set_theme('solarized')
