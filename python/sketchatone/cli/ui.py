#!/usr/bin/env python3
"""
Sketchatone UI CLI

Launches the native Python (Kivy) UI for Sketchatone. The Kivy app itself
is a minimal bootstrap window — full dashboard widgets will follow. The
CLI argument surface is stable so deployment scripts, systemd units, and
packaging can target it.

Usage:
    python -m sketchatone.cli.ui
    python -m sketchatone.cli.ui --config path/to/config.json
    python -m sketchatone.cli.ui --dry-run        # parse args, don't open a window
"""

from __future__ import annotations

import argparse
import sys
import os

# Prevent Kivy from parsing our argv (it consumes unknown flags as its own).
os.environ.setdefault('KIVY_NO_ARGS', '1')

# Stop SDL2 from synthesising mouse events from touches. Without this the
# Kivy mouse provider fires a duplicate click for every touchscreen tap,
# often at slightly different coords than the real touch, which routes
# button presses to the wrong widget on the appliance.
os.environ.setdefault('SDL_TOUCH_MOUSE_EVENTS', '0')
os.environ.setdefault('SDL_MOUSE_TOUCH_EVENTS', '0')

# On macOS, SDL2 enables Retina HiDPI by default, giving Kivy a framebuffer
# (Window.size) that is the requested window size times the backing scale
# (typically 2×). We ask SDL to disable it for a 1:1 framebuffer, but recent
# macOS/SDL builds ignore this, so it's best-effort only — _ScaledContainer
# (app.py) scales the 800×480 dashboard to fit whatever framebuffer results,
# making the preview faithful whether HiDPI ends up on or off.
if sys.platform == 'darwin':
    os.environ.setdefault('SDL_ALLOW_HIDPI', '0')

# Pin density to the Pi screen's natural value (133 PPI / 96 reference ≈ 1.4)
# so sp/dp font sizes render at the same Kivy-pixel count on both platforms.
# On Mac without this, Kivy auto-detects a much higher density (Retina) and
# makes fonts enormous; on the Pi it would be ~1.39 anyway, so 1.4 is a
# faithful approximation of the target device.
os.environ.setdefault('KIVY_METRICS_DENSITY', '1.4')

# Force SDL2's FreeType text renderer on both platforms. macOS would otherwise
# fall back to CoreText for some glyphs, producing different character-width
# measurements than Pi's FreeType path — causing text to lay out differently.
os.environ.setdefault('KIVY_TEXT', 'sdl2')

# Add parent directory to path for imports (matches sibling CLI modules)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone.cli._ansi import Colors, colored


# Repo root: __file__ is python/sketchatone/cli/ui.py, four dirname()s up
# is the project root that contains both ``python/`` and ``public/``.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))


def _resolve_config(path: str | None) -> str | None:
    """Resolve a ``--config`` value to an absolute path.

    Falls back to the repo root when a relative path doesn't exist
    in the current directory, so ``-c public/configs/default.json``
    works the same from the repo root and from ``python/``. Exits
    with a clear message if no candidate file exists.
    """
    if not path:
        return None
    if os.path.isfile(path):
        return os.path.abspath(path)
    if not os.path.isabs(path):
        repo_relative = os.path.join(_REPO_ROOT, path)
        if os.path.isfile(repo_relative):
            return repo_relative
        tried = (os.path.abspath(path), repo_relative)
    else:
        tried = (path,)
    print(colored(
        f'❌ Config not found: {path!r}',
        Colors.YELLOW, bold=True))
    for candidate in tried:
        print(colored(f'   tried: {candidate}', Colors.GRAY))
    sys.exit(1)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Sketchatone native (Kivy) UI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Launches a minimal Kivy window sized to the 800x480 kiosk display. The
dashboard widgets are not implemented yet; this bootstrap exists to
validate packaging and the deployment pipeline.
"""
    )
    parser.add_argument(
        '-c', '--config',
        dest='config',
        metavar='PATH',
        help='Combined config file path (strummer, MIDI, and server settings). '
             'The UI reads the strummer/actions/slide sections; MIDI and '
             'server sections are ignored. Defaults to '
             'dist/public/configs/default.json when not specified.'
    )
    parser.add_argument(
        '--enable-ws',
        action='store_true',
        help='Also start the WebSocket server (default: off, in-process only)'
    )
    parser.add_argument(
        '--ws-port',
        type=int,
        default=8081,
        help='WebSocket port when --enable-ws is set (default: 8081)'
    )
    parser.add_argument(
        '--throttle',
        type=int,
        default=150,
        help='Event bus throttle interval in milliseconds (default: 150)'
    )
    parser.add_argument(
        '--poll',
        type=int,
        default=2000,
        metavar='MS',
        help='Device poll interval in milliseconds; waits for tablet if not present (default: 2000)'
    )
    parser.add_argument(
        '--dev',
        action='store_true',
        help='Dev mode: skip tablet detection entirely (no HID reader)'
    )
    parser.add_argument(
        '--fullscreen',
        action='store_true',
        help='Launch fullscreen (recommended on the device)'
    )
    parser.add_argument(
        '--hot-reload',
        action='store_true',
        help='Dev: watch sketchatone/ui and rebuild the widget tree on save '
             '(requires the [hotreload] extra: pip install -e ".[hotreload]")'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Parse arguments and exit without opening a Kivy window'
    )
    return parser


def run_app(
    ws_port: int | None,
    throttle_ms: int,
    fullscreen: bool,
    poll_ms: int | None = 2000,
    dev_mode: bool = False,
    strummer_config: str | None = None,
    hot_reload: bool = False,
) -> int:
    """Boot the Kivy app. Kivy (and the ui package that imports it) is
    loaded lazily so this CLI remains importable — and `--help` /
    `--dry-run` usable — without Kivy installed."""
    # Pin window/input config BEFORE importing sketchatone.ui.app, which
    # pulls in kivy.app/kivy.uix.* at module load. On some Kivy versions
    # the Window provider locks in its size from ~/.kivy/config.ini during
    # that import chain, so Config.set called later (from inside
    # ui.app.run_app) is silently ignored. Setting them here, against the
    # kivy.config singleton itself, runs before any Window initialisation.
    try:
        from kivy.config import Config as KivyConfig
    except ImportError as exc:
        print(colored(f'❌ Kivy is not installed: {exc}', Colors.YELLOW, bold=True))
        print(colored('   Install with: pip install "kivy>=2.3.0"', Colors.GRAY))
        print(colored('   On Debian/Pi:  sudo apt install python3-kivy', Colors.GRAY))
        return 1

    # Appliance-only knobs: hide the cursor and pin the window non-resizable
    # so the 800x480 panel renders 1:1 on the DSI display. On dev hosts
    # (macOS, Windows, Linux desktop) the cursor needs to be visible and
    # the window resizable so the dashboard can actually be inspected.
    is_appliance = sys.platform.startswith('linux')
    # On macOS the 800×480 logical dashboard is scaled-to-fit inside its
    # window by _ScaledContainer (app.py), which derives the scale factor
    # from the real framebuffer at runtime — so this size just controls the
    # physical preview window, not the layout. We request 1600×960 (points)
    # for a comfortably large preview; Retina then backs it at 2× and the
    # container fills whatever framebuffer results. The Pi runs the
    # dashboard unscaled at its native 800×480.
    _win_w, _win_h = ('1600', '960') if sys.platform == 'darwin' else ('800', '480')
    KivyConfig.set('graphics', 'width', _win_w)
    KivyConfig.set('graphics', 'height', _win_h)
    KivyConfig.set('graphics', 'resizable', '0' if is_appliance else '1')
    KivyConfig.set('graphics', 'position', 'custom')
    KivyConfig.set('graphics', 'left', '0')
    KivyConfig.set('graphics', 'top', '0')
    KivyConfig.set('graphics', 'show_cursor', '0' if is_appliance else '1')
    if fullscreen:
        KivyConfig.set('graphics', 'borderless', '1')
        KivyConfig.set('graphics', 'fullscreen', '0')
    KivyConfig.set('input', 'mouse', 'mouse,disable_on_activity')
    # probesysfs scans /sys/class/input for touch event nodes and prefers
    # mtdev (multi-touch) when libmtdev is installed, falling back to
    # hidinput. It only exists on Linux; on macOS/Windows the default
    # mouse provider already covers dev use.
    if is_appliance:
        KivyConfig.set('input', 'probesysfs', 'probesysfs,provider=mtdev')

    # Pin Kivy's bundled Roboto as the explicit default font on both platforms.
    # Without this, macOS can substitute system fonts for missing glyphs via
    # CoreText, producing different glyph metrics than Pi's FreeType path.
    try:
        import kivy as _kivy
        from kivy.core.text import LabelBase
        _fonts = os.path.join(os.path.dirname(_kivy.__file__), 'data', 'fonts')
        LabelBase.register(
            name='Roboto',
            fn_regular=os.path.join(_fonts, 'Roboto-Regular.ttf'),
            fn_bold=os.path.join(_fonts, 'Roboto-Bold.ttf'),
            fn_italic=os.path.join(_fonts, 'Roboto-Italic.ttf'),
            fn_bolditalic=os.path.join(_fonts, 'Roboto-BoldItalic.ttf'),
        )
    except Exception:
        pass  # non-fatal: falls back to Kivy's default registration

    try:
        from sketchatone.ui.app import run_app as _ui_run_app
    except ImportError as exc:
        print(colored(f'❌ Kivy is not installed: {exc}', Colors.YELLOW, bold=True))
        print(colored('   Install with: pip install "kivy>=2.3.0"', Colors.GRAY))
        print(colored('   On Debian/Pi:  sudo apt install python3-kivy', Colors.GRAY))
        return 1

    return _ui_run_app(
        ws_port=ws_port,
        throttle_ms=throttle_ms,
        fullscreen=fullscreen,
        poll_ms=poll_ms,
        dev_mode=dev_mode,
        strummer_config=strummer_config,
        hot_reload=hot_reload,
    )


def main() -> None:
    args = build_arg_parser().parse_args()
    effective_ws_port = args.ws_port if args.enable_ws else None

    if args.dry_run:
        print(colored('sketchatone-ui: dry run', Colors.YELLOW, bold=True))
        print(colored(f'  config           = {args.config!r}', Colors.GRAY))
        print(colored(f'  enable-ws        = {args.enable_ws}', Colors.GRAY))
        print(colored(f'  ws-port          = {effective_ws_port}', Colors.GRAY))
        print(colored(f'  throttle         = {args.throttle}', Colors.GRAY))
        print(colored(f'  poll             = {args.poll}', Colors.GRAY))
        print(colored(f'  dev              = {args.dev}', Colors.GRAY))
        print(colored(f'  fullscreen       = {args.fullscreen}', Colors.GRAY))
        print(colored(f'  hot-reload       = {args.hot_reload}', Colors.GRAY))
        sys.exit(0)

    config_path = _resolve_config(args.config)

    sys.exit(run_app(
        effective_ws_port, args.throttle, args.fullscreen,
        poll_ms=args.poll, dev_mode=args.dev,
        strummer_config=config_path,
        hot_reload=args.hot_reload,
    ))


if __name__ == '__main__':
    main()
