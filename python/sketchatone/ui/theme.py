"""
Color and spacing tokens for the native Kivy UI.

Mirrors ``src/design-system/tokens.css``. Both light and dark palettes
are defined; the semantic module-level constants default to dark.
Call :func:`set_theme` to swap to light at runtime — widgets that
reference tokens via ``theme.NAME`` (rather than rebinding locally)
will pick up the new values on the next layout / repaint.
"""

from __future__ import annotations

from typing import Dict, Tuple

RGBA = Tuple[float, float, float, float]


def hex_to_rgba(value: str, alpha: float = 1.0) -> RGBA:
    """Convert a ``#rrggbb`` string to a Kivy 0..1 RGBA tuple."""
    v = value.lstrip('#')
    if len(v) != 6:
        raise ValueError(f'Expected #rrggbb, got {value!r}')
    r = int(v[0:2], 16) / 255.0
    g = int(v[2:4], 16) / 255.0
    b = int(v[4:6], 16) / 255.0
    return (r, g, b, alpha)


# ---- Palettes ------------------------------------------------------------
# Keys mirror the semantic names below. Hex values mirror tokens.css.

LIGHT: Dict[str, RGBA] = {
    'GRAY_50':  hex_to_rgba('#fafafa'),
    'GRAY_75':  hex_to_rgba('#f5f5f5'),
    'GRAY_100': hex_to_rgba('#efefef'),
    'GRAY_200': hex_to_rgba('#e4e4e7'),
    'GRAY_300': hex_to_rgba('#d4d4d8'),
    'GRAY_400': hex_to_rgba('#a1a1aa'),
    'GRAY_500': hex_to_rgba('#71717a'),
    'GRAY_600': hex_to_rgba('#52525b'),
    'GRAY_700': hex_to_rgba('#3f3f46'),
    'GRAY_800': hex_to_rgba('#27272a'),
    'GRAY_900': hex_to_rgba('#18181b'),
    'BLUE_100': hex_to_rgba('#dbeafe'),
    'BLUE_500': hex_to_rgba('#3b82f6'),
    'BLUE_600': hex_to_rgba('#2563eb'),
    'BLUE_900': hex_to_rgba('#1e3a8a'),
    'STATUS_CONNECTED':    hex_to_rgba('#16a34a'),
    'STATUS_DISCONNECTED': hex_to_rgba('#a1a1aa'),
}

DARK: Dict[str, RGBA] = {
    'GRAY_50':  hex_to_rgba('#18181b'),
    'GRAY_75':  hex_to_rgba('#1f1f23'),
    'GRAY_100': hex_to_rgba('#27272a'),
    'GRAY_200': hex_to_rgba('#2e2e33'),
    'GRAY_300': hex_to_rgba('#3f3f46'),
    'GRAY_400': hex_to_rgba('#52525b'),
    'GRAY_500': hex_to_rgba('#71717a'),
    'GRAY_600': hex_to_rgba('#a1a1aa'),
    'GRAY_700': hex_to_rgba('#d4d4d8'),
    'GRAY_800': hex_to_rgba('#e4e4e7'),
    'GRAY_900': hex_to_rgba('#fafafa'),
    'BLUE_100': hex_to_rgba('#1e3a8a'),
    'BLUE_500': hex_to_rgba('#3b82f6'),
    'BLUE_600': hex_to_rgba('#60a5fa'),
    'BLUE_900': hex_to_rgba('#dbeafe'),
    'STATUS_CONNECTED':    hex_to_rgba('#22c55e'),
    'STATUS_DISCONNECTED': hex_to_rgba('#52525b'),
}

PALETTES: Dict[str, Dict[str, RGBA]] = {'light': LIGHT, 'dark': DARK}

# Default theme — dark.
ACTIVE: str = 'dark'


def _apply(palette: Dict[str, RGBA]) -> None:
    """Bind module-level constants from ``palette``."""
    g = globals()
    for key, value in palette.items():
        g[key] = value
    # Semantic aliases — keep render code from referring to raw scales.
    g['BG_PAGE']        = palette['GRAY_50']
    g['BG_SURFACE']     = palette['GRAY_100']
    g['BG_SURFACE_ALT'] = palette['GRAY_75']
    g['BORDER']         = palette['GRAY_200']
    g['TEXT_PRIMARY']   = palette['GRAY_900']
    g['TEXT_SECONDARY'] = palette['GRAY_600']
    g['TEXT_MUTED']     = palette['GRAY_500']
    g['ACCENT']         = palette['BLUE_500']
    g['ACCENT_BG']      = palette['BLUE_100']


def set_theme(name: str) -> None:
    """Switch active palette. ``name`` must be ``'light'`` or ``'dark'``."""
    global ACTIVE
    if name not in PALETTES:
        raise ValueError(f'Unknown theme {name!r}; expected one of {list(PALETTES)}')
    ACTIVE = name
    _apply(PALETTES[name])


_apply(PALETTES[ACTIVE])


# Spacing scale — mirrors --sketch-spacing-N (pixels).
SPACE_1 = 3
SPACE_2 = 6
SPACE_3 = 8
SPACE_4 = 11
SPACE_5 = 16

# Layout heights (designed for the 800x480 kiosk target at density=1).
# These are intentionally in raw pixels, not dp, so Mac and Pi render
# identically once KIVY_METRICS_DENSITY=1 and SDL_ALLOW_HIDPI=0 are set.
TOPBAR_HEIGHT = 30
TABBAR_HEIGHT = 32
STATUSBAR_HEIGHT = 32

# Touch targets — sized for finger input on the 800x480 kiosk.
CONTROL_HEIGHT = 27
FIELD_LABEL_HEIGHT = 22

# Numeric inputs and dropdowns — enlarged for finger-friendly editing.
INPUT_HEIGHT = 40
INPUT_FONT_SIZE = '14sp'
