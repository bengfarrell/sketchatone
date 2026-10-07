"""ANSI colour helpers for CLI output.

Kept internal to the ``cli`` package because these are only meant for
terminal rendering.
"""

from __future__ import annotations

import os
import sys


RESET = '\033[0m'
BOLD = '\033[1m'
UNDERLINE = '\033[4m'


class Colors:
    RESET = RESET
    BOLD = BOLD
    UNDERLINE = UNDERLINE
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    GRAY = '\033[90m'


def _colour_enabled() -> bool:
    if os.environ.get('NO_COLOR'):
        return False
    if os.environ.get('FORCE_COLOR'):
        return True
    return sys.stdout.isatty()


def colored(text: str, color: str = '', bold: bool = False) -> str:
    """Wrap ``text`` in ANSI escape codes; no-op when the terminal is not a TTY."""
    if not _colour_enabled():
        return text
    prefix = ''
    if bold:
        prefix += BOLD
    if color:
        prefix += color
    if not prefix:
        return text
    return f'{prefix}{text}{RESET}'
