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

# Add parent directory to path for imports (matches sibling CLI modules)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

try:
    from blankslate.cli.tablet_reader_base import Colors, colored
except ImportError:
    # Soft fallback so the CLI still runs in environments where blankslate
    # is unavailable (e.g. early dev machines without the vendored dep).
    class Colors:  # type: ignore[no-redef]
        YELLOW = ''
        CYAN = ''
        GRAY = ''

    def colored(text: str, _color: str = '', bold: bool = False) -> str:  # type: ignore[no-redef]
        return text


# Repo root: __file__ is python/sketchatone/cli/ui.py, four dirname()s up
# is the project root that contains both ``python/`` and ``public/``.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))


def _resolve_strummer_config(path: str | None) -> str | None:
    """Resolve a ``--strummer-config`` value to an absolute path.

    Falls back to the repo root when a relative path doesn't exist
    in the current directory, so ``-s public/configs/default.json``
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
        f'❌ Strummer config not found: {path!r}',
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
        help='Path to tablet device descriptor JSON (e.g. public/configs/devices/huion-inspiroy2m.json) '
             'or a directory to scan for the connected device. For the strummer config '
             '(actions, slide, strumming) use --strummer-config instead.'
    )
    parser.add_argument(
        '-s', '--strummer-config',
        help='Path to strummer config JSON (actions, slide, strumming). '
             'Defaults to dist/public/configs/default.json when not specified.'
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
    config: str | None,
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
    KivyConfig.set('graphics', 'width', '800')
    KivyConfig.set('graphics', 'height', '480')
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

    try:
        from sketchatone.ui.app import run_app as _ui_run_app
    except ImportError as exc:
        print(colored(f'❌ Kivy is not installed: {exc}', Colors.YELLOW, bold=True))
        print(colored('   Install with: pip install "kivy>=2.3.0"', Colors.GRAY))
        print(colored('   On Debian/Pi:  sudo apt install python3-kivy', Colors.GRAY))
        return 1

    return _ui_run_app(
        config=config,
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
        print(colored(f'  strummer-config  = {args.strummer_config!r}', Colors.GRAY))
        print(colored(f'  enable-ws        = {args.enable_ws}', Colors.GRAY))
        print(colored(f'  ws-port          = {effective_ws_port}', Colors.GRAY))
        print(colored(f'  throttle         = {args.throttle}', Colors.GRAY))
        print(colored(f'  poll             = {args.poll}', Colors.GRAY))
        print(colored(f'  dev              = {args.dev}', Colors.GRAY))
        print(colored(f'  fullscreen       = {args.fullscreen}', Colors.GRAY))
        print(colored(f'  hot-reload       = {args.hot_reload}', Colors.GRAY))
        sys.exit(0)

    strummer_config = _resolve_strummer_config(args.strummer_config)

    sys.exit(run_app(
        args.config, effective_ws_port, args.throttle, args.fullscreen,
        poll_ms=args.poll, dev_mode=args.dev,
        strummer_config=strummer_config,
        hot_reload=args.hot_reload,
    ))


if __name__ == '__main__':
    main()
