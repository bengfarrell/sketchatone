"""
Panel body widgets for the native dashboard.

Each panel subscribes to the in-process :class:`UIBridge` once at
construction and mutates its own labels on the Kivy main thread when
events arrive. ``PanelArea`` keeps the widgets alive across tab
switches so subscriptions don't leak.

Pure formatting helpers (:func:`format_value`, :func:`format_strum`,
:class:`EventRateTracker`) live alongside the widgets so they can be
exercised without booting Kivy.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, Optional, Tuple

from kivy.graphics import Color, Ellipse, Line, Rectangle, RoundedRectangle
from kivy.uix.anchorlayout import AnchorLayout
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.gridlayout import GridLayout
from kivy.uix.label import Label
from kivy.uix.scrollview import ScrollView
from kivy.uix.spinner import Spinner
from kivy.uix.stacklayout import StackLayout
from kivy.uix.textinput import TextInput
from kivy.uix.widget import Widget

from . import theme
from .bridge import UIBridge


# ---- Pure helpers --------------------------------------------------------

def format_value(value: Optional[float], decimals: int = 3) -> str:
    """Render a numeric event field. Mirrors the web build's em-dash for None."""
    if value is None:
        return '—'
    return f'{value:.{decimals}f}'

def format_strum(strum: Any) -> dict:
    """Reduce a ``StrumEventData`` to display primitives.

    Returns ``{'type': str, 'notes': list[str], 'velocity': int}``. An
    empty/None strum becomes ``{'type': '', 'notes': [], 'velocity': 0}``.
    """
    if strum is None:
        return {'type': '', 'notes': [], 'velocity': 0}
    notes = []
    for n in getattr(strum, 'notes', []) or []:
        name = getattr(n, 'name', '?')
        octave = getattr(n, 'octave', '')
        vel = getattr(n, 'velocity', 0)
        notes.append(f'{name}{octave} v{vel}')
    return {
        'type': getattr(strum, 'type', '') or '',
        'notes': notes,
        'velocity': int(getattr(strum, 'velocity', 0) or 0),
    }


class EventRateTracker:
    """Rolling events-per-second counter over a fixed window."""

    def __init__(self, window_seconds: float = 1.0) -> None:
        self._window = window_seconds
        self._times: Deque[float] = deque()
        self.total: int = 0
        self.last_time: Optional[float] = None

    def record(self, now: Optional[float] = None) -> None:
        t = time.monotonic() if now is None else now
        self._times.append(t)
        self.total += 1
        self.last_time = t
        self._trim(t)

    def rate(self, now: Optional[float] = None) -> float:
        t = time.monotonic() if now is None else now
        self._trim(t)
        return len(self._times) / self._window

    def age(self, now: Optional[float] = None) -> Optional[float]:
        if self.last_time is None:
            return None
        t = time.monotonic() if now is None else now
        return max(0.0, t - self.last_time)

    def _trim(self, now: float) -> None:
        cutoff = now - self._window
        while self._times and self._times[0] < cutoff:
            self._times.popleft()


# ---- Widgets -------------------------------------------------------------

def _field_label(text: str) -> Label:
    lbl = Label(text=text, color=theme.TEXT_MUTED, font_size='7.5sp',
                halign='left', valign='middle')
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _value_label() -> Label:
    lbl = Label(text='—', color=theme.TEXT_PRIMARY, font_size='9.5sp',
                halign='left', valign='middle')
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


class PlaceholderPanel(BoxLayout):
    """Fallback body for panels that aren't ported yet."""

    def __init__(self, label: str, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        msg = Label(
            text=f'Panel "{label}" not implemented yet.',
            color=theme.TEXT_MUTED, font_size='9.5sp',
            halign='center', valign='middle',
        )
        msg.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(msg)


class EventsPanel(BoxLayout):
    """Latest tablet event fields, button states, and last strum.

    Mirrors the web ``strum-events-display`` layout: a header with the
    big event count + small ``EVENTS`` caption, a three-column field
    grid (X / Y / Pressure / Tilt X / Tilt Y), a row of full-width
    rounded status chips (Primary / Secondary / Tablet N) that turn
    green when active, and a strum section with a type pill and the
    most recent notes rendered as name+velocity chips.
    """

    _FIELDS = (('X', 'x'), ('Y', 'y'), ('Pressure', 'pressure'),
               ('Tilt X', 'tiltX'), ('Tilt Y', 'tiltY'))

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_4, **kwargs)
        self._count = 0
        self._last_strum: Any = None

        self.add_widget(self._build_header_row())
        self.add_widget(self._build_event_grid())
        self.add_widget(self._build_button_row())
        self.add_widget(self._build_strum_section())
        # Anchor everything to the top; soak up any extra vertical space.
        self.add_widget(Widget())

        # Backing labels — kept in sync with the visible widgets so
        # callers (and tests) that read the plain-text mirror keep
        # working even though the visible composition uses many
        # smaller pieces.
        self._header = Label(text='0 events')
        self._buttons = Label(text='Primary: \u2014   Secondary: \u2014')
        self._strum = Label(text='Strum: (none)')

        self._render_strum_body(None)

        if bridge is not None:
            bridge.on('tablet', self._on_tablet)
            bridge.on('strum', self._on_strum)

    # ---- Section builders --------------------------------------------

    def _build_header_row(self) -> BoxLayout:
        # Big count baselined next to a small uppercase "EVENTS" caption.
        # Height matches the standard input row so it sits in the same
        # vertical rhythm as the form panels' headers.
        row = BoxLayout(orientation='horizontal', spacing=theme.SPACE_3,
                        size_hint_y=None, height=44)
        self._count_label = Label(
            text='0', color=theme.TEXT_PRIMARY, font_size='18.5sp', bold=True,
            size_hint=(None, 1), halign='left', valign='middle',
        )
        # Let the label auto-size from its texture. Do NOT bind a
        # ``text_size`` constraint on this label: ``text_size`` clips
        # the rendering area, so when the digit count grows (e.g. 9 -> 10)
        # the new glyph would wrap inside the stale, narrower box before
        # the width binding could catch up.
        def _sync_count(w, ts):
            w.width = max(28, int(ts[0]))
        self._count_label.bind(texture_size=_sync_count)
        caption = Label(
            text='EVENTS', color=theme.TEXT_SECONDARY, font_size='8.5sp', bold=True,
            halign='left', valign='middle',
        )
        caption.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        row.add_widget(self._count_label)
        row.add_widget(caption)
        return row

    def _build_event_grid(self) -> GridLayout:
        # Cell geometry mirrors ``_setting_row``: ``_form_field_label``
        # (13sp bold, height ``FIELD_LABEL_HEIGHT``) sits above the
        # value with the same ``SPACE_1 + 5`` gap form panels use, so
        # the events grid reads as part of the same field family.
        grid = GridLayout(cols=3, size_hint_y=None,
                          spacing=(theme.SPACE_4, theme.SPACE_3))
        grid.bind(minimum_height=grid.setter('height'))
        self._values: dict = {}
        label_gap = theme.SPACE_1 + 5
        cell_h = theme.FIELD_LABEL_HEIGHT + label_gap + 30
        for label_text, key in self._FIELDS:
            cell = BoxLayout(orientation='vertical', size_hint_y=None,
                             height=cell_h, spacing=label_gap)
            cell.add_widget(self._make_field_label(label_text))
            v = self._make_field_value()
            cell.add_widget(v)
            grid.add_widget(cell)
            self._values[key] = v
        for _ in range((-len(self._FIELDS)) % 3):
            grid.add_widget(Widget(size_hint_y=None, height=cell_h))
        return grid

    def _build_button_row(self) -> BoxLayout:
        # Mirrors the web's ``.button-status`` row: hairline border-top
        # plus three flex chips. Chip height matches ``CONTROL_HEIGHT``
        # so the row reads at the same scale as other tappable controls.
        row = BoxLayout(orientation='horizontal', spacing=theme.SPACE_3,
                        size_hint_y=None, height=theme.CONTROL_HEIGHT + theme.SPACE_3,
                        padding=(0, theme.SPACE_3, 0, 0))
        with row.canvas.before:
            self._btn_sep_color = Color(*theme.BORDER)
            self._btn_sep = Line(points=[0, 0, 0, 0], width=1.0)
        row.bind(pos=self._sync_btn_sep, size=self._sync_btn_sep)
        self._button_chips: dict = {}
        for key, label_text in (('primary', 'PRIMARY'),
                                ('secondary', 'SECONDARY'),
                                ('tablet', 'TABLET \u2014')):
            chip = self._make_status_chip(label_text)
            self._button_chips[key] = chip
            row.add_widget(chip)
        return row

    def _build_strum_section(self) -> BoxLayout:
        section = BoxLayout(orientation='vertical', spacing=theme.SPACE_3,
                            size_hint_y=None,
                            padding=(0, theme.SPACE_3, 0, 0))
        section.bind(minimum_height=section.setter('height'))
        with section.canvas.before:
            self._strum_sep_color = Color(*theme.BORDER)
            self._strum_sep = Line(points=[0, 0, 0, 0], width=1.0)
        section.bind(pos=self._sync_strum_sep, size=self._sync_strum_sep)

        header = BoxLayout(orientation='horizontal', spacing=theme.SPACE_3,
                           size_hint_y=None, height=theme.FIELD_LABEL_HEIGHT)
        label = Label(text='STRUM', color=theme.TEXT_SECONDARY,
                      font_size='8.5sp', bold=True,
                      size_hint=(None, 1),
                      halign='left', valign='middle')
        # Auto-size width from texture so the label can never wrap into
        # a narrow box during layout. ``text_size`` is intentionally NOT
        # bound to ``size`` here -- doing so creates a clipping box and
        # the label can flash as wrapped/garbled glyphs while the layout
        # pass settles.
        def _sync_label_w(w, ts):
            w.width = int(ts[0])
        label.bind(texture_size=_sync_label_w)
        label.texture_update(); label.width = int(label.texture_size[0])
        header.add_widget(label)
        self._strum_type_pill = self._make_type_pill('')
        header.add_widget(self._strum_type_pill)
        # Spacer so the label + pill stay flush-left like the web UI.
        header.add_widget(Widget())
        section.add_widget(header)

        self._strum_body = BoxLayout(orientation='vertical',
                                     spacing=theme.SPACE_2,
                                     size_hint_y=None)
        self._strum_body.bind(minimum_height=self._strum_body.setter('height'))
        section.add_widget(self._strum_body)
        return section

    # ---- Small widget factories --------------------------------------

    def _make_field_label(self, text: str) -> Label:
        # Field-grid labels use the shared ``_form_field_label`` style
        # (13sp bold ``TEXT_SECONDARY``, height ``FIELD_LABEL_HEIGHT``)
        # so they match the labelling on every other panel. Text is
        # uppercased to preserve the data-display distinction the web
        # build uses.
        lbl = _form_field_label(text.upper())
        return lbl

    def _make_field_value(self) -> Label:
        lbl = Label(
            text='\u2014', color=theme.TEXT_PRIMARY, font_size='10.5sp',
            bold=True, size_hint_y=None, height=30,
            halign='left', valign='middle',
        )
        lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        return lbl

    def _make_status_chip(self, text: str) -> Label:
        chip = Label(
            text=text, color=theme.TEXT_SECONDARY, font_size='8.5sp',
            bold=True, halign='center', valign='middle',
        )
        chip.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        with chip.canvas.before:
            chip._bg_color = Color(*theme.BG_SURFACE_ALT)
            chip._bg_rect = RoundedRectangle(pos=chip.pos, size=chip.size,
                                             radius=[8])
        def _sync(w, *_):
            w._bg_rect.pos = w.pos
            w._bg_rect.size = w.size
        chip.bind(pos=_sync, size=_sync)
        chip._active = False
        return chip

    def _set_chip_active(self, chip: Label, active: bool) -> None:
        if getattr(chip, '_active', None) == active:
            return
        chip._active = active
        chip._bg_color.rgba = (theme.STATUS_CONNECTED if active
                               else theme.BG_SURFACE_ALT)
        chip.color = ((1, 1, 1, 1) if active else theme.TEXT_SECONDARY)

    def _make_type_pill(self, text: str) -> Label:
        # Width auto-tracks ``texture_size`` plus horizontal padding so
        # the pill hugs its text exactly. ``text_size`` is intentionally
        # NOT bound to ``size``: doing so creates a feedback loop with
        # ``texture_size`` and clips the glyphs while the layout pass
        # settles. The background rect's height collapses with the pill
        # height when text is empty so no stray bar paints on init.
        pill = Label(
            text=text, color=theme.TEXT_SECONDARY, font_size='8sp',
            bold=True, size_hint=(None, None),
            size=(0, theme.FIELD_LABEL_HEIGHT),
            halign='center', valign='middle',
        )
        with pill.canvas.before:
            pill._bg_color = Color(0, 0, 0, 0)
            pill._bg_rect = RoundedRectangle(pos=pill.pos, size=(0, 0),
                                             radius=[6])
        def _sync_rect(w, *_):
            w._bg_rect.pos = w.pos
            w._bg_rect.size = (w.width, w.height) if w.text else (0, 0)
        def _sync_w(w, ts):
            w.width = (int(ts[0]) + 2 * theme.SPACE_3) if w.text else 0
        pill.bind(pos=_sync_rect, size=_sync_rect)
        pill.bind(texture_size=_sync_w)
        return pill

    def _set_type_pill(self, kind: str) -> None:
        pill = self._strum_type_pill
        pill.text = kind.upper() if kind else ''
        if kind == 'strum':
            pill._bg_color.rgba = theme.STATUS_CONNECTED
            pill.color = (1, 1, 1, 1)
        elif kind == 'release':
            pill._bg_color.rgba = theme.BLUE_100
            pill.color = theme.BLUE_900
        else:
            pill._bg_color.rgba = (0, 0, 0, 0)
            pill.color = theme.TEXT_SECONDARY
        pill.texture_update()
        pill.width = ((int(pill.texture_size[0]) + 2 * theme.SPACE_3)
                      if pill.text else 0)
        # Force a rect refresh so collapse-to-zero happens immediately
        # when text is cleared (the size-binding fires on the line above
        # only if the width actually changed).
        pill._bg_rect.pos = pill.pos
        pill._bg_rect.size = ((pill.width, pill.height) if pill.text
                              else (0, 0))

    def _make_note_chip(self, name_text: str, velocity_text: str) -> BoxLayout:
        row = BoxLayout(orientation='horizontal', size_hint=(None, None),
                        spacing=theme.SPACE_2,
                        padding=(theme.SPACE_3, 0),
                        height=34)
        with row.canvas.before:
            row._bg_color = Color(*theme.BG_SURFACE_ALT)
            row._bg_rect = RoundedRectangle(pos=row.pos, size=row.size,
                                            radius=[8])
        def _sync(w, *_):
            w._bg_rect.pos = w.pos
            w._bg_rect.size = w.size
        row.bind(pos=_sync, size=_sync)
        name = Label(text=name_text, color=theme.TEXT_PRIMARY,
                     font_size='9.5sp', bold=True, size_hint=(None, 1),
                     halign='left', valign='middle')
        def _sync_label_w(w, ts):
            w.width = int(ts[0])
            w.text_size = w.size
        name.bind(texture_size=_sync_label_w)
        name.texture_update(); name.width = int(name.texture_size[0])
        row.add_widget(name)
        vel: Optional[Label] = None
        if velocity_text:
            vel = Label(text=velocity_text, color=theme.TEXT_SECONDARY,
                        font_size='7.5sp', size_hint=(None, 1),
                        halign='left', valign='middle')
            vel.bind(texture_size=_sync_label_w)
            vel.texture_update(); vel.width = int(vel.texture_size[0])
            row.add_widget(vel)
        def _sync_row(*_):
            inner = name.width + (vel.width + theme.SPACE_2 if vel else 0)
            row.width = inner + 2 * theme.SPACE_3
        name.bind(width=_sync_row)
        if vel is not None:
            vel.bind(width=_sync_row)
        _sync_row()
        return row

    def _muted_message(self, text: str) -> Label:
        lbl = Label(text=text, color=theme.TEXT_MUTED, font_size='8.5sp',
                    italic=True, size_hint_y=None, height=24,
                    halign='left', valign='middle')
        lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        return lbl

    def _render_strum_body(self, info: Optional[dict]) -> None:
        self._strum_body.clear_widgets()
        if info is None or not info.get('type'):
            self._strum_body.add_widget(self._muted_message('No strum'))
            return
        if info['type'] == 'release':
            self._strum_body.add_widget(self._muted_message('Released'))
            return
        notes = info.get('notes') or []
        if notes:
            wrap = StackLayout(size_hint_y=None,
                               spacing=(theme.SPACE_2, theme.SPACE_2))
            wrap.bind(minimum_height=wrap.setter('height'))
            for entry in notes:
                # Per-note velocity is omitted from the chip because the
                # aggregate "Velocity: N" line below already shows it.
                name_part = entry.rsplit(' v', 1)[0] if ' v' in entry else entry
                wrap.add_widget(self._make_note_chip(name_part, ''))
            self._strum_body.add_widget(wrap)
        vel_lbl = Label(
            text=f"Velocity: {info.get('velocity', 0)}",
            color=theme.TEXT_SECONDARY, font_size='8sp',
            size_hint_y=None, height=22,
            halign='left', valign='middle',
        )
        vel_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self._strum_body.add_widget(vel_lbl)

    # ---- Separator painters ------------------------------------------

    def _sync_btn_sep(self, w, *_):
        y = w.y + w.height - 0.5
        self._btn_sep.points = [w.x, y, w.x + w.width, y]

    def _sync_strum_sep(self, w, *_):
        y = w.y + w.height - 0.5
        self._strum_sep.points = [w.x, y, w.x + w.width, y]

    # ---- Bridge handlers ---------------------------------------------

    def _on_tablet(self, ev: Any) -> None:
        self._count += 1
        self._header.text = f'{self._count} events'
        self._count_label.text = str(self._count)
        for key, lbl in self._values.items():
            lbl.text = format_value(getattr(ev, key, None))
        prim = bool(getattr(ev, 'primaryButtonPressed', False))
        sec = bool(getattr(ev, 'secondaryButtonPressed', False))
        self._set_chip_active(self._button_chips['primary'], prim)
        self._set_chip_active(self._button_chips['secondary'], sec)
        buttons = getattr(ev, 'buttons', None) or {}
        pressed_n: Optional[int] = None
        for i in range(1, 9):
            if buttons.get(f'button{i}'):
                pressed_n = i
                break
        tablet_chip = self._button_chips['tablet']
        dash = '\u2014'
        tablet_chip.text = f'TABLET {pressed_n if pressed_n else dash}'
        self._set_chip_active(tablet_chip, pressed_n is not None)
        on, off = '\u25cf', '\u25cb'
        self._buttons.text = (
            f'Primary: {on if prim else off}   '
            f'Secondary: {on if sec else off}'
        )

    def _on_strum(self, strum: Any) -> None:
        self._last_strum = strum
        info = format_strum(strum)
        if not info['type']:
            self._strum.text = 'Strum: (none)'
            self._set_type_pill('')
            self._render_strum_body(None)
            return
        kind = info['type']
        if info['notes']:
            notes_text = '  '.join(info['notes'])
            self._strum.text = f"Strum [{kind}] v{info['velocity']}: {notes_text}"
        else:
            self._strum.text = f"Strum [{kind}]"
        self._set_type_pill(kind)
        self._render_strum_body(info)


_STYLUS_BADGE_PALETTE: Dict[str, Tuple[Any, Any]] = {
    # (background, foreground) — primary uses the standard accent; secondary
    # borrows a magenta-ish tint since there's no dedicated theme token.
    'primary':   (None,                       None),
    'secondary': ((0.96, 0.66, 0.85, 1.0),    (0.42, 0.07, 0.28, 1.0)),
}


class _MappingChip(BoxLayout):
    """Pill row: colored badge + monospace action label.

    Mirrors the web ``.mapping-chip`` ``<badge>`` ``<action>`` pair.
    ``kind`` selects the badge palette (``'button'`` numeric, ``'primary'``
    or ``'secondary'`` stylus). ``set_active(bool)`` highlights the chip
    without rebuilding it so the panel can flick pressed buttons on/off
    from the tablet event stream.
    """

    HEIGHT = 40
    BADGE_W = 36
    BADGE_H = 24

    def __init__(self, badge_text: str, action_text: str,
                 kind: str = 'button', **kwargs) -> None:
        super().__init__(orientation='horizontal', spacing=theme.SPACE_3,
                         padding=(theme.SPACE_3, theme.SPACE_2),
                         size_hint_y=None, height=self.HEIGHT, **kwargs)
        self._kind = kind
        self._active = False

        with self.canvas.before:
            self._bg_color = Color(*theme.BG_SURFACE_ALT)
            self._bg = RoundedRectangle(pos=self.pos, size=self.size, radius=[12])
        self.bind(pos=self._sync_bg, size=self._sync_bg)

        badge = Label(
            text=badge_text, font_size='14sp', bold=True,
            color=theme.TEXT_PRIMARY,
            size_hint=(None, None), size=(self.BADGE_W, self.BADGE_H),
            halign='center', valign='middle',
        )
        badge.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        with badge.canvas.before:
            self._badge_bg_color = Color(*self._badge_palette()[0])
            self._badge_bg = RoundedRectangle(
                pos=badge.pos, size=badge.size, radius=[self.BADGE_H // 2])
        def _sync_badge(_w, *_):
            self._badge_bg.pos = _w.pos
            self._badge_bg.size = _w.size
        badge.bind(pos=_sync_badge, size=_sync_badge)
        badge.color = self._badge_palette()[1]
        self._badge = badge
        # Vertically centre the badge within the taller chip row.
        badge_wrap = AnchorLayout(anchor_x='center', anchor_y='center',
                                  size_hint=(None, 1), width=self.BADGE_W)
        badge_wrap.add_widget(badge)
        self.add_widget(badge_wrap)

        action = Label(
            text=action_text, font_size='12sp', color=theme.TEXT_PRIMARY,
            halign='left', valign='middle', shorten=True,
            shorten_from='right',
        )
        action.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self._action = action
        self.add_widget(action)

    def _badge_palette(self) -> Tuple[Any, Any]:
        if self._active:
            return (theme.ACCENT, (1, 1, 1, 1))
        if self._kind == 'primary':
            return (theme.ACCENT_BG, theme.BLUE_900)
        if self._kind == 'secondary':
            return _STYLUS_BADGE_PALETTE['secondary']
        return (theme.GRAY_300, theme.TEXT_PRIMARY)

    def _sync_bg(self, *_args) -> None:
        self._bg.pos = self.pos
        self._bg.size = self.size

    def set_active(self, active: bool) -> None:
        if active == self._active:
            return
        self._active = active
        if active:
            self._bg_color.rgba = theme.ACCENT_BG
        else:
            self._bg_color.rgba = theme.BG_SURFACE_ALT
        bg, fg = self._badge_palette()
        self._badge_bg_color.rgba = bg
        self._badge.color = fg


class _StringStripWidget(Widget):
    """Mini horizontal string visualizer for the Performance panel.

    Vertical lines for each configured string (evenly spaced across the
    width), note labels along the bottom, and a pen-position dot that
    tracks the tablet's ``x`` (turns red on contact). Mirrors the web's
    ``.ps-container`` block.
    """

    LINE_TOP_MARGIN = 6
    LINE_BOTTOM_MARGIN = 28
    LABEL_HEIGHT = 18

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._notes: list = []
        self._labels: list = []
        self._plucked: int = -1
        self._pen_x: float = 0.0
        self._pen_pressure: float = 0.0
        self._pen_in_range: bool = False

        with self.canvas:
            self._baseline_color = Color(*theme.GRAY_300)
            self._baseline = Line(points=[0, 0, 0, 0], width=1.0)
        self._string_color = None
        self._string_lines: list = []
        with self.canvas:
            self._pen_color = Color(0.45, 0.75, 1.0, 0.0)
            self._pen_dot = Ellipse(pos=(0, 0), size=(0, 0))

        self.bind(pos=self._redraw, size=self._redraw)

    def set_notes(self, notes: list) -> None:
        self._notes = list(notes or [])
        self._redraw()

    def set_plucked(self, idx: int) -> None:
        self._plucked = int(idx) if idx is not None else -1
        self._redraw()

    def update_pen(self, x: float, pressure: float, in_range: bool) -> None:
        self._pen_x = max(0.0, min(1.0, float(x or 0.0)))
        self._pen_pressure = max(0.0, min(1.0, float(pressure or 0.0)))
        self._pen_in_range = bool(in_range)
        self._update_pen_only()

    def _redraw(self, *_args) -> None:
        for line in self._string_lines:
            self.canvas.remove(line)
        # Sweep every Label child rather than just the tracked ones so
        # a stale label from a previous note set (chord change,
        # progression step, etc.) can't survive the redraw and stack
        # on top of the freshly drawn ones.
        for child in list(self.children):
            if isinstance(child, Label):
                self.remove_widget(child)
        self._string_lines.clear()
        self._labels.clear()

        x0, y0, w, h = self.x, self.y, self.width, self.height
        baseline_y = y0 + self.LABEL_HEIGHT + 4
        self._baseline.points = [x0, baseline_y, x0 + w, baseline_y]

        n = len(self._notes)
        if n == 0 or w <= 0 or h <= 0:
            self._update_pen_only()
            return

        top = y0 + h - self.LINE_TOP_MARGIN
        bot = y0 + self.LINE_BOTTOM_MARGIN
        for i, note in enumerate(self._notes):
            sx = x0 + ((i + 1) / (n + 1)) * w
            plucked = (i == self._plucked)
            with self.canvas:
                Color(*(theme.STATUS_CONNECTED if plucked else theme.GRAY_500))
                line = Line(points=[sx, bot, sx, top],
                            width=1.6 if plucked else 1.0)
            self._string_lines.append(line)

            label_text = f"{note.get('notation', '')}{note.get('octave', '')}"
            lbl = Label(
                text=label_text, font_size='12sp', bold=plucked,
                color=(theme.STATUS_CONNECTED if plucked else theme.TEXT_MUTED),
                size_hint=(None, None), size=(72, self.LABEL_HEIGHT),
                pos=(sx - 36, y0 + 2), halign='center', valign='middle',
            )
            lbl.bind(size=lambda w_, *_: setattr(w_, 'text_size', w_.size))
            self._labels.append(lbl)
            self.add_widget(lbl)

        self._update_pen_only()

    def _update_pen_only(self) -> None:
        x0, y0, w, h = self.x, self.y, self.width, self.height
        if not self._pen_in_range or w <= 0 or h <= 0:
            self._pen_color.a = 0.0
            return
        cx = x0 + self._pen_x * w
        cy = y0 + self.LABEL_HEIGHT + 4
        is_contact = self._pen_pressure > 0.0
        r = 8.0 if is_contact else 6.0
        if is_contact:
            self._pen_color.rgba = (1.0, 0.42, 0.42,
                                    max(0.4, self._pen_pressure))
        else:
            self._pen_color.rgba = (0.45, 0.75, 1.0, 0.6)
        self._pen_dot.pos = (cx - r, cy - r)
        self._pen_dot.size = (r * 2, r * 2)


class PerformancePanel(BoxLayout):
    """Active button-mappings list above a mini string strip.

    Mirrors the web Performance panel: an "active mappings" region
    listing each configured stylus / numeric-button -> action with
    live highlight when the button is pressed, and a horizontal
    string strip showing the configured tuning with a pen indicator
    tracking ``tabletData.x``.
    """

    _BUTTON_COLUMNS = 3

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._notes: list = []
        self._stylus: list = []
        self._buttons: list = []
        self._pressed: set = set()
        self._stylus_chips: dict = {}
        self._button_chips: dict = {}

        self._mappings_scroll = ScrollView(do_scroll_x=False, bar_width=4)
        self._mappings_container = BoxLayout(
            orientation='vertical', size_hint_y=None,
            spacing=theme.SPACE_1, padding=(0, theme.SPACE_1),
        )
        self._mappings_container.bind(
            minimum_height=self._mappings_container.setter('height'))
        self._mappings_scroll.add_widget(self._mappings_container)
        # Re-pack columns when the viewport height changes so column 1
        # absorbs as many chips as fits before spilling to column 2/3.
        self._mappings_scroll.bind(height=self._relayout_buttons)
        self.add_widget(self._mappings_scroll)

        self._strip = _StringStripWidget(size_hint_y=None, height=64)
        self.add_widget(self._strip)

        self._render_mappings()

        if bridge is not None:
            bridge.on('config', self._on_config)
            bridge.on('tablet', self._on_tablet)
            bridge.on('strum', self._on_strum)

    def _on_config(self, payload: Any) -> None:
        mappings = extract_button_mappings(payload)
        self._stylus = mappings['stylus']
        self._buttons = mappings['buttons']
        self._notes = extract_notes(payload)
        self._render_mappings()
        self._strip.set_notes(self._notes)

    def _on_tablet(self, ev: Any) -> None:
        pressed: set = set()
        if getattr(ev, 'primaryButtonPressed', False):
            pressed.add('primary')
        if getattr(ev, 'secondaryButtonPressed', False):
            pressed.add('secondary')
        for key, val in (getattr(ev, 'buttons', {}) or {}).items():
            if val and isinstance(key, str) and key.startswith('button'):
                try:
                    pressed.add(int(key[len('button'):]))
                except ValueError:
                    continue
        if pressed != self._pressed:
            self._pressed = pressed
            self._refresh_active_states()

        x = float(getattr(ev, 'x', 0.0) or 0.0)
        y = float(getattr(ev, 'y', 0.0) or 0.0)
        pressure = float(getattr(ev, 'pressure', 0.0) or 0.0)
        self._strip.update_pen(x, pressure, in_range=(x > 0 or y > 0))

    def _on_strum(self, strum: Any) -> None:
        notes = list(getattr(strum, 'notes', []) or [])
        if not notes or not self._notes:
            return
        first = notes[0]
        name = getattr(first, 'name', None)
        octave = getattr(first, 'octave', None)
        for i, n in enumerate(self._notes):
            if n.get('notation') == name and n.get('octave') == octave:
                self._strip.set_plucked(i)
                return

    def _render_mappings(self) -> None:
        self._mappings_container.clear_widgets()
        self._stylus_chips.clear()
        self._button_chips.clear()

        if not self._stylus and not self._buttons:
            empty = Label(
                text='No button mappings configured',
                color=theme.TEXT_MUTED, font_size='8.5sp', italic=True,
                size_hint_y=None, height=32,
                halign='center', valign='middle',
            )
            empty.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
            self._mappings_container.add_widget(empty)
            return

        if self._stylus:
            row = BoxLayout(orientation='horizontal', spacing=theme.SPACE_2,
                            size_hint_y=None, height=_MappingChip.HEIGHT)
            for s in self._stylus:
                kind = s['kind']
                badge_text = 'P' if kind == 'primary' else 'S'
                chip = _MappingChip(badge_text, s['action'], kind=kind)
                chip.size_hint_x = 1
                row.add_widget(chip)
                self._stylus_chips[kind] = chip
            self._mappings_container.add_widget(row)

        if self._buttons:
            # Column-major holder. Columns are added lazily by
            # ``_relayout_buttons``: we fill column 1 to capacity before
            # spilling into column 2, then column 3 — small sets stay
            # readable as a single top-to-bottom list.
            self._buttons_holder = BoxLayout(
                orientation='horizontal', spacing=theme.SPACE_2,
                size_hint_y=None,
            )
            self._mappings_container.add_widget(self._buttons_holder)
            self._relayout_buttons()
        else:
            self._buttons_holder = None

        self._refresh_active_states()

    def _relayout_buttons(self, *_args) -> None:
        """Re-pack button chips column-major from the current viewport.

        ``rows_per_col`` is derived from the visible scroll height so the
        first column fills before spilling into the next; capped at
        :pyattr:`_BUTTON_COLUMNS` columns total.
        """
        holder = getattr(self, '_buttons_holder', None)
        if holder is None or not self._buttons:
            return
        holder.clear_widgets()
        self._button_chips.clear()

        row_height = _MappingChip.HEIGHT + theme.SPACE_2
        stylus_row = (_MappingChip.HEIGHT + theme.SPACE_1) if self._stylus else 0
        available = max(row_height,
                        int(self._mappings_scroll.height) - stylus_row
                        - 2 * theme.SPACE_1)
        rows_per_col = max(1, available // row_height)
        cols_needed = min(self._BUTTON_COLUMNS,
                          (len(self._buttons) + rows_per_col - 1) // rows_per_col)
        # Recompute rows-per-col after capping the column count so the
        # last column doesn't get a disproportionate share when the set
        # exceeds 3 * rows_per_col.
        rows_per_col = max(rows_per_col,
                           (len(self._buttons) + cols_needed - 1) // cols_needed)
        holder.height = rows_per_col * row_height

        for c in range(cols_needed):
            col = BoxLayout(orientation='vertical', spacing=theme.SPACE_2,
                            size_hint_x=1)
            chunk = self._buttons[c * rows_per_col:(c + 1) * rows_per_col]
            for b in chunk:
                chip = _MappingChip(str(b['buttonNum']), b['action'],
                                    kind='button')
                col.add_widget(chip)
                self._button_chips[b['buttonNum']] = chip
            for _ in range(rows_per_col - len(chunk)):
                col.add_widget(Widget(size_hint_y=None,
                                      height=_MappingChip.HEIGHT))
            holder.add_widget(col)
        self._refresh_active_states()

    def _refresh_active_states(self) -> None:
        for kind, chip in self._stylus_chips.items():
            chip.set_active(kind in self._pressed)
        for num, chip in self._button_chips.items():
            chip.set_active(num in self._pressed)


# ---- Visualizer helpers --------------------------------------------------

def fit_tablet_rect(
    container: tuple, aspect: float = 16.0 / 10.0, margin: int = 8,
    align: str = 'center',
) -> tuple:
    """Return ``(x, y, w, h)`` for a tablet body that preserves ``aspect``
    inside ``container = (cx, cy, cw, ch)``, with ``margin`` padding.

    ``align`` controls horizontal placement when the fitted width is
    less than the container width: ``'center'`` (default) splits the
    leftover space evenly, ``'left'`` anchors the body to the container's
    left edge (used by the combined Tablet/Stylus panel to keep the
    strings flush-left so the stylus visualizer can claim the
    horizontal remainder)."""
    cx, cy, cw, ch = container
    cw = max(0, cw - 2 * margin)
    ch = max(0, ch - 2 * margin)
    if cw <= 0 or ch <= 0:
        return (cx + margin, cy + margin, 0, 0)
    if cw / ch > aspect:
        h = ch
        w = h * aspect
    else:
        w = cw
        h = w / aspect
    if align == 'left':
        x = cx + margin
    else:
        x = cx + margin + (cw - w) / 2.0
    y = cy + margin + (ch - h) / 2.0
    return (x, y, w, h)


def tablet_to_screen(
    nx: float, ny: float, area: tuple,
) -> tuple:
    """Map normalised tablet coords (``nx, ny`` in 0..1, origin top-left)
    to Kivy screen coords (``area = (x, y, w, h)``, origin bottom-left)."""
    ax, ay, aw, ah = area
    nx = max(0.0, min(1.0, nx))
    ny = max(0.0, min(1.0, ny))
    px = ax + nx * aw
    py = ay + (1.0 - ny) * ah
    return (px, py)


# ---- Visualizer widgets --------------------------------------------------

class _TabletCanvas(Widget):
    """Draws the tablet body, active area, optional string overlay, and a
    pen position dot. Instructions are persistent and mutated in place so
    high-frequency tablet events don't trigger canvas rebuilds."""

    def __init__(self, align: str = 'center', **kwargs) -> None:
        super().__init__(**kwargs)
        self._align = align
        self._notes: list = []
        self._last_event: Any = None
        self._area: tuple = (0, 0, 0, 0)

        with self.canvas:
            self._body_color = Color(*theme.GRAY_300)
            self._body_rect = Rectangle()
            self._surface_color = Color(*theme.GRAY_100)
            self._surface_rect = Rectangle()
        self._string_color = None
        self._string_lines: list = []
        self._string_labels: list = []
        with self.canvas:
            self._pen_color = Color(0.45, 0.75, 1.0, 0.0)  # hidden until first event
            self._pen_dot = Ellipse(pos=(0, 0), size=(0, 0))

        self.bind(pos=self._redraw_static, size=self._redraw_static)

    def set_notes(self, notes: list) -> None:
        self._notes = list(notes or [])
        self._redraw_static()

    def update_event(self, ev: Any) -> None:
        self._last_event = ev
        self._update_pen()

    def _redraw_static(self, *_args) -> None:
        body = fit_tablet_rect((self.x, self.y, self.width, self.height),
                               margin=8, align=self._align)
        bx, by, bw, bh = body
        self._body_rect.pos = (bx, by)
        self._body_rect.size = (bw, bh)

        inset = 10
        ax = bx + inset
        ay = by + inset
        aw = max(0, bw - 2 * inset)
        ah = max(0, bh - 2 * inset)
        self._area = (ax, ay, aw, ah)
        self._surface_rect.pos = (ax, ay)
        self._surface_rect.size = (aw, ah)

        for line in self._string_lines:
            self.canvas.remove(line)
        # Sweep every Label child rather than just the tracked ones so
        # an orphan from a pre-layout _redraw_static pass (when the
        # canvas was still at its default (0,0,100,100) size and the
        # first ``config`` event arrived) can't survive a later redraw
        # and leave a stack of ghost note labels in the bottom-left.
        for child in list(self.children):
            if isinstance(child, Label):
                self.remove_widget(child)
        self._string_lines.clear()
        self._string_labels.clear()

        n = len(self._notes)
        if n > 0 and aw > 0 and ah > 0:
            spacing = aw / (n + 1)
            label_w = 80
            label_h = 28
            label_y = ay + 4
            line_bottom = label_y + label_h + 12
            line_top = ay + ah - 16
            # Snap x to an integer so every string lands on the same
            # pixel column and Kivy's GL line antialiasing renders them
            # at a consistent shade \u2014 fractional coords cause adjacent
            # strings to read as slightly different greys.
            xs = [int(round(ax + spacing * (i + 1))) + 0.5 for i in range(n)]
            with self.canvas:
                Color(*theme.GRAY_500)
                for sx in xs:
                    line = Line(points=[sx, line_bottom, sx, line_top], width=1.0)
                    self._string_lines.append(line)
            # Label widgets are constructed and parented OUTSIDE the
            # ``with self.canvas:`` block. Inside that block, any canvas
            # instructions emitted as a side effect of ``add_widget`` /
            # the Label's first ``texture_update`` (Color + Rectangle for
            # the rendered glyphs) would be routed into ``self.canvas``
            # instead of ``lbl.canvas`` \u2014 ``remove_widget`` then cannot
            # clean them up, and every chord change leaves an extra
            # ghost-text rendering behind on the canvas.
            for i, note in enumerate(self._notes):
                sx = xs[i]
                name = str(note.get('notation', '?')) if isinstance(note, dict) else getattr(note, 'notation', '?')
                octave = note.get('octave', '') if isinstance(note, dict) else getattr(note, 'octave', '')
                lbl = Label(
                    text=f'{name}{octave}', font_size='13.5sp',
                    color=theme.TEXT_MUTED,
                    size_hint=(None, None), size=(label_w, label_h),
                    pos=(sx - label_w / 2, label_y),
                )
                self._string_labels.append(lbl)
                self.add_widget(lbl)

        self._update_pen()

    def _update_pen(self) -> None:
        ev = self._last_event
        ax, ay, aw, ah = self._area
        if ev is None or aw <= 0 or ah <= 0:
            self._pen_color.a = 0.0
            return
        x = float(getattr(ev, 'x', 0.0) or 0.0)
        y = float(getattr(ev, 'y', 0.0) or 0.0)
        pressure = float(getattr(ev, 'pressure', 0.0) or 0.0)
        in_range = (x != 0.0 or y != 0.0)
        if not in_range:
            self._pen_color.a = 0.0
            return
        px, py = tablet_to_screen(x, y, self._area)
        if pressure > 0.0:
            r = 12
            self._pen_color.rgba = (1.0, 0.42, 0.42, max(0.3, min(1.0, pressure)))
        else:
            r = 8
            self._pen_color.rgba = (0.45, 0.75, 1.0, 0.6)
        self._pen_dot.pos = (px - r, py - r)
        self._pen_dot.size = (r * 2, r * 2)


class _StylusCanvas(Widget):
    """Draws a pen-tip + tilt vector + pressure ring. The vector length
    encodes tilt magnitude (``sqrt(tiltX**2 + tiltY**2)``) and the ring
    radius encodes pressure."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._last_event: Any = None
        with self.canvas:
            self._pad_color = Color(*theme.GRAY_300)
            self._pad_rect = Rectangle()
            self._ring_color = Color(1.0, 0.42, 0.42, 0.0)
            self._ring = Line(circle=(0, 0, 0), width=2.0)
            self._tilt_color = Color(0.45, 0.75, 1.0, 0.0)
            self._tilt_line = Line(points=[0, 0, 0, 0], width=2.0)
            self._tip_color = Color(*theme.TEXT_PRIMARY)
            self._tip = Ellipse(pos=(0, 0), size=(8, 8))
        self.bind(pos=self._redraw, size=self._redraw)

    def update_event(self, ev: Any) -> None:
        self._last_event = ev
        self._redraw()

    def _redraw(self, *_args) -> None:
        bx, by, bw, bh = fit_tablet_rect(
            (self.x, self.y, self.width, self.height), aspect=1.0, margin=8,
        )
        self._pad_rect.pos = (bx, by)
        self._pad_rect.size = (bw, bh)

        cx = bx + bw / 2.0
        cy = by + bh / 2.0
        radius_max = max(0.0, min(bw, bh) / 2.0 - 8)

        ev = self._last_event
        if ev is None or radius_max <= 0:
            self._ring_color.a = 0.0
            self._tilt_color.a = 0.0
            self._tip.pos = (cx - 4, cy - 4)
            return

        pressure = float(getattr(ev, 'pressure', 0.0) or 0.0)
        tilt_x = float(getattr(ev, 'tiltX', 0.0) or 0.0)
        tilt_y = float(getattr(ev, 'tiltY', 0.0) or 0.0)
        tilt_mag = min(1.0, (tilt_x * tilt_x + tilt_y * tilt_y) ** 0.5)

        if pressure > 0.0:
            ring_r = max(4.0, pressure * radius_max)
            self._ring_color.rgba = (1.0, 0.42, 0.42, max(0.3, min(1.0, pressure)))
            self._ring.circle = (cx, cy, ring_r)
        else:
            self._ring_color.a = 0.0

        end_x = cx + tilt_x * radius_max
        end_y = cy - tilt_y * radius_max
        if tilt_mag > 0.001:
            self._tilt_color.rgba = (0.45, 0.75, 1.0, 0.9)
            self._tilt_line.points = [cx, cy, end_x, end_y]
            self._tilt_line.width = 2.0 + tilt_mag * 3.0
        else:
            self._tilt_color.a = 0.0

        self._tip.pos = (cx - 4, cy - 4)


class TabletVisualizerPanel(BoxLayout):
    """Top-down tablet view (strings + pen) flanked by the stylus
    pressure / tilt visualizer.

    Combines what used to be two separate panels: the tablet body
    sits flush-left so the string layout matches the physical tablet,
    and the stylus pad claims the horizontal remainder. A single
    readout row below carries ``X / Y / P / TX / TY``."""

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_2, **kwargs)

        row = BoxLayout(orientation='horizontal', spacing=theme.SPACE_3)
        self._canvas_widget = _TabletCanvas(align='left', size_hint_x=3)
        row.add_widget(self._canvas_widget)
        self._stylus_widget = _StylusCanvas(size_hint_x=1)
        row.add_widget(self._stylus_widget)
        self.add_widget(row)

        self._readout = Label(
            text='X —   Y —   P —   TX —   TY —',
            color=theme.TEXT_SECONDARY,
            font_size='8sp', size_hint_y=None, height=20,
            halign='center', valign='middle',
        )
        self._readout.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._readout)

        if bridge is not None:
            bridge.on('tablet', self._on_tablet)
            bridge.on('config', self._on_config)

    def _on_tablet(self, ev: Any) -> None:
        self._canvas_widget.update_event(ev)
        self._stylus_widget.update_event(ev)
        self._readout.text = (
            f'X {format_value(getattr(ev, "x", None))}   '
            f'Y {format_value(getattr(ev, "y", None))}   '
            f'P {format_value(getattr(ev, "pressure", None))}   '
            f'TX {format_value(getattr(ev, "tiltX", None))}   '
            f'TY {format_value(getattr(ev, "tiltY", None))}'
        )

    def _on_config(self, config: Any) -> None:
        notes = []
        if isinstance(config, dict):
            notes = config.get('notes') or []
        self._canvas_widget.set_notes(notes)


class MidiDevicesPanel(BoxLayout):
    """Lists available MIDI input and output ports with select / toggle
    controls. Subscribes to ``'midi-devices'`` and requests a snapshot
    at construction so the panel is populated as soon as it's shown."""

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._current_output: Optional[str] = None
        self._current_output_id: Any = None
        self._current_inputs: set = set()
        self._passthrough: list = []

        header = BoxLayout(orientation='horizontal', size_hint_y=None,
                           height=theme.INPUT_HEIGHT, spacing=theme.SPACE_2)
        self._status = Label(
            text='Loading MIDI devices…', color=theme.TEXT_SECONDARY,
            font_size='8.5sp', halign='left', valign='middle',
        )
        self._status.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        header.add_widget(self._status)
        header.add_widget(_accent_button(
            'Refresh', self._refresh,
            width=theme.INPUT_HEIGHT, height=theme.INPUT_HEIGHT,
            radius=theme.INPUT_HEIGHT // 2,
            painter=_draw_refresh))
        self.add_widget(header)

        body = BoxLayout(orientation='horizontal', spacing=theme.SPACE_5)
        self._inputs_box = self._make_section('Inputs')
        self._outputs_box = self._make_section('Outputs')
        body.add_widget(self._inputs_box['root'])
        # Stretch-height rule clipped at the top so it starts at the top
        # of the lists rather than the section headers. ``top_inset``
        # equals the header height plus the header-to-list gap used by
        # ``_make_section``.
        body.add_widget(_vdivider(
            width=theme.SPACE_2,
            top_inset=theme.FIELD_LABEL_HEIGHT + theme.SPACE_4,
            bottom_inset=0,
        ))
        body.add_widget(self._outputs_box['root'])
        self.add_widget(body)

        if bridge is not None:
            bridge.on('midi-devices', self._on_midi_devices)
            bridge.request_midi_devices()

    def _make_section(self, title: str) -> dict:
        root = BoxLayout(orientation='vertical', spacing=theme.SPACE_4)
        header = Label(
            text=f'[b]{title}[/b]', markup=True, color=theme.TEXT_PRIMARY,
            font_size='10.5sp', size_hint_y=None,
            height=theme.FIELD_LABEL_HEIGHT,
            halign='left', valign='middle',
        )
        header.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        root.add_widget(header)
        scroll = ScrollView(do_scroll_x=False, bar_width=4)
        items = BoxLayout(orientation='vertical', size_hint_y=None,
                          spacing=theme.SPACE_2, padding=(0, 0))
        items.bind(minimum_height=items.setter('height'))
        scroll.add_widget(items)
        root.add_widget(scroll)
        return {'root': root, 'items': items}

    def _refresh(self) -> None:
        if self._bridge is not None:
            self._bridge.request_midi_devices()

    def _on_midi_devices(self, data: Any) -> None:
        if not isinstance(data, dict):
            return
        output_ports = data.get('outputPorts') or []
        input_ports = data.get('inputPorts') or []
        current_output_id = data.get('currentOutputPort')
        current_input_ids = set(data.get('currentInputPorts') or [])
        self._current_inputs = set(current_input_ids)
        self._current_output_id = current_output_id
        self._passthrough = list(data.get('passthroughConnections') or [])

        self._current_output = None
        for p in output_ports:
            if p.get('id') == current_output_id:
                self._current_output = p.get('name')
                break

        self._status.text = (
            f'{len(input_ports)} input · {len(output_ports)} output'
        )
        self._populate_outputs(output_ports, current_output_id)
        self._populate_inputs(input_ports, self._current_inputs)

    def _populate_outputs(self, ports: list, current_id: Any) -> None:
        items = self._outputs_box['items']
        items.clear_widgets()
        if not ports:
            items.add_widget(_empty_row('No output ports'))
            return
        for port in ports:
            pid = port.get('id')
            name = port.get('name', '?')
            if port.get('virtual'):
                items.add_widget(_virtual_device_row(name))
            else:
                is_active = pid == current_id
                row = _device_row(
                    name, pid, is_active,
                    on_toggle=lambda new, n=name: self._toggle_output(n, new))
                items.add_widget(row)

    def _populate_inputs(self, ports: list, current_ids: set) -> None:
        items = self._inputs_box['items']
        items.clear_widgets()
        if not ports:
            items.add_widget(_empty_row('No input ports'))
            return
        has_output = self._current_output_id is not None
        passthrough_ids = {c.get('inputPort') for c in self._passthrough}
        for port in ports:
            pid = port.get('id')
            name = port.get('name', '?')
            is_active = pid in current_ids
            show_pt = is_active and has_output
            pt_active = pid in passthrough_ids
            row = _device_row(
                name, pid, is_active,
                on_toggle=lambda _new, i=pid: self._toggle_input(i),
                passthrough_visible=show_pt,
                passthrough_active=pt_active,
                on_passthrough_toggle=(
                    lambda new, i=pid: self._toggle_passthrough(i, new)),
            )
            items.add_widget(row)

    def _toggle_output(self, name: str, new_state: bool) -> None:
        # Mirrors the web ``handleOutputToggle``: toggling on selects the
        # port, toggling off clears the selection (``midiOutputId=None``
        # disconnects on the backend). ``set_midi_output`` ignores
        # ``None``, so the off case goes through ``set_config`` directly.
        if self._bridge is None:
            return
        if new_state:
            self._bridge.set_midi_output(name)
        else:
            self._bridge.set_config('midi.midiOutputId', None)

    def _toggle_input(self, port_id: Any) -> None:
        if self._bridge is None:
            return
        ids = set(self._current_inputs)
        if port_id in ids:
            ids.discard(port_id)
        else:
            ids.add(port_id)
        # Optimistic local update; broadcast will overwrite shortly.
        self._current_inputs = ids
        self._bridge.set_midi_input(sorted(ids))

    def _toggle_passthrough(self, input_port_id: Any, new_state: bool) -> None:
        # Mirrors the web ``handlePassthroughToggle``: on adds a
        # ``{inputPort, outputPort}`` connection targeting the current
        # output; off filters out any connection for this input.
        if self._bridge is None:
            return
        if new_state:
            if self._current_output_id is None:
                return
            new_list = [c for c in self._passthrough
                        if c.get('inputPort') != input_port_id]
            new_list.append({'inputPort': input_port_id,
                             'outputPort': self._current_output_id})
        else:
            new_list = [c for c in self._passthrough
                        if c.get('inputPort') != input_port_id]
        self._passthrough = new_list
        self._bridge.set_config('midi.midiPassthrough', new_list)


def _empty_row(text: str) -> Label:
    lbl = Label(
        text=text, color=theme.TEXT_MUTED, font_size='8sp',
        size_hint_y=None, height=26, halign='left', valign='middle',
    )
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _port_button(name: str, active: bool) -> Button:
    return Button(
        text=('● ' + name) if active else ('○ ' + name),
        size_hint_y=None, height=30,
        background_normal='', background_down='',
        background_color=(theme.ACCENT_BG if active else theme.BG_SURFACE_ALT),
        color=(theme.TEXT_PRIMARY if active else theme.TEXT_SECONDARY),
        font_size='8sp', halign='left', valign='middle',
    )


def _toggle_switch(active: bool, on_toggle,
                   width: int = 60, height: int = 32) -> Button:
    """Pill-shaped on/off switch with a white knob that slides across.

    Mirrors the web ``.toggle-slider``: gray track when off, green when
    on. The switch is a ``Button`` so it captures touches; the track and
    knob are painted on ``canvas.before`` / ``canvas.after`` and follow
    pos/size changes. Calls ``on_toggle(new_state)`` on each release."""
    radius = height // 2
    btn = Button(
        text='', size_hint=(None, None), size=(width, height),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0),
    )
    btn.active = bool(active)
    with btn.canvas.before:
        track_col = Color(*(theme.STATUS_CONNECTED if btn.active
                            else theme.STATUS_DISCONNECTED))
        track = RoundedRectangle(pos=btn.pos, size=btn.size, radius=[radius])
    with btn.canvas.after:
        Color(1, 1, 1, 1)
        pad = max(3, height // 8)
        knob_d = height - 2 * pad
        knob = Ellipse(pos=(btn.x + pad, btn.y + pad),
                       size=(knob_d, knob_d))

    def _repaint(*_):
        track.pos = btn.pos
        track.size = btn.size
        p = max(3, btn.height // 8)
        d = btn.height - 2 * p
        knob.size = (d, d)
        if btn.active:
            knob.pos = (btn.right - p - d, btn.y + p)
            track_col.rgba = theme.STATUS_CONNECTED
        else:
            knob.pos = (btn.x + p, btn.y + p)
            track_col.rgba = theme.STATUS_DISCONNECTED

    btn.bind(pos=_repaint, size=_repaint)

    def _on_release(*_):
        btn.active = not btn.active
        _repaint()
        on_toggle(btn.active)

    btn.bind(on_release=_on_release)
    return btn


def _virtual_device_row(name: str) -> BoxLayout:
    """Read-only card for a virtual MIDI port (no toggle switch)."""
    row = BoxLayout(orientation='horizontal', size_hint_y=None,
                    height=80, spacing=theme.SPACE_3,
                    padding=(theme.SPACE_3, theme.SPACE_2))
    with row.canvas.before:
        Color(*theme.BG_SURFACE_ALT)
        bg = RoundedRectangle(pos=row.pos, size=row.size,
                              radius=[theme.SPACE_2])

    def _sync_bg(*_):
        bg.pos = row.pos
        bg.size = row.size
    row.bind(pos=_sync_bg, size=_sync_bg)

    info = BoxLayout(orientation='vertical', padding=(0, theme.SPACE_1))
    name_lbl = Label(
        text=name, color=theme.TEXT_PRIMARY, font_size='10sp',
        halign='left', valign='middle',
    )
    name_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    badge_lbl = Label(
        text='Virtual', color=theme.STATUS_CONNECTED, font_size='8sp',
        halign='left', valign='top',
    )
    badge_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    info.add_widget(name_lbl)
    info.add_widget(badge_lbl)
    row.add_widget(info)
    return row


def _device_row(name: str, port_id: Any, active: bool,
                on_toggle, *,
                passthrough_visible: bool = False,
                passthrough_active: bool = False,
                on_passthrough_toggle=None) -> BoxLayout:
    """Web-UI-style MIDI device card: toggle switch on the left, device
    name above an ``Index: <id>`` caption on the right. The card has a
    neutral rounded background to give each item card-like shape; the
    on/off state is communicated solely by the switch.

    When ``passthrough_visible`` is true a secondary smaller switch
    labelled "Passthrough" appears under the index caption (mirrors the
    web inputs list which exposes per-input passthrough toggles when an
    output port is selected). The row exposes ``toggle_switch`` and
    ``passthrough_switch`` references so callers/tests can address each
    control unambiguously."""
    row_h = 76 if passthrough_visible else 52
    row = BoxLayout(orientation='horizontal', size_hint_y=None,
                    height=row_h, spacing=theme.SPACE_3,
                    padding=(theme.SPACE_3, theme.SPACE_2))
    with row.canvas.before:
        Color(*theme.BG_SURFACE_ALT)
        bg = RoundedRectangle(pos=row.pos, size=row.size,
                              radius=[theme.SPACE_2])

    def _sync_bg(*_):
        bg.pos = row.pos
        bg.size = row.size
    row.bind(pos=_sync_bg, size=_sync_bg)

    switch = _toggle_switch(active, on_toggle)
    row.toggle_switch = switch
    row.passthrough_switch = None
    # Top-align the switch with the device name rather than centering it
    # over the whole card (which drops it between the two rows when the
    # passthrough toggle is present).
    switch_wrap = AnchorLayout(anchor_x='center', anchor_y='top',
                               size_hint=(None, 1), width=switch.width)
    switch_wrap.add_widget(switch)
    row.add_widget(switch_wrap)

    info = BoxLayout(orientation='vertical', padding=(0, theme.SPACE_1))
    name_lbl = Label(
        text=name, color=theme.TEXT_PRIMARY, font_size='10sp',
        halign='left', valign='middle',
    )
    name_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    idx_lbl = Label(
        text=f'Index: {port_id}', color=theme.TEXT_MUTED, font_size='8sp',
        halign='left', valign='top',
    )
    idx_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    info.add_widget(name_lbl)
    info.add_widget(idx_lbl)

    if passthrough_visible:
        pt_row = BoxLayout(orientation='horizontal', size_hint_y=None,
                           height=28, spacing=theme.SPACE_2)
        pt_switch = _toggle_switch(
            passthrough_active,
            on_passthrough_toggle or (lambda _new: None),
            width=45, height=21)
        pt_switch.pos_hint = {'center_y': 0.5}
        row.passthrough_switch = pt_switch
        pt_row.add_widget(pt_switch)
        pt_lbl = Label(
            text='Passthrough', color=theme.TEXT_SECONDARY, font_size='8sp',
            halign='left', valign='middle',
        )
        pt_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        pt_row.add_widget(pt_lbl)
        info.add_widget(pt_row)

    row.add_widget(info)
    return row


_MIDI_INPUT_MODES: Tuple[Tuple[str, str], ...] = (
    ('Direct',      'direct'),
    ('Major Scale', 'majorScale'),
    ('Minor Scale', 'minorScale'),
    ('Auto Scale',  'autoScale'),
)
_MIDI_INPUT_MODE_LABELS = tuple(label for label, _ in _MIDI_INPUT_MODES)
_MIDI_INPUT_LABEL_TO_VALUE = {label: value for label, value in _MIDI_INPUT_MODES}
_MIDI_INPUT_VALUE_TO_LABEL = {value: label for label, value in _MIDI_INPUT_MODES}


def _status_badge(connected: bool) -> BoxLayout:
    """Pill-shaped 'connected'/'disconnected' indicator (dot + text).

    Mirrors the web ``.status-badge.small`` used by the MIDI Input panel
    header. Returns a ``BoxLayout`` so callers can keep references to
    the inner dot/label and mutate state in place."""
    row = BoxLayout(orientation='horizontal', size_hint=(None, None),
                    height=theme.CONTROL_HEIGHT,
                    spacing=theme.SPACE_2,
                    padding=(theme.SPACE_3, 0))
    row.dot = _status_dot(active=connected)
    # ``pos_hint`` keeps the fixed-size dot vertically centred against the
    # label text inside the horizontal BoxLayout (which would otherwise
    # park ``size_hint_y=None`` children at the bottom of the row).
    row.dot.pos_hint = {'center_y': 0.5}
    row.add_widget(row.dot)
    # No ``text_size`` binding: a constrained ``text_size`` would wrap the
    # label to its initial (tiny) width before the texture-size callback
    # had a chance to grow it. Let the label size to its texture directly.
    row.label = Label(
        text=('connected' if connected else 'disconnected'),
        color=theme.TEXT_PRIMARY, font_size='9.5sp', bold=True,
        size_hint=(None, None), pos_hint={'center_y': 0.5},
    )
    def _sync_label_size(w, ts):
        w.size = ts
    row.label.bind(texture_size=_sync_label_size)
    row.label.size = row.label.texture_size
    row.add_widget(row.label)
    def _sync_width(*_):
        row.width = (row.padding[0] + row.dot.width + row.spacing
                     + row.label.width + row.padding[2])
    row.label.bind(width=_sync_width)
    _sync_width()
    return row


class MIDIInputPanel(BoxLayout):
    """Native mirror of the web ``midi-input`` panel.

    Shows the backend's MIDI input status (connected/disconnected),
    the currently held notes (server-side, before any scale mapping),
    the active ``midi.inputMode``, and the source port name when the
    server has received at least one note event. Subscribes to
    ``'config'`` for the input mode and to ``'midi-input'`` for the
    note / port snapshots; requests a snapshot at construction so the
    panel renders current state on first open."""

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_4, **kwargs)
        self._bridge = bridge
        self._input_mode: str = 'direct'

        # Status badge — own row, left-aligned with a small top margin so
        # it doesn't kiss the panel header.
        self._badge = _status_badge(connected=False)
        badge_row = BoxLayout(orientation='horizontal', size_hint_y=None,
                              height=theme.CONTROL_HEIGHT + theme.SPACE_2,
                              padding=[0, theme.SPACE_2, 0, 0])
        badge_row.add_widget(self._badge)
        badge_row.add_widget(Widget())
        self.add_widget(badge_row)

        # Notes — field label above the value, matching the form rhythm
        # used in Strumming / Velocity / etc.
        self._notes_value = Label(
            text='—', color=theme.TEXT_PRIMARY,
            font_size=theme.INPUT_FONT_SIZE,
            size_hint_y=None, height=theme.INPUT_HEIGHT,
            halign='left', valign='middle',
        )
        self._notes_value.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(_setting_row('Notes', self._notes_value))

        # Input Mode — field label above a half-width, left-aligned dropdown.
        self._mode_dropdown = _dropdown(
            _MIDI_INPUT_MODE_LABELS,
            _MIDI_INPUT_VALUE_TO_LABEL.get(self._input_mode, _MIDI_INPUT_MODE_LABELS[0]),
            on_change=self._on_mode_change,
            width_hint=0.5,
        )
        self.add_widget(_setting_row('Input Mode', self._mode_dropdown))

        # Source caption — own row, only populated once a port is known.
        self._source_label = Label(
            text='', color=theme.TEXT_MUTED, font_size='8sp',
            size_hint_y=None, height=24,
            halign='left', valign='middle',
        )
        self._source_label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._source_label)

        self.add_widget(Widget())

        if bridge is not None:
            bridge.on('config', self._on_config)
            bridge.on('midi-input', self._on_midi_input)
            bridge.request_midi_input_status()

    # ---- Bridge events -----------------------------------------------

    def _on_config(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        midi_cfg = (payload.get('config') or {}).get('midi') or {}
        mode = midi_cfg.get('inputMode')
        if mode not in _MIDI_INPUT_VALUE_TO_LABEL:
            mode = 'direct'
        self._input_mode = mode
        target_label = _MIDI_INPUT_VALUE_TO_LABEL[mode]
        if self._mode_dropdown.text != target_label:
            self._mode_dropdown.text = target_label

    def _on_midi_input(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        connected = bool(payload.get('connected'))
        self._sync_badge(connected)
        notes = payload.get('notes') or []
        self._notes_value.text = ', '.join(notes) if notes else '—'
        port_name = payload.get('portName') or payload.get('connectedPort')
        self._source_label.text = f'from: {port_name}' if port_name else ''

    # ---- User actions ------------------------------------------------

    def _on_mode_change(self, label: str) -> None:
        value = _MIDI_INPUT_LABEL_TO_VALUE.get(label)
        if value is None or value == self._input_mode:
            return
        self._input_mode = value
        if self._bridge is not None:
            self._bridge.set_config('midi.inputMode', value)

    # ---- View sync ---------------------------------------------------

    def _sync_badge(self, connected: bool) -> None:
        text = 'connected' if connected else 'disconnected'
        if self._badge.label.text != text:
            self._badge.label.text = text
        color = theme.STATUS_CONNECTED if connected else theme.STATUS_DISCONNECTED
        dot = self._badge.dot
        for instr in list(dot.canvas.children):
            if isinstance(instr, Color):
                instr.rgba = color
                break



def extract_strumming(config_event: Any) -> dict:
    """Pull the strumming-relevant fields out of a ``'config'`` event.

    The bridge emits the full ``_get_config_data`` payload; the panel
    only needs ``mode``, ``pressureThreshold``, ``pressureBufferSize``,
    and ``invertX``. Missing fields fall back to schema defaults so the
    panel renders sensibly even when called with a partial payload.
    """
    if not isinstance(config_event, dict):
        return {'mode': 'strum', 'pressureThreshold': 0.1,
                'pressureBufferSize': 10, 'invertX': False}
    cfg = config_event.get('config') or {}
    strummer = cfg.get('strummer') or {}
    strumming = strummer.get('strumming') or {}
    return {
        'mode': strummer.get('mode', 'strum'),
        'pressureThreshold': float(strumming.get('pressureThreshold', 0.1)),
        'pressureBufferSize': int(strumming.get('pressureBufferSize', 10)),
        'invertX': bool(strumming.get('invertX', False)),
    }


class StrummingSettingsPanel(BoxLayout):
    """Mode selector + pressure stepper grid + invert-X toggle.

    Layout mirrors the web's ``.dashboard.compact .settings-form`` —
    label/control rows packed into a 2-column grid. Steppers commit on
    Enter / focus loss / +/− click; the backend reconfigures on every
    change so we keep the slider-era "no-op on unchanged" guard.
    """

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._state = extract_strumming(None)

        self.add_widget(self._build_form())
        self.add_widget(Widget())

        if bridge is not None:
            bridge.on('config', self._on_config)

    # ---- Form ---------------------------------------------------------

    def _build_form(self) -> GridLayout:
        form = _two_col_form()

        self._mode_strum = _mode_button('Strum', active=True)
        self._mode_slide = _mode_button('Slide', active=False)
        self._mode_strum.bind(on_release=lambda *_: self._select_mode('strum'))
        self._mode_slide.bind(on_release=lambda *_: self._select_mode('slide'))
        mode_buttons = BoxLayout(orientation='horizontal', size_hint=(None, None),
                                 height=theme.INPUT_HEIGHT, spacing=theme.SPACE_1)
        mode_buttons.bind(minimum_width=mode_buttons.setter('width'))
        mode_buttons.add_widget(self._mode_strum)
        mode_buttons.add_widget(self._mode_slide)
        form.add_widget(_inline_setting_row('Mode', mode_buttons))

        self._invert_btn = _mode_button('Off', active=False)
        self._invert_btn.bind(on_release=lambda *_: self._toggle_invert())
        form.add_widget(_inline_setting_row('Invert X', self._invert_btn))

        self._threshold_stepper = _NumberStepper(
            value=self._state['pressureThreshold'],
            min_value=0.0, max_value=1.0, step=0.01, decimals=3,
            on_commit=self._on_threshold_commit,
        )
        form.add_widget(_setting_row('Pressure threshold', self._threshold_stepper))

        self._buffer_stepper = _NumberStepper(
            value=self._state['pressureBufferSize'],
            min_value=1, max_value=40, step=1, decimals=0,
            on_commit=self._on_buffer_commit,
        )
        form.add_widget(_setting_row('Buffer size', self._buffer_stepper))

        return form

    # ---- Events from the bridge --------------------------------------

    def _on_config(self, payload: Any) -> None:
        state = extract_strumming(payload)
        self._state = state
        self._sync_mode_buttons(state['mode'])
        self._threshold_stepper.set_value(state['pressureThreshold'])
        self._buffer_stepper.set_value(state['pressureBufferSize'])
        self._sync_invert_button(state['invertX'])

    # ---- User actions -------------------------------------------------

    def _select_mode(self, mode: str) -> None:
        if mode == self._state.get('mode'):
            return
        self._state['mode'] = mode
        self._sync_mode_buttons(mode)
        if self._bridge is not None:
            self._bridge.set_config('strummer.mode', mode)

    def _toggle_invert(self) -> None:
        new_value = not bool(self._state.get('invertX'))
        self._state['invertX'] = new_value
        self._sync_invert_button(new_value)
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumming.invertX', new_value)

    def _on_threshold_commit(self, value: float) -> None:
        if value == self._state.get('pressureThreshold'):
            return
        self._state['pressureThreshold'] = value
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumming.pressureThreshold', value)

    def _on_buffer_commit(self, value: float) -> None:
        v = int(value)
        if v == self._state.get('pressureBufferSize'):
            return
        self._state['pressureBufferSize'] = v
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumming.pressureBufferSize', v)

    # ---- View sync helpers -------------------------------------------

    def _sync_mode_buttons(self, mode: str) -> None:
        _set_mode_button_active(self._mode_strum, mode == 'strum')
        _set_mode_button_active(self._mode_slide, mode == 'slide')

    def _sync_invert_button(self, on: bool) -> None:
        self._invert_btn.text = 'On' if on else 'Off'
        _set_mode_button_active(self._invert_btn, on)


def _setting_label(text: str) -> Label:
    lbl = Label(text=text, color=theme.TEXT_SECONDARY, font_size='9.5sp',
                halign='left', valign='middle')
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _value_readout(initial: str) -> Label:
    lbl = Label(text=initial, color=theme.TEXT_PRIMARY, font_size='9.5sp',
                size_hint_x=None, width=80,
                halign='right', valign='middle')
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _mode_button(text: str, active: bool) -> Button:
    return Button(
        text=text, size_hint=(None, None), size=(156, theme.INPUT_HEIGHT),
        pos_hint={'center_y': 0.5},
        background_normal='', background_down='',
        background_color=(theme.ACCENT_BG if active else theme.BG_SURFACE_ALT),
        color=(theme.TEXT_PRIMARY if active else theme.TEXT_SECONDARY),
        font_size=theme.INPUT_FONT_SIZE,
    )


def _set_mode_button_active(btn: Button, active: bool) -> None:
    btn.background_color = theme.ACCENT_BG if active else theme.BG_SURFACE_ALT
    btn.color = theme.TEXT_PRIMARY if active else theme.TEXT_SECONDARY


CONTROL_SOURCES: Tuple[str, ...] = (
    'pressure', 'tiltX', 'tiltY', 'tiltXY',
    'xaxis', 'yaxis', 'velocity', 'none',
)

SPREAD_TYPES: Tuple[str, ...] = ('direct', 'inverse', 'central')


@dataclass(frozen=True)
class ParameterMappingSpec:
    """Per-field bounds/labels for a :class:`ParameterMappingPanel`.

    ``field`` is the camelCase strummer attribute name used to build the
    config-update path (e.g. ``'noteVelocity'`` -> ``'strummer.noteVelocity.min'``).
    ``is_integer`` controls slider stepping + value rounding so that
    velocity stays on whole MIDI values while duration/pitch stay smooth.
    ``curve_color`` is the RGBA used to paint the curve in the
    :class:`_CurveVisualizer`; mirrors the per-panel hue in
    ``sketchatone-dashboard.ts``.
    """
    field: str
    title: str
    min_bound: Tuple[float, float]
    max_bound: Tuple[float, float]
    multiplier_bound: Tuple[float, float] = (0.0, 4.0)
    curve_bound: Tuple[float, float] = (0.1, 8.0)
    is_integer: bool = False
    decimals: int = 3
    output_label: str = 'Output'
    curve_color: Tuple[float, float, float, float] = (0.32, 0.81, 0.40, 1.0)
    defaults: Dict[str, Any] = None  # type: ignore[assignment]


PARAMETER_MAPPING_SPECS: Dict[str, ParameterMappingSpec] = {
    'noteVelocity': ParameterMappingSpec(
        field='noteVelocity', title='Velocity',
        min_bound=(0, 127), max_bound=(0, 127),
        is_integer=True, decimals=3,
        output_label='Velocity',
        curve_color=theme.hex_to_rgba('#51cf66'),
        defaults={'min': 0, 'max': 127, 'multiplier': 1.0, 'curve': 4.0,
                  'spread': 'direct', 'control': 'pressure', 'default': 64},
    ),
    'noteDuration': ParameterMappingSpec(
        field='noteDuration', title='Duration',
        min_bound=(0.0, 5.0), max_bound=(0.0, 10.0),
        decimals=2,
        output_label='Duration',
        curve_color=theme.hex_to_rgba('#f59f00'),
        defaults={'min': 0.15, 'max': 1.5, 'multiplier': 1.0, 'curve': 1.0,
                  'spread': 'inverse', 'control': 'tiltXY', 'default': 1.0},
    ),
    'pitchBend': ParameterMappingSpec(
        field='pitchBend', title='Pitch',
        min_bound=(-2.0, 2.0), max_bound=(-2.0, 2.0),
        decimals=2,
        output_label='Bend',
        curve_color=theme.hex_to_rgba('#339af0'),
        defaults={'min': -1.0, 'max': 1.0, 'multiplier': 1.0, 'curve': 4.0,
                  'spread': 'central', 'control': 'yaxis', 'default': 0.0},
    ),
}


def calculate_curve_output(min_v: float, max_v: float, curve: float,
                           spread: str, t: float) -> float:
    """Compute the mapped output value for normalized input ``t`` (0..1).

    Mirrors ``curve-visualizer.ts:calculateOutputValue`` exactly so the
    Kivy graph and the web graph draw the same shape for identical
    config.
    """
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    exponent = max(float(curve), 1e-6)
    span = float(max_v) - float(min_v)
    if spread == 'central':
        distance = abs(t - 0.5) * 2.0
        return float(max_v) - (distance ** exponent) * span
    if spread == 'inverse':
        return float(max_v) - (t ** exponent) * span
    return float(min_v) + (t ** exponent) * span


def hover_position_from_tablet(control: str, ev: Any) -> Optional[float]:
    """Return the 0..1 hover position for ``control`` given a tablet event.

    Mirrors ``curve-visualizer.ts:getHoverPositionFromController``. The
    web build reads from a shared interaction controller; here we read
    straight off the tablet event payload. Returns ``None`` when the
    source isn't meaningful (pen lifted for pressure/tilt sources).
    """
    if ev is None:
        return None
    state = getattr(ev, 'state', None) or ''
    pressure = float(getattr(ev, 'pressure', 0.0) or 0.0)
    pressed = pressure > 0 or state in ('contact', 'pressed', 'down')
    if control == 'yaxis':
        return float(getattr(ev, 'y', 0.0) or 0.0)
    if control == 'xaxis':
        return float(getattr(ev, 'x', 0.0) or 0.0)
    if control == 'pressure':
        return pressure if pressed else None
    if control == 'tiltX':
        return (float(getattr(ev, 'tiltX', 0.0) or 0.0) + 1.0) / 2.0 if pressed else None
    if control == 'tiltY':
        return (float(getattr(ev, 'tiltY', 0.0) or 0.0) + 1.0) / 2.0 if pressed else None
    if control == 'tiltXY':
        return (float(getattr(ev, 'tiltXY', 0.0) or 0.0) + 1.0) / 2.0 if pressed else None
    return None


def extract_parameter_mapping(config_event: Any, field: str) -> dict:
    """Pull a single ParameterMapping (velocity/duration/pitch) from a
    ``'config'`` event. Returns the spec defaults when the payload is
    missing or partial."""
    spec = PARAMETER_MAPPING_SPECS[field]
    defaults = dict(spec.defaults or {})
    if not isinstance(config_event, dict):
        return defaults
    cfg = config_event.get('config') or {}
    strummer = cfg.get('strummer') or {}
    mapping = strummer.get(field) or {}
    out = dict(defaults)
    out.update({k: mapping[k] for k in defaults if k in mapping})
    return out


class _CurveVisualizer(Widget):
    """Canvas-drawn mapping curve with live input/output indicator.

    Mirrors ``src/components/strum-visualizers/curve-visualizer.ts``:
    a graph of normalized input (x) vs. mapped output (y), with axis
    labels, an optional dashed centre line for the ``central`` spread,
    and a dashed marker showing the current hover position + output
    value when the tablet event provides one.

    Configuration updates are pushed in by the owning panel via
    :meth:`update_config` and :meth:`update_control`. Tablet events
    flow in via :meth:`on_tablet`. All three trigger a redraw.
    """

    _PAD_LEFT = 38
    _PAD_RIGHT = 12
    _PAD_TOP = 22
    _PAD_BOTTOM = 22

    def __init__(self, spec: ParameterMappingSpec,
                 state: Dict[str, Any], **kwargs) -> None:
        super().__init__(**kwargs)
        self._spec = spec
        self._state: Dict[str, Any] = dict(state)
        self._control: str = str(state.get('control', 'none'))
        self._hover: Optional[float] = None

        with self.canvas.before:
            self._frame_bg = Color(*theme.BG_SURFACE_ALT)
            self._frame_rect = Rectangle(pos=self.pos, size=self.size)

        # Output value readout, anchored above the hover line.
        self._output_label = Label(
            text='', color=spec.curve_color, font_size='7.5sp', bold=True,
            size_hint=(None, None), size=(80, 16),
            halign='center', valign='middle',
        )
        self._output_label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._output_label)

        # Y-axis caption (output label), rotated visually by using a
        # narrow column on the left. Kivy labels don't rotate without
        # custom canvas work, so we render text vertically by stacking
        # characters — keeps the widget pure-Kivy.
        self._axis_label = Label(
            text='\n'.join(spec.output_label),
            color=theme.TEXT_SECONDARY, font_size='7sp',
            size_hint=(None, None), size=(14, 1),
            halign='center', valign='middle',
        )
        self._axis_label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._axis_label)

        self._min_label = Label(
            text='', color=theme.TEXT_SECONDARY, font_size='7sp',
            size_hint=(None, None), size=(self._PAD_LEFT - 4, 14),
            halign='right', valign='middle',
        )
        self._min_label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._min_label)

        self._max_label = Label(
            text='', color=theme.TEXT_SECONDARY, font_size='7sp',
            size_hint=(None, None), size=(self._PAD_LEFT - 4, 14),
            halign='right', valign='middle',
        )
        self._max_label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        self.add_widget(self._max_label)

        self.bind(pos=lambda *_: self._redraw(),
                  size=lambda *_: self._redraw())

    # ---- Public API ---------------------------------------------------

    def update_state(self, state: Dict[str, Any]) -> None:
        """Replace the cached mapping state and redraw."""
        self._state = dict(state)
        self._control = str(state.get('control', self._control))
        self._redraw()

    def update_field(self, attr: str, value: Any) -> None:
        """Patch one mapping field (called as the user edits a stepper)."""
        self._state[attr] = value
        self._redraw()

    def update_control(self, control: str) -> None:
        self._control = str(control)
        self._hover = None
        self._redraw()

    def on_tablet(self, ev: Any) -> None:
        self._hover = hover_position_from_tablet(self._control, ev)
        self._redraw()

    # ---- Drawing ------------------------------------------------------

    def _graph_box(self) -> Tuple[float, float, float, float]:
        x = self.x + self._PAD_LEFT
        y = self.y + self._PAD_BOTTOM
        w = max(1.0, self.width - self._PAD_LEFT - self._PAD_RIGHT)
        h = max(1.0, self.height - self._PAD_TOP - self._PAD_BOTTOM)
        return x, y, w, h

    def _redraw(self) -> None:
        self._frame_rect.pos = self.pos
        self._frame_rect.size = self.size

        gx, gy, gw, gh = self._graph_box()
        min_v = float(self._state.get('min', 0.0))
        max_v = float(self._state.get('max', 1.0))
        curve = float(self._state.get('curve', 1.0))
        spread = str(self._state.get('spread', 'direct'))
        span = (max_v - min_v) or 1.0

        self._min_label.text = _fmt_num(min_v, self._spec.decimals)
        self._max_label.text = _fmt_num(max_v, self._spec.decimals)
        self._min_label.pos = (self.x + 2, gy - 7)
        self._max_label.pos = (self.x + 2, gy + gh - 7)
        self._axis_label.size = (14, gh)
        self._axis_label.pos = (self.x + 2, gy)

        self.canvas.clear()
        with self.canvas:
            Color(*theme.BG_SURFACE)
            Rectangle(pos=(gx, gy), size=(gw, gh))
            Color(*theme.BORDER)
            Line(rectangle=(gx, gy, gw, gh), width=1)

            if spread == 'central':
                Color(*theme.TEXT_MUTED)
                Line(points=[gx + gw / 2.0, gy, gx + gw / 2.0, gy + gh],
                     width=1, dash_offset=3, dash_length=3)

            pts: list = []
            steps = 60
            for i in range(steps + 1):
                t = i / steps
                value = calculate_curve_output(min_v, max_v, curve, spread, t)
                ny = (value - min_v) / span
                ny = 0.0 if ny < 0 else 1.0 if ny > 1 else ny
                pts.extend([gx + t * gw, gy + ny * gh])
            Color(*self._spec.curve_color)
            Line(points=pts, width=2.0)

            if self._hover is not None and 0.0 <= self._hover <= 1.0:
                hx = gx + self._hover * gw
                Color(*theme.STATUS_CONNECTED)
                Line(points=[hx, gy, hx, gy + gh],
                     width=1.5, dash_offset=4, dash_length=4)
                out = calculate_curve_output(min_v, max_v, curve, spread,
                                             self._hover)
                self._output_label.text = _fmt_num(out, self._spec.decimals)
                lw = self._output_label.width
                self._output_label.pos = (hx - lw / 2.0, gy + gh + 2)
            else:
                self._output_label.text = ''


class ParameterMappingPanel(BoxLayout):
    """Shared panel for Velocity / Duration / Pitch parameter mappings.

    Mirrors the web ``curve-visualizer`` compact layout: form on the
    left (Controlled-by dropdown, then a 2-column grid of Spread +
    Min/Max/Curve/Multiplier steppers) and a live :class:`_CurveVisualizer`
    on the right showing how the configured curve maps input to output.
    """

    def __init__(self, spec: ParameterMappingSpec,
                 bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='horizontal', spacing=theme.SPACE_4, **kwargs)
        self._spec = spec
        self._bridge = bridge
        self._state: Dict[str, Any] = extract_parameter_mapping(None, spec.field)
        self._steppers: Dict[str, '_NumberStepper'] = {}

        # Form content lives in a ScrollView — the bigger touch-friendly
        # controls (44px) plus stacked labels exceed the 800x480 panel's
        # vertical budget once Min/Max/Curve/Multiplier are stacked.
        form_inner = BoxLayout(orientation='vertical', spacing=theme.SPACE_3,
                               size_hint_y=None)
        form_inner.bind(minimum_height=form_inner.setter('height'))
        form_inner.add_widget(self._build_control_row())
        form_inner.add_widget(self._build_form())
        form_col = ScrollView(do_scroll_x=False, bar_width=4, size_hint_x=0.55)
        form_col.add_widget(form_inner)
        self.add_widget(form_col)

        self._visualizer = _CurveVisualizer(spec, self._state, size_hint_x=0.45)
        self.add_widget(self._visualizer)

        if bridge is not None:
            bridge.on('config', self._on_config)
            bridge.on('tablet', self._visualizer.on_tablet)

    # ---- Rows ---------------------------------------------------------

    def _build_control_row(self) -> BoxLayout:
        self._control_dropdown = _dropdown(
            CONTROL_SOURCES, self._state.get('control', CONTROL_SOURCES[0]),
            on_change=self._select_control,
        )
        return _setting_row('Controlled by', self._control_dropdown)

    def _build_form(self) -> GridLayout:
        form = _two_col_form()

        self._spread_dropdown = _dropdown(
            SPREAD_TYPES, self._state.get('spread', SPREAD_TYPES[0]),
            on_change=self._select_spread,
        )
        form.add_widget(_setting_row('Spread', self._spread_dropdown))

        form.add_widget(self._build_stepper_row(
            'min', 'Min', self._spec.min_bound,
            integer=self._spec.is_integer))
        form.add_widget(self._build_stepper_row(
            'max', 'Max', self._spec.max_bound,
            integer=self._spec.is_integer))
        form.add_widget(self._build_stepper_row(
            'curve', 'Curve', self._spec.curve_bound, integer=False))
        form.add_widget(self._build_stepper_row(
            'multiplier', 'Multiplier', self._spec.multiplier_bound,
            integer=False))

        return form

    def _build_stepper_row(self, attr: str, label: str,
                           bound: Tuple[float, float],
                           integer: bool) -> BoxLayout:
        decimals = 0 if integer else self._spec.decimals
        step = 1 if integer else max((bound[1] - bound[0]) / 200.0, 0.01)
        stepper = _NumberStepper(
            value=float(self._state.get(attr, bound[0])),
            min_value=bound[0], max_value=bound[1],
            step=step, decimals=decimals,
            on_commit=lambda v, a=attr, i=integer: self._commit_stepper(a, v, i),
        )
        self._steppers[attr] = stepper
        return _setting_row(label, stepper)

    # ---- Events from the bridge --------------------------------------

    def _on_config(self, payload: Any) -> None:
        state = extract_parameter_mapping(payload, self._spec.field)
        self._state = state
        for attr, stepper in self._steppers.items():
            stepper.set_value(state.get(attr, 0))
        spread = state.get('spread')
        if spread in SPREAD_TYPES and self._spread_dropdown.text != spread:
            self._spread_dropdown.text = spread
        control = state.get('control')
        if control in CONTROL_SOURCES and self._control_dropdown.text != control:
            self._control_dropdown.text = control
        self._visualizer.update_state(state)

    # ---- User actions -------------------------------------------------

    def _commit_stepper(self, attr: str, raw: float, integer: bool) -> None:
        value: Any = int(round(raw)) if integer else round(
            float(raw), self._spec.decimals)
        if value == self._state.get(attr):
            return
        self._state[attr] = value
        self._visualizer.update_field(attr, value)
        self._send(attr, value)

    def _select_spread(self, name: str) -> None:
        if name == self._state.get('spread'):
            return
        self._state['spread'] = name
        self._visualizer.update_field('spread', name)
        self._send('spread', name)

    def _select_control(self, name: str) -> None:
        if name == self._state.get('control'):
            return
        self._state['control'] = name
        self._visualizer.update_control(name)
        self._send('control', name)

    def _send(self, attr: str, value: Any) -> None:
        if self._bridge is None:
            return
        self._bridge.set_config(f'strummer.{self._spec.field}.{attr}', value)


def _fmt_num(value: Any, decimals: int) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if decimals <= 0:
        return str(int(round(v)))
    return f'{v:.{decimals}f}'


PRESSURE_MODULATION_TYPES: Tuple[str, ...] = ('none', 'aftertouch', 'cc')


def extract_strum_release(config_event: Any) -> dict:
    """Pull strum-release fields out of a ``'config'`` event.

    The release feature triggers a configurable MIDI note on pen-up;
    the panel needs ``active``, ``midiNote``, ``maxDuration``, and
    ``velocityMultiplier``. ``midiChannel`` (None = follow strummer)
    is intentionally not surfaced — overriding it is an edge case.
    """
    if not isinstance(config_event, dict):
        return {'active': False, 'midiNote': 38, 'maxDuration': 0.25,
                'velocityMultiplier': 1.0}
    cfg = config_event.get('config') or {}
    rel = (cfg.get('strummer') or {}).get('strumRelease') or {}
    return {
        'active': bool(rel.get('active', False)),
        'midiNote': int(rel.get('midiNote', 38)),
        'maxDuration': float(rel.get('maxDuration', 0.25)),
        'velocityMultiplier': float(rel.get('velocityMultiplier', 1.0)),
    }


def extract_slide(config_event: Any) -> dict:
    """Pull slide-mode (trombone) fields out of a ``'config'`` event.

    Mirrors the SliderConfig schema: pen-down ``pressureThreshold``,
    ``maxBendSemitones`` (must match the synth's pitch-bend range),
    and the ``pressureModulation`` sub-block.
    """
    if not isinstance(config_event, dict):
        return {'pressureThreshold': 0.1, 'maxBendSemitones': 24.0,
                'modulationType': 'aftertouch', 'ccNumber': 11,
                'minValue': 0, 'maxValue': 127}
    cfg = config_event.get('config') or {}
    slide = (cfg.get('strummer') or {}).get('slide') or {}
    mod = slide.get('pressureModulation') or {}
    mod_type = mod.get('type', 'aftertouch')
    if mod_type not in PRESSURE_MODULATION_TYPES:
        mod_type = 'aftertouch'
    return {
        'pressureThreshold': float(slide.get('pressureThreshold', 0.1)),
        'maxBendSemitones': float(slide.get('maxBendSemitones', 24.0)),
        'modulationType': mod_type,
        'ccNumber': int(mod.get('ccNumber', 11)),
        'minValue': int(mod.get('minValue', 0)),
        'maxValue': int(mod.get('maxValue', 127)),
    }


class StrumReleasePanel(BoxLayout):
    """Strum-release feature toggle + tunable release note.

    Wires four ``strummer.strumRelease.*`` paths: ``active``,
    ``midiNote``, ``maxDuration``, ``velocityMultiplier``. Steppers laid
    out in a 2-column grid below the Enabled toggle.
    """

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._state = extract_strum_release(None)

        self.add_widget(self._build_form())
        self.add_widget(Widget())

        if bridge is not None:
            bridge.on('config', self._on_config)

    def _build_form(self) -> GridLayout:
        form = _two_col_form()

        self._active_btn = _mode_button('Off', active=False)
        self._active_btn.bind(on_release=lambda *_: self._toggle_active())
        form.add_widget(_inline_setting_row('Enabled', self._active_btn))

        self._note_stepper = _NumberStepper(
            value=self._state['midiNote'],
            min_value=0, max_value=127, step=1, decimals=0,
            on_commit=self._on_note_commit,
        )
        form.add_widget(_setting_row('Release MIDI note', self._note_stepper))

        self._duration_stepper = _NumberStepper(
            value=self._state['maxDuration'],
            min_value=0.0, max_value=5.0, step=0.01, decimals=2,
            on_commit=self._on_duration_commit,
        )
        form.add_widget(_setting_row('Max duration (s)', self._duration_stepper))

        self._vel_stepper = _NumberStepper(
            value=self._state['velocityMultiplier'],
            min_value=0.0, max_value=2.0, step=0.01, decimals=2,
            on_commit=self._on_velocity_commit,
        )
        form.add_widget(_setting_row('Velocity multiplier', self._vel_stepper))

        return form

    def _on_config(self, payload: Any) -> None:
        state = extract_strum_release(payload)
        self._state = state
        self._sync_active(state['active'])
        self._note_stepper.set_value(state['midiNote'])
        self._duration_stepper.set_value(state['maxDuration'])
        self._vel_stepper.set_value(state['velocityMultiplier'])

    def _toggle_active(self) -> None:
        new_value = not bool(self._state.get('active'))
        self._state['active'] = new_value
        self._sync_active(new_value)
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumRelease.active', new_value)

    def _sync_active(self, on: bool) -> None:
        self._active_btn.text = 'On' if on else 'Off'
        _set_mode_button_active(self._active_btn, on)

    def _on_note_commit(self, value: float) -> None:
        v = int(value)
        if v == self._state.get('midiNote'):
            return
        self._state['midiNote'] = v
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumRelease.midiNote', v)

    def _on_duration_commit(self, value: float) -> None:
        if value == self._state.get('maxDuration'):
            return
        self._state['maxDuration'] = value
        if self._bridge is not None:
            self._bridge.set_config('strummer.strumRelease.maxDuration', value)

    def _on_velocity_commit(self, value: float) -> None:
        if value == self._state.get('velocityMultiplier'):
            return
        self._state['velocityMultiplier'] = value
        if self._bridge is not None:
            self._bridge.set_config(
                'strummer.strumRelease.velocityMultiplier', value)


class SlidePanel(BoxLayout):
    """Slide-mode (trombone) tuning surface.

    Wires ``strummer.slide.*`` paths: ``pressureThreshold``,
    ``maxBendSemitones``, and the ``pressureModulation`` sub-block
    (``type``, ``ccNumber``, ``minValue``, ``maxValue``). All controls
    live in a 2-column grid mirroring the web's compact settings form.
    """

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._state = extract_slide(None)

        self.add_widget(self._build_form())
        self.add_widget(Widget())

        if bridge is not None:
            bridge.on('config', self._on_config)

    def _build_form(self) -> GridLayout:
        form = _two_col_form()

        self._threshold_stepper = _NumberStepper(
            value=self._state['pressureThreshold'],
            min_value=0.0, max_value=1.0, step=0.01, decimals=3,
            on_commit=self._on_threshold_commit,
        )
        form.add_widget(_setting_row('Pressure threshold', self._threshold_stepper))

        self._bend_stepper = _NumberStepper(
            value=self._state['maxBendSemitones'],
            min_value=1.0, max_value=48.0, step=0.5, decimals=1,
            on_commit=self._on_bend_commit,
        )
        form.add_widget(_setting_row('Max bend (semitones)', self._bend_stepper))

        # Modulation type — radio cluster fits in one cell.
        self._mod_buttons: dict = {}
        mod_cluster = BoxLayout(orientation='horizontal', size_hint=(None, None),
                                height=theme.INPUT_HEIGHT, spacing=theme.SPACE_1)
        mod_cluster.bind(minimum_width=mod_cluster.setter('width'))
        for mod_type in PRESSURE_MODULATION_TYPES:
            btn = _mode_button(mod_type.capitalize(), active=False)
            btn.size = (108, theme.INPUT_HEIGHT)
            btn.bind(texture_size=lambda b, ts: setattr(
                b, 'width', max(96, int(ts[0]) + theme.SPACE_5 * 2)))
            btn.bind(on_release=lambda _b, t=mod_type: self._select_modulation(t))
            self._mod_buttons[mod_type] = btn
            mod_cluster.add_widget(btn)
        form.add_widget(_inline_setting_row('Pressure modulation', mod_cluster))

        self._cc_stepper = _NumberStepper(
            value=self._state['ccNumber'],
            min_value=0, max_value=127, step=1, decimals=0,
            on_commit=self._on_cc_commit,
        )
        form.add_widget(_setting_row('CC number', self._cc_stepper))

        self._min_stepper = _NumberStepper(
            value=self._state['minValue'],
            min_value=0, max_value=127, step=1, decimals=0,
            on_commit=self._on_min_commit,
        )
        form.add_widget(_setting_row('Min value', self._min_stepper))

        self._max_stepper = _NumberStepper(
            value=self._state['maxValue'],
            min_value=0, max_value=127, step=1, decimals=0,
            on_commit=self._on_max_commit,
        )
        form.add_widget(_setting_row('Max value', self._max_stepper))

        return form

    def _on_config(self, payload: Any) -> None:
        state = extract_slide(payload)
        self._state = state
        self._threshold_stepper.set_value(state['pressureThreshold'])
        self._bend_stepper.set_value(state['maxBendSemitones'])
        self._sync_modulation_buttons(state['modulationType'])
        self._cc_stepper.set_value(state['ccNumber'])
        self._min_stepper.set_value(state['minValue'])
        self._max_stepper.set_value(state['maxValue'])

    def _sync_modulation_buttons(self, mod_type: str) -> None:
        for t, btn in self._mod_buttons.items():
            _set_mode_button_active(btn, t == mod_type)

    def _select_modulation(self, mod_type: str) -> None:
        if mod_type == self._state.get('modulationType'):
            return
        self._state['modulationType'] = mod_type
        self._sync_modulation_buttons(mod_type)
        if self._bridge is not None:
            self._bridge.set_config(
                'strummer.slide.pressureModulation.type', mod_type)

    def _on_threshold_commit(self, value: float) -> None:
        if value == self._state.get('pressureThreshold'):
            return
        self._state['pressureThreshold'] = value
        if self._bridge is not None:
            self._bridge.set_config('strummer.slide.pressureThreshold', value)

    def _on_bend_commit(self, value: float) -> None:
        if value == self._state.get('maxBendSemitones'):
            return
        self._state['maxBendSemitones'] = value
        if self._bridge is not None:
            self._bridge.set_config('strummer.slide.maxBendSemitones', value)

    def _on_cc_commit(self, value: float) -> None:
        v = int(value)
        if v == self._state.get('ccNumber'):
            return
        self._state['ccNumber'] = v
        if self._bridge is not None:
            self._bridge.set_config(
                'strummer.slide.pressureModulation.ccNumber', v)

    def _on_min_commit(self, value: float) -> None:
        v = int(value)
        if v == self._state.get('minValue'):
            return
        self._state['minValue'] = v
        if self._bridge is not None:
            self._bridge.set_config(
                'strummer.slide.pressureModulation.minValue', v)

    def _on_max_commit(self, value: float) -> None:
        v = int(value)
        if v == self._state.get('maxValue'):
            return
        self._state['maxValue'] = v
        if self._bridge is not None:
            self._bridge.set_config(
                'strummer.slide.pressureModulation.maxValue', v)


TRIGGER_TYPES: Tuple[str, ...] = ('press', 'release', 'hold')


def _csv_to_list(text: str) -> list:
    """Split a comma-separated string, trimming and dropping empties."""
    return [t.strip() for t in (text or '').split(',') if t.strip()]


def _list_to_csv(items: Any) -> str:
    """Join a list of strings for CSV display."""
    if not items:
        return ''
    return ', '.join(str(i) for i in items)


def format_action(action: Any) -> str:
    """Render an action (string, list, dict, or None) as a compact summary."""
    if action is None:
        return '(none)'
    if isinstance(action, str):
        return action
    if isinstance(action, list):
        return ' '.join(str(p) for p in action)
    if isinstance(action, dict):
        kind = action.get('type', '?')
        if kind == 'chord-progression':
            return f"chord-progression: {action.get('progression', '?')} @ {action.get('octave', 4)}"
        return kind
    return str(action)


def parse_action_input(text: str) -> Any:
    """Parse a textual action: JSON arrays/objects pass through; bare strings stay strings."""
    import json
    raw = (text or '').strip()
    if not raw:
        return None
    if raw[0] in ('[', '{'):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return raw
    return raw


def extract_action_rules(config_event: Any) -> dict:
    """Pull ``actionRules`` (rules, groups, groupRules, startupRules) from a config event.

    Always returns lists (never None) so panels can iterate without guards.
    """
    empty = {'rules': [], 'groups': [], 'groupRules': [], 'startupRules': []}
    if not isinstance(config_event, dict):
        return empty
    cfg = config_event.get('config') or {}
    rules = ((cfg.get('strummer') or {}).get('actionRules')) or {}
    return {
        'rules': list(rules.get('rules') or []),
        'groups': list(rules.get('groups') or []),
        'groupRules': list(rules.get('groupRules') or []),
        'startupRules': list(rules.get('startupRules') or []),
    }


def extract_chord_progressions(config_event: Any) -> dict:
    """Pull ``chordProgressions`` (name -> list[str]) from a config event."""
    if not isinstance(config_event, dict):
        return {}
    cfg = config_event.get('config') or {}
    progs = (cfg.get('strummer') or {}).get('chordProgressions') or {}
    if not isinstance(progs, dict):
        return {}
    return {str(k): list(v or []) for k, v in progs.items()}


def extract_button_mappings(config_event: Any) -> dict:
    """Compute the configured stylus + numeric button -> action mapping.

    Mirrors the web dashboard's ``getConfiguredButtonMappings``: walks
    direct ``rules`` plus expands ``groupRules`` (chord-progression
    pulls per-button chords from ``chordProgressions``, otherwise the
    whole group shares the same action label). Returns
    ``{'stylus': [{'kind', 'action'}], 'buttons': [{'buttonNum', 'action'}]}``
    sorted by button number.
    """
    rules = extract_action_rules(config_event)
    progressions = extract_chord_progressions(config_event)
    stylus: list = []
    buttons: list = []

    def push(button_id: Any, action_text: str) -> None:
        if not isinstance(button_id, str):
            return
        bid = button_id[len('button:'):] if button_id.startswith('button:') else button_id
        if bid in ('primary', 'secondary'):
            stylus.append({'kind': bid, 'action': action_text})
            return
        try:
            num = int(bid)
        except ValueError:
            return
        buttons.append({'buttonNum': num, 'action': action_text})

    for rule in rules['rules']:
        push(rule.get('button'), format_action(rule.get('action')))

    groups_by_id = {g.get('id'): g for g in rules['groups']}
    for grule in rules['groupRules']:
        group = groups_by_id.get(grule.get('groupId'))
        if group is None:
            continue
        group_buttons = group.get('buttons') or []
        action = grule.get('action')
        if isinstance(action, dict) and action.get('type') == 'chord-progression':
            chords = progressions.get(action.get('progression', ''), [])
            for i, btn in enumerate(group_buttons):
                chord = chords[i] if i < len(chords) else '–'
                push(btn, str(chord))
        else:
            label = action.get('progression', '') if isinstance(action, dict) else format_action(action)
            for btn in group_buttons:
                push(btn, str(label))

    buttons.sort(key=lambda b: b['buttonNum'])
    return {'stylus': stylus, 'buttons': buttons}


def extract_notes(config_event: Any) -> list:
    """Pull strummer notes (``[{notation, octave}]``) for the string strip.

    Notes are flattened to the top level of the config payload by
    ``Server._get_config_data`` (mirroring the web ``config`` message),
    so we read ``config_event['notes']`` rather than the nested
    ``config_event['config']['notes']`` block.
    """
    if not isinstance(config_event, dict):
        return []
    raw = config_event.get('notes') or []
    out: list = []
    for n in raw:
        if isinstance(n, dict):
            out.append({
                'notation': str(n.get('notation', '')),
                'octave': int(n.get('octave', 0) or 0),
            })
    return out


def _delete_button() -> Button:
    return Button(
        text='Delete', size_hint=(None, None), size=(80, theme.CONTROL_HEIGHT),
        background_normal='', background_down='',
        background_color=theme.BG_SURFACE_ALT,
        color=theme.TEXT_SECONDARY, font_size='9.5sp',
    )


def _list_row_label(text: str) -> Label:
    lbl = Label(
        text=text, color=theme.TEXT_PRIMARY, font_size='9.5sp',
        halign='left', valign='middle',
    )
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _text_input(hint: str, width_hint: float = 1.0) -> TextInput:
    return TextInput(
        text='', multiline=False, write_tab=False,
        size_hint=(width_hint, None), height=theme.CONTROL_HEIGHT, font_size='9.5sp',
        background_color=theme.BG_SURFACE_ALT,
        foreground_color=theme.TEXT_PRIMARY,
        cursor_color=theme.ACCENT,
        hint_text=hint,
    )


def _section_header(text: str) -> Label:
    lbl = Label(
        text=f'[b]{text}[/b]', markup=True, color=theme.TEXT_PRIMARY,
        font_size='9.5sp', size_hint_y=None, height=24,
        halign='left', valign='middle',
    )
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _scroll_list() -> Tuple[ScrollView, BoxLayout]:
    scroll = ScrollView(do_scroll_x=False, bar_width=4)
    items = BoxLayout(orientation='vertical', size_hint_y=None,
                      spacing=theme.SPACE_1)
    items.bind(minimum_height=items.setter('height'))
    scroll.add_widget(items)
    return scroll, items


# ---- Form-style primitives that mirror the web dashboard -----------------

# Built-in action catalog. Mirrors ``action-rules-config.ts`` so the kiosk
# offers the same actions/params; field labels match the web wording.
_ACTION_CATALOG: Tuple[Dict[str, Any], ...] = (
    {'value': 'none', 'label': 'None', 'params': ()},
    {'value': 'toggle-repeater', 'label': 'Toggle Note Repeater', 'params': (
        {'key': 'pressureMultiplier', 'label': 'Pressure Multiplier',
         'type': 'number', 'min': 0.1, 'max': 10, 'step': 0.1, 'default': 2.0},
        {'key': 'frequencyMultiplier', 'label': 'Frequency Multiplier',
         'type': 'number', 'min': 0.1, 'max': 10, 'step': 0.1, 'default': 1.5},
    )},
    {'value': 'toggle-transpose', 'label': 'Toggle Transpose', 'params': (
        {'key': 'semitones', 'label': 'Semitones', 'type': 'number',
         'min': -24, 'max': 24, 'step': 1, 'default': 12},
    )},
    {'value': 'transpose', 'label': 'Transpose', 'params': (
        {'key': 'semitones', 'label': 'Semitones', 'type': 'number',
         'min': -24, 'max': 24, 'step': 1, 'default': 12},
    )},
    {'value': 'set-strum-chord', 'label': 'Set Strum Chord', 'params': (
        {'key': 'chord', 'label': 'Chord', 'type': 'text', 'default': 'C'},
        {'key': 'octave', 'label': 'Octave', 'type': 'number',
         'min': 0, 'max': 8, 'step': 1, 'default': 4},
    )},
    {'value': 'set-strum-scale', 'label': 'Set Strum Scale', 'params': (
        {'key': 'root', 'label': 'Root Note', 'type': 'select',
         'options': ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'),
         'default': 'C'},
        {'key': 'scaleType', 'label': 'Scale Type', 'type': 'select',
         'options': ('major', 'minor', 'pentatonic', 'blues', 'dorian',
                     'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian',
                     'harmonic_minor', 'melodic_minor', 'chromatic'),
         'default': 'major'},
        {'key': 'octave', 'label': 'Octave', 'type': 'number',
         'min': 0, 'max': 8, 'step': 1, 'default': 4},
    )},
)


def _action_def(value: str) -> Dict[str, Any]:
    for entry in _ACTION_CATALOG:
        if entry['value'] == value:
            return entry
    return _ACTION_CATALOG[0]


def _action_choices() -> Tuple[str, ...]:
    return tuple(e['value'] for e in _ACTION_CATALOG)


class _CaretDropdown(Spinner):
    """Spinner with a right-aligned chevron rendered on ``canvas.after``.

    The chevron is painted with graphics primitives on ``canvas.after``
    rather than a unicode glyph: the kiosk SDL2 font doesn't carry the
    ``▾`` glyph and renders it as a missing-glyph box (the same reason
    the edit/delete affordances are drawn, not texted). The underlying
    ``text`` property still holds the raw selected value, so callers can
    compare/assign ``dropdown.text`` exactly as before.
    """

    _CARET_PAD = 12
    _CARET_W = 12
    _CARET_H = 7

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        from kivy.graphics import Triangle
        with self.canvas.after:
            self._caret_color = Color(*theme.TEXT_SECONDARY)
            self._caret = Triangle()
        self.bind(pos=self._sync_caret, size=self._sync_caret)
        self._sync_caret()

    def _sync_caret(self, *_):
        w, h = self._CARET_W, self._CARET_H
        rx = self.x + self.width - self._CARET_PAD - w
        cy = self.y + self.height / 2.0
        top, bot = cy + h / 2.0, cy - h / 2.0
        # Down-pointing triangle: top-left, top-right, bottom-centre.
        self._caret.points = [rx, top, rx + w, top, rx + w / 2.0, bot]


def _dropdown(values: Tuple[str, ...], current: str, on_change=None,
              width_hint: float = 1.0) -> Spinner:
    """Spinner-backed dropdown with a right-edge caret indicator."""
    spinner = _CaretDropdown(
        text=current if current in values else (values[0] if values else ''),
        values=values,
        size_hint=(width_hint, None), height=theme.INPUT_HEIGHT,
        background_normal='', background_down='',
        background_color=theme.BG_SURFACE_ALT,
        color=theme.TEXT_PRIMARY, font_size=theme.INPUT_FONT_SIZE,
        sync_height=True,
    )
    if on_change is not None:
        spinner.bind(text=lambda _w, v: on_change(v))
    return spinner


def _number_input(value: Any, width_hint: float = 0.4,
                  allow_float: bool = False) -> TextInput:
    box = TextInput(
        text=str(value), multiline=False, write_tab=False,
        size_hint=(width_hint, None), height=theme.INPUT_HEIGHT,
        font_size=theme.INPUT_FONT_SIZE,
        background_color=theme.BG_SURFACE_ALT,
        foreground_color=theme.TEXT_PRIMARY,
        cursor_color=theme.ACCENT,
        input_filter='float' if allow_float else 'int',
        halign='right',
    )
    return box


class _NumberStepper(BoxLayout):
    """[-] [input] [+] numeric stepper, mirroring the web ``<input type=\"number\">``.

    Commit semantics match the slider widgets we used to ship:

    * The displayed text updates live as the user types (no callback fires).
    * Editing commits on Enter, focus loss, or a ``-``/``+`` click — at that
      point we parse, clamp to ``[min_value, max_value]``, round to
      ``decimals``, and fire ``on_commit`` only when the value actually
      changes (matching the slider's no-op-on-unchanged guard).
    * ``set_value(v)`` updates the input without firing the callback so the
      panel can sync from incoming config events without echoing them back.
    """

    def __init__(self, value: float, min_value: float, max_value: float,
                 step: float = 1, decimals: int = 0,
                 on_commit=None, width_hint: float = 1.0, **kwargs) -> None:
        super().__init__(orientation='horizontal', size_hint=(width_hint, None),
                         height=theme.INPUT_HEIGHT, spacing=theme.SPACE_1, **kwargs)
        self._min = float(min_value)
        self._max = float(max_value)
        self._step = float(step)
        self._decimals = int(decimals)
        self._on_commit = on_commit
        self._value: float = self._clamp(float(value))

        self._dec = Button(
            text='−', size_hint=(None, None), size=(50, theme.INPUT_HEIGHT),
            background_normal='', background_down='',
            background_color=theme.BG_SURFACE_ALT,
            color=theme.TEXT_PRIMARY, font_size='18.5sp',
        )
        self._dec.bind(on_release=lambda *_: self._step_by(-1))
        self.add_widget(self._dec)

        self.input = TextInput(
            text=self._format(self._value), multiline=False, write_tab=False,
            size_hint=(1, None), height=theme.INPUT_HEIGHT, font_size=theme.INPUT_FONT_SIZE,
            background_color=theme.BG_SURFACE_ALT,
            foreground_color=theme.TEXT_PRIMARY,
            cursor_color=theme.ACCENT,
            input_filter='float' if self._decimals > 0 or self._is_signed() else 'int',
            halign='center',
        )
        self.input.bind(on_text_validate=lambda *_: self.commit())
        self.input.bind(focus=lambda _w, f: (None if f else self.commit()))
        self.add_widget(self.input)

        self._inc = Button(
            text='+', size_hint=(None, None), size=(50, theme.INPUT_HEIGHT),
            background_normal='', background_down='',
            background_color=theme.BG_SURFACE_ALT,
            color=theme.TEXT_PRIMARY, font_size='18.5sp',
        )
        self._inc.bind(on_release=lambda *_: self._step_by(1))
        self.add_widget(self._inc)

    # ---- Public API -----------------------------------------------------

    @property
    def value(self) -> float:
        return self._value

    @property
    def text(self) -> str:
        return self.input.text

    @text.setter
    def text(self, v: str) -> None:
        self.input.text = str(v)

    def set_value(self, v: Any) -> None:
        """Programmatic update — no commit callback, just sync the display."""
        try:
            n = self._clamp(float(v))
        except (TypeError, ValueError):
            return
        self._value = n
        self.input.text = self._format(n)

    def commit(self) -> None:
        """Parse the input field, clamp, fire ``on_commit`` when changed."""
        raw = (self.input.text or '').strip()
        if raw == '' or raw == '-':
            # Revert empty/partial entry to last committed value.
            self.input.text = self._format(self._value)
            return
        try:
            parsed = float(raw)
        except ValueError:
            self.input.text = self._format(self._value)
            return
        clamped = self._clamp(parsed)
        rounded = self._round(clamped)
        # Always normalize display to the canonical format.
        self.input.text = self._format(rounded)
        if rounded == self._round(self._value):
            return
        self._value = rounded
        if self._on_commit is not None:
            self._on_commit(rounded)

    # ---- Internals ------------------------------------------------------

    def _step_by(self, direction: int) -> None:
        self._value = self._clamp(self._value + direction * self._step)
        self.input.text = self._format(self._value)
        rounded = self._round(self._value)
        self._value = rounded
        if self._on_commit is not None:
            self._on_commit(rounded)

    def _clamp(self, v: float) -> float:
        if v < self._min:
            return self._min
        if v > self._max:
            return self._max
        return v

    def _round(self, v: float) -> Any:
        if self._decimals <= 0:
            return int(round(v))
        return round(v, self._decimals)

    def _format(self, v: float) -> str:
        if self._decimals <= 0:
            return str(int(round(v)))
        return f'{v:.{self._decimals}f}'

    def _is_signed(self) -> bool:
        return self._min < 0


def _two_col_form(row_height: int = 40, row_gap: int = 12,
                  col_gap: int = theme.SPACE_5 * 2) -> GridLayout:
    """2-column grid mirroring ``.dashboard.compact .settings-form``.

    Each child should be a ``setting-row`` (label + control packed
    horizontally). The grid sets its own ``minimum_height`` so it can
    sit inside a vertical BoxLayout without manual sizing.
    """
    grid = GridLayout(cols=2, size_hint_y=None,
                      spacing=(col_gap, row_gap))
    grid.bind(minimum_height=grid.setter('height'))
    return grid


def _setting_row(label_text: str, control: Widget) -> BoxLayout:
    """Vertical field — small label above the control.

    Mirrors the web's ``.range-field`` / ``.control-selector-top`` layout
    (flex column, 4px gap, 13px label). All settings panels share this
    helper so dropdowns/steppers stack consistently across the dashboard.
    """
    control_h = getattr(control, 'height', None) or theme.CONTROL_HEIGHT
    label_gap = theme.SPACE_1 + 5
    top_margin = theme.SPACE_2
    row_h = top_margin + theme.FIELD_LABEL_HEIGHT + label_gap + int(control_h)
    col = BoxLayout(orientation='vertical', size_hint_y=None, height=row_h,
                    spacing=label_gap, padding=[0, top_margin, 0, 0])
    col.add_widget(_form_field_label(label_text))
    col.add_widget(control)
    return col


def _inline_setting_row(label_text: str, control: Widget) -> BoxLayout:
    """Inline field — label on the left, control on the right.

    Used for on/off toggles and small mode selectors where stacking the
    label above the control wastes vertical space.
    """
    control_h = getattr(control, 'height', None) or theme.CONTROL_HEIGHT
    top_margin = theme.SPACE_2
    row_h = top_margin + int(control_h)
    row = BoxLayout(orientation='horizontal', size_hint_y=None, height=row_h,
                    spacing=theme.SPACE_3, padding=[0, top_margin, 0, 0])
    label = Label(
        text=label_text, color=theme.TEXT_SECONDARY, font_size='8.5sp',
        halign='left', valign='middle', bold=True,
    )
    label.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    row.add_widget(label)
    row.add_widget(control)
    return row


def _filled_rect_bg(widget: Widget, color: Tuple[float, float, float, float]) -> None:
    """Paint a flat background rect that tracks the widget's pos/size."""
    with widget.canvas.before:
        Color(*color)
        rect = Rectangle(pos=widget.pos, size=widget.size)
    widget.bind(pos=lambda w, *_: setattr(rect, 'pos', w.pos),
                size=lambda w, *_: setattr(rect, 'size', w.size))


_BADGE_COLORS: Dict[str, Tuple[float, float, float, float]] = {}

# Type badges on the left of each row share a uniform width so the
# Button / Group / Startup labels line up vertically across rows even
# though "Startup" is two glyphs wider than "Group". The value is
# generous enough to fit the widest type label plus the badge padding.
_TYPE_BADGE_KINDS = frozenset({'button', 'group', 'startup'})
_TYPE_BADGE_MIN_WIDTH = 84

# Horizontal / vertical padding inside every badge — gives the text
# room to breathe so the pill reads as a tag rather than tight text.
_BADGE_HPAD = 12
_BADGE_VPAD = 4


def _badge(text: str, kind: str) -> Label:
    """Pill-shaped type badge (Button / Group / Startup / trigger).

    Sizes itself from the rendered ``texture_size`` plus explicit
    horizontal/vertical padding so the pill always fits its text. Type
    badges additionally enforce a uniform minimum width so the leading
    column of every rule row lines up. Background/text colors are
    chosen for legibility in both light and dark themes (the web
    mirrors this with ``BLUE_100`` / ``BLUE_900`` pairs that invert
    per palette).
    """
    # (bg, fg). Pick colors that stay readable on either palette.
    palette = {
        'button':  (theme.BLUE_100,         theme.BLUE_900),
        'group':   (theme.GRAY_300,         theme.TEXT_PRIMARY),
        'startup': (theme.STATUS_CONNECTED, (1, 1, 1, 1)),
        'trigger': (theme.GRAY_200,         theme.TEXT_SECONDARY),
    }
    bg, fg = palette.get(kind, (theme.BG_SURFACE_ALT, theme.TEXT_PRIMARY))
    lbl = Label(
        text=text, color=fg, font_size='10.5sp',
        size_hint=(None, None),
        halign='center', valign='middle',
        bold=True,
        # Without an explicit pos_hint, BoxLayout drops a size_hint=(None, None)
        # child against its bottom edge — which visually places the pill at
        # the boundary with the next row, looking like it bleeds upward.
        pos_hint={'center_y': 0.5},
    )
    # Measure the rendered text once so the padded pill is the right
    # size before its first GL frame — relying on ``texture_size`` from
    # a not-yet-rendered label returns ``(0, 0)``.
    lbl.texture_update()
    tw, th = lbl.texture_size
    min_w = _TYPE_BADGE_MIN_WIDTH if kind in _TYPE_BADGE_KINDS else 0
    lbl.size = (max(min_w, int(tw) + 2 * _BADGE_HPAD),
                int(th) + 2 * _BADGE_VPAD)
    lbl.text_size = lbl.size
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    _filled_rect_bg(lbl, bg)
    return lbl


def _status_dot(active: bool = False) -> Widget:
    w = Widget(size_hint=(None, None), size=(10, 10))
    color = theme.STATUS_CONNECTED if active else theme.STATUS_DISCONNECTED
    with w.canvas:
        Color(*color)
        ell = Ellipse(pos=w.pos, size=w.size)
    w.bind(pos=lambda _w, *_: setattr(ell, 'pos', _w.pos),
           size=lambda _w, *_: setattr(ell, 'size', _w.size))
    return w


def _icon_button(symbol: str, on_release, tooltip: str = '',
                 size: Optional[int] = None,
                 font_size: str = '20sp') -> Button:
    """Compact quiet button — used for edit/delete/back affordances."""
    s = size or theme.CONTROL_HEIGHT
    btn = Button(
        text=symbol, size_hint=(None, None), size=(s, s),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0),
        color=theme.TEXT_PRIMARY, font_size=font_size,
    )
    btn.bind(on_release=lambda *_: on_release())
    return btn


# ---- Vector icon buttons (pencil / trash) ------------------------------
#
# The SDL2 font shipped with Kivy doesn't reliably carry the unicode
# pencil glyph (U+270E) on every platform, which is why edit affordances
# rendered as edit buttons on macOS dev but as blank squares on the Pi
# kiosk. Draw the icons via canvas primitives so they're font-independent
# and scale with the button.

ROW_ICON_SIZE = int(theme.CONTROL_HEIGHT * 1.2)


class _IconButton(Button):
    """Square quiet button that paints a vector glyph on ``canvas.after``.

    The painter is a free function taking ``(x, y, d)`` — the origin and
    side length of the centred icon box in widget coordinates — and is
    re-invoked on every pos/size change.
    """

    def __init__(self, painter, on_release, size: int = ROW_ICON_SIZE,
                 **kwargs) -> None:
        super().__init__(
            text='', size_hint=(None, None), size=(size, size),
            background_normal='', background_down='',
            background_color=(0, 0, 0, 0), **kwargs,
        )
        self._painter = painter
        self.bind(pos=self._repaint, size=self._repaint)
        self.bind(on_release=lambda *_: on_release())
        self._repaint()

    def _repaint(self, *_args) -> None:
        self.canvas.after.clear()
        pad = max(4, int(self.height * 0.18))
        d = min(self.width, self.height) - 2 * pad
        if d <= 0:
            return
        x = self.x + (self.width - d) / 2.0
        y = self.y + (self.height - d) / 2.0
        with self.canvas.after:
            Color(*theme.TEXT_PRIMARY)
            self._painter(x, y, d)


def _draw_pencil(x: float, y: float, d: float) -> None:
    # Pencil along the SW→NE diagonal: triangular tip at lower-left,
    # body shaft, short ferrule line, eraser cap at upper-right.
    Line(points=[
        x + 0.05 * d, y + 0.05 * d,   # tip apex
        x + 0.20 * d, y + 0.08 * d,   # tip base (lower)
        x + 0.85 * d, y + 0.73 * d,   # body lower-right
        x + 0.95 * d, y + 0.83 * d,   # eraser corner 1
        x + 0.83 * d, y + 0.95 * d,   # eraser corner 2
        x + 0.73 * d, y + 0.85 * d,   # body upper-right
        x + 0.08 * d, y + 0.20 * d,   # tip base (upper)
        x + 0.05 * d, y + 0.05 * d,   # close
    ], width=1.4)
    # Ferrule mark across the shaft, just below the eraser.
    Line(points=[x + 0.62 * d, y + 0.78 * d,
                 x + 0.78 * d, y + 0.62 * d], width=1.2)


def _draw_trashcan(x: float, y: float, d: float) -> None:
    # Handle, lid, trapezoidal body outline, two interior staves.
    Line(points=[x + 0.40 * d, y + 0.92 * d,
                 x + 0.60 * d, y + 0.92 * d], width=1.6)
    Line(points=[x + 0.10 * d, y + 0.78 * d,
                 x + 0.90 * d, y + 0.78 * d], width=1.8)
    Line(points=[
        x + 0.22 * d, y + 0.76 * d,
        x + 0.30 * d, y + 0.10 * d,
        x + 0.70 * d, y + 0.10 * d,
        x + 0.78 * d, y + 0.76 * d,
    ], width=1.6)
    for fx in (0.42, 0.58):
        Line(points=[x + fx * d, y + 0.22 * d,
                     x + fx * d, y + 0.66 * d], width=1.2)


def _pencil_button(on_release, size: int = ROW_ICON_SIZE) -> _IconButton:
    return _IconButton(_draw_pencil, on_release, size=size)


def _trash_button(on_release, size: int = ROW_ICON_SIZE) -> _IconButton:
    return _IconButton(_draw_trashcan, on_release, size=size)


# ---- Accidental glyphs ------------------------------------------------
#
# The unicode natural / sharp / flat glyphs (♮ ♯ ♭) aren't carried by the
# SDL2 font on the Pi kiosk, so they render as tofu placeholders. Draw
# them as vector lines so they're font-independent and scale with the
# button — same pattern as the pencil / trash icons above.

def _draw_natural(x: float, y: float, d: float) -> None:
    # Two offset verticals connected by two short diagonal crossbars,
    # mirroring the canonical natural-sign shape.
    Line(points=[x + 0.35 * d, y + 0.05 * d,
                 x + 0.35 * d, y + 0.78 * d], width=1.4)
    Line(points=[x + 0.65 * d, y + 0.22 * d,
                 x + 0.65 * d, y + 0.95 * d], width=1.4)
    Line(points=[x + 0.35 * d, y + 0.62 * d,
                 x + 0.65 * d, y + 0.78 * d], width=1.6)
    Line(points=[x + 0.35 * d, y + 0.22 * d,
                 x + 0.65 * d, y + 0.38 * d], width=1.6)


def _draw_sharp(x: float, y: float, d: float) -> None:
    # Two verticals + two upward-slanting crossbars.
    Line(points=[x + 0.36 * d, y + 0.08 * d,
                 x + 0.36 * d, y + 0.92 * d], width=1.4)
    Line(points=[x + 0.64 * d, y + 0.08 * d,
                 x + 0.64 * d, y + 0.92 * d], width=1.4)
    Line(points=[x + 0.18 * d, y + 0.32 * d,
                 x + 0.82 * d, y + 0.42 * d], width=1.8)
    Line(points=[x + 0.18 * d, y + 0.58 * d,
                 x + 0.82 * d, y + 0.68 * d], width=1.8)


def _draw_flat(x: float, y: float, d: float) -> None:
    # Vertical stem with a small bowl on the lower-right.
    Line(points=[x + 0.32 * d, y + 0.05 * d,
                 x + 0.32 * d, y + 0.95 * d], width=1.4)
    Line(points=[
        x + 0.32 * d, y + 0.62 * d,
        x + 0.50 * d, y + 0.62 * d,
        x + 0.66 * d, y + 0.55 * d,
        x + 0.72 * d, y + 0.40 * d,
        x + 0.62 * d, y + 0.22 * d,
        x + 0.45 * d, y + 0.14 * d,
        x + 0.32 * d, y + 0.10 * d,
    ], width=1.6)


def _draw_refresh(x: float, y: float, d: float) -> None:
    # Feather "refresh-cw" — two semicircular arcs rotating in opposite
    # directions, each terminated by an L-shaped arrowhead at the leading
    # edge. Coordinates derive from the 24-unit SVG path used in the web
    # UI, with the y-axis flipped so the top of the SVG lands at the top
    # of the Kivy widget. Angles use Kivy's circle convention: 0° at top,
    # increasing clockwise.
    cx, cy = x + 0.5 * d, y + 0.5 * d
    r = 0.417 * d
    # Upper arc: from middle-left (9 o'clock) clockwise across the top
    # to ~2 o'clock, leaving room for the upper-right arrowhead.
    Line(circle=(cx, cy, r, -90, 62), width=1.4)
    # Lower arc: from ~3 o'clock clockwise across the bottom to ~8
    # o'clock, leaving room for the lower-left arrowhead.
    Line(circle=(cx, cy, r, 92, 242), width=1.4)
    # Upper-right L arrowhead.
    Line(points=[
        x + 0.646 * d, y + 0.667 * d,
        x + 0.896 * d, y + 0.667 * d,
        x + 0.896 * d, y + 0.917 * d,
    ], width=1.4)
    # Lower-left L arrowhead.
    Line(points=[
        x + 0.354 * d, y + 0.333 * d,
        x + 0.104 * d, y + 0.333 * d,
        x + 0.104 * d, y + 0.083 * d,
    ], width=1.4)


_ACCIDENTAL_PAINTERS: Dict[str, Any] = {
    '': _draw_natural,   # natural — empty accidental value
    '#': _draw_sharp,
    'b': _draw_flat,
}


def _vdivider(height: Optional[int] = None, width: int = 12,
              top_inset: Optional[int] = None,
              bottom_inset: Optional[int] = None) -> Widget:
    """Thin vertical rule used to separate option-button groups.

    Passing ``height=None`` makes the rule stretch to fill its parent
    vertically (``size_hint_y=1``) — useful as a column separator inside
    a horizontal ``BoxLayout``. A positive ``height`` pins the rule to a
    fixed size, as required by the chord-builder option-button rows.

    ``top_inset`` / ``bottom_inset`` clip the painted line inwards from
    the widget's bounding box (without changing the widget's size) — use
    them to make a stretch-height rule start below a section header or
    end above a footer."""
    if height is None:
        box = Widget(size_hint=(None, 1), width=width)
    else:
        box = Widget(size_hint=(None, None), size=(width, height))
    with box.canvas:
        col = Color(*theme.BORDER)
        line = Line(points=[0, 0, 0, 0], width=1.2)
    def _sync(*_):
        cx = box.x + box.width / 2.0
        default_pad = max(4, int(box.height * 0.15))
        top_pad = default_pad if top_inset is None else max(0, top_inset)
        bot_pad = default_pad if bottom_inset is None else max(0, bottom_inset)
        line.points = [cx, box.y + bot_pad, cx, box.y + box.height - top_pad]
    box.bind(pos=_sync, size=_sync)
    _sync()
    return box


def _hdivider(height: int = 24) -> Widget:
    """Full-width horizontal rule, centred vertically within ``height``.

    The outer widget reserves ``height`` of vertical space so the line
    has breathing room above and below; the line itself is 1.2px in
    ``theme.BORDER``."""
    box = Widget(size_hint_y=None, height=height)
    with box.canvas:
        Color(*theme.BORDER)
        line = Line(points=[0, 0, 0, 0], width=1.2)
    def _sync(*_):
        cy = box.y + box.height / 2.0
        line.points = [box.x, cy, box.x + box.width, cy]
    box.bind(pos=_sync, size=_sync)
    _sync()
    return box


def _accent_button(text: str, on_release, width: int = 120,
                   height: Optional[int] = None,
                   font_size: str = '14sp',
                   radius: int = 0,
                   painter: Optional[Any] = None) -> Button:
    """Primary action button. When ``radius`` > 0 the background is a
    ``RoundedRectangle`` painted on ``canvas.before``; the built-in
    background is hidden so the rounded shape isn't framed by Kivy's
    default rectangular 9-patch. When ``painter`` is supplied, the button
    renders a centred vector glyph via ``canvas.after`` (in the button's
    foreground colour) in place of the label text — used for icon-only
    actions whose web equivalents are SVG icons."""
    btn = Button(
        text='' if painter else text, size_hint=(None, None),
        size=(width, height or theme.CONTROL_HEIGHT),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0) if radius else theme.ACCENT_BG,
        color=theme.TEXT_PRIMARY,
        font_size=font_size, bold=True,
    )
    if radius:
        with btn.canvas.before:
            Color(*theme.ACCENT_BG)
            bg = RoundedRectangle(pos=btn.pos, size=btn.size,
                                  radius=[radius])
        def _sync(_w, *_):
            bg.pos = _w.pos
            bg.size = _w.size
        btn.bind(pos=_sync, size=_sync)
    if painter is not None:
        def _repaint(*_):
            btn.canvas.after.clear()
            pad = max(4, int(btn.height * 0.22))
            d = min(btn.width, btn.height) - 2 * pad
            if d <= 0:
                return
            gx = btn.x + (btn.width - d) / 2.0
            gy = btn.y + (btn.height - d) / 2.0
            with btn.canvas.after:
                Color(*theme.TEXT_PRIMARY)
                painter(gx, gy, d)
        btn.bind(pos=_repaint, size=_repaint)
        _repaint()
    btn.bind(on_release=lambda *_: on_release())
    return btn


def _secondary_button(text: str, on_release, width: int = 110,
                      height: Optional[int] = None,
                      font_size: str = '14sp',
                      radius: int = 0) -> Button:
    """Muted-background companion to :func:`_accent_button`. When
    ``radius`` > 0 paints a ``RoundedRectangle`` in ``BG_SURFACE_ALT``
    on ``canvas.before`` and hides the default rectangular background,
    matching the accent button's pill shape for paired form actions."""
    btn = Button(
        text=text, size_hint=(None, None),
        size=(width, height or theme.CONTROL_HEIGHT),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0) if radius else theme.BG_SURFACE_ALT,
        color=theme.TEXT_PRIMARY,
        font_size=font_size,
    )
    if radius:
        with btn.canvas.before:
            Color(*theme.BG_SURFACE_ALT)
            bg = RoundedRectangle(pos=btn.pos, size=btn.size,
                                  radius=[radius])
        def _sync(_w, *_):
            bg.pos = _w.pos
            bg.size = _w.size
        btn.bind(pos=_sync, size=_sync)
    btn.bind(on_release=lambda *_: on_release())
    return btn


def _option_button(text: str, selected: bool, on_release,
                   disabled: bool = False, width: int = 64,
                   height: Optional[int] = None,
                   font_size: str = '9.5sp',
                   painter: Optional[Any] = None,
                   radius: Optional[int] = None) -> Button:
    """Chord-builder option button — selected state mirrors the web style.

    Paints a rounded background matching :func:`_button_chip` so the
    chord builder reads as the same family of toggle controls. ``radius``
    defaults to the full pill (``height // 2``); pass a smaller value to
    get a tag-style corner. When ``painter`` is supplied, the button
    renders a centred vector glyph via ``canvas.after`` instead of text
    — used for accidentals whose unicode glyphs aren't available in the
    kiosk font."""
    height = height or theme.CONTROL_HEIGHT
    radius = height // 2 if radius is None else radius
    bg_color = theme.ACCENT_BG if selected else theme.BG_SURFACE_ALT
    fg_color = (theme.TEXT_PRIMARY if selected
                else theme.TEXT_MUTED if disabled
                else theme.TEXT_SECONDARY)
    btn = Button(
        text='' if painter else text, size_hint=(None, None),
        size=(width, height),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0),
        color=fg_color,
        font_size=font_size, bold=selected,
        disabled=disabled,
    )
    with btn.canvas.before:
        Color(*bg_color)
        bg = RoundedRectangle(pos=btn.pos, size=btn.size, radius=[radius])
    def _sync(_w, *_):
        bg.pos = _w.pos
        bg.size = _w.size
    btn.bind(pos=_sync, size=_sync)
    if painter is not None:
        def _repaint(*_):
            btn.canvas.after.clear()
            pad = max(4, int(btn.height * 0.18))
            d = min(btn.width, btn.height) - 2 * pad
            if d <= 0:
                return
            gx = btn.x + (btn.width - d) / 2.0
            gy = btn.y + (btn.height - d) / 2.0
            with btn.canvas.after:
                Color(*fg_color)
                painter(gx, gy, d)
        btn.bind(pos=_repaint, size=_repaint)
        _repaint()
    btn.bind(on_release=lambda *_: on_release())
    return btn


def _button_chip(text: str, selected: bool = False,
                 on_release=None, height: int = 28,
                 font_size: str = '9sp',
                 size_hint_x: Optional[float] = None) -> Button:
    """Tag-style chip used to display/toggle a button ID in groups.

    Paints a rounded-pill background. When ``size_hint_x`` is ``None``
    the chip auto-sizes its width to fit the label (plus a horizontal
    padding) so longer IDs like ``button:secondary`` aren't clipped by
    neighbours; when set, the chip fills its parent's cell horizontally
    instead (used by the edit-group toggle grid)."""
    radius = height // 2
    bg_color = theme.ACCENT_BG if selected else theme.BG_SURFACE_ALT
    btn = Button(
        text=text,
        size_hint=(size_hint_x, None),
        size=(88, height),
        background_normal='', background_down='',
        background_color=(0, 0, 0, 0),
        color=(theme.TEXT_PRIMARY if selected else theme.TEXT_SECONDARY),
        font_size=font_size, bold=selected,
    )
    with btn.canvas.before:
        Color(*bg_color)
        bg = RoundedRectangle(pos=btn.pos, size=btn.size, radius=[radius])
    def _sync(_w, *_):
        bg.pos = _w.pos
        bg.size = _w.size
    btn.bind(pos=_sync, size=_sync)
    if size_hint_x is None:
        def _fit(_w, *_):
            btn.width = max(72, int(btn.texture_size[0]) + 28)
        btn.bind(texture_size=_fit)
        _fit(btn)
    if on_release is not None:
        btn.bind(on_release=lambda *_: on_release())
    return btn


def _chord_chip(text: str, on_remove,
                height: Optional[int] = None,
                font_size: str = '14sp',
                radius: Optional[int] = None) -> BoxLayout:
    """Pill-shaped accent chip mirroring the selected ``_button_chip`` /
    ``_option_button`` style, with a trailing ``×`` to remove the chord."""
    height = height or theme.CONTROL_HEIGHT
    radius = height // 2 if radius is None else radius
    row = BoxLayout(orientation='horizontal', size_hint=(None, None),
                    size=(0, height), spacing=theme.SPACE_1,
                    padding=(theme.SPACE_3, 0, theme.SPACE_1, 0))
    with row.canvas.before:
        Color(*theme.ACCENT_BG)
        bg = RoundedRectangle(pos=row.pos, size=row.size, radius=[radius])
    def _sync(_w, *_):
        bg.pos = _w.pos
        bg.size = _w.size
    row.bind(pos=_sync, size=_sync)
    lbl = Label(text=text, color=theme.TEXT_PRIMARY, font_size=font_size,
                bold=True, size_hint=(None, 1),
                halign='left', valign='middle')
    def _resize(*_):
        lbl.texture_update()
        lbl.width = max(20, int(lbl.texture_size[0]))
        lbl.text_size = lbl.size
        row.width = lbl.width + theme.SPACE_3 + theme.SPACE_1 + height
    lbl.bind(texture_size=_resize)
    _resize()
    row.add_widget(lbl)
    row.add_widget(_icon_button('×', on_remove, size=height,
                                font_size=font_size))
    return row


def _form_field_label(text: str) -> Label:
    lbl = Label(
        text=text, color=theme.TEXT_SECONDARY, font_size='8.5sp',
        size_hint_y=None, height=theme.FIELD_LABEL_HEIGHT,
        halign='left', valign='middle', bold=True,
    )
    lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
    return lbl


def _section_card(title: str, body: Widget,
                  header_widget: Optional[Widget] = None) -> BoxLayout:
    """Surface card — optional title row (title + optional action) over a body.

    When ``title`` is empty, the title label is omitted and a flexible
    spacer takes its place so ``header_widget`` (e.g. a primary action
    button) is pushed to the trailing edge. The header row grows to fit
    a taller ``header_widget`` if needed.
    """
    card = BoxLayout(orientation='vertical', spacing=theme.SPACE_2,
                     padding=(theme.SPACE_3, theme.SPACE_2))
    _filled_rect_bg(card, theme.BG_SURFACE)
    if title or header_widget is not None:
        header_h = 24
        if header_widget is not None:
            header_h = max(header_h, int(getattr(header_widget, 'height', 24)))
        header = BoxLayout(orientation='horizontal', size_hint_y=None,
                           height=header_h, spacing=theme.SPACE_2)
        if title:
            title_lbl = Label(
                text=title, color=theme.TEXT_PRIMARY,
                font_size='8.5sp', bold=True,
                halign='left', valign='middle',
            )
            title_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
            header.add_widget(title_lbl)
        else:
            header.add_widget(Widget())
        if header_widget is not None:
            header.add_widget(header_widget)
        card.add_widget(header)
    card.add_widget(body)
    return card


def _enabled_buttons(button_count: int,
                     has_primary: bool = True,
                     has_secondary: bool = True) -> Tuple[str, ...]:
    """Mirror the web's getAvailableButtons() output."""
    out: list = []
    if has_primary:
        out.append('button:primary')
    if has_secondary:
        out.append('button:secondary')
    for n in range(1, max(0, int(button_count)) + 1):
        out.append(f'button:{n}')
    return tuple(out)


# ---- Chord builder option tables (mirror chord-progression-creator.ts) ---

_BUILDER_ROOTS: Tuple[str, ...] = ('C', 'D', 'E', 'F', 'G', 'A', 'B')
_BUILDER_ACCIDENTALS: Tuple[Tuple[str, str], ...] = (
    ('♮', ''), ('♯', '#'), ('♭', 'b'),
)
_BUILDER_QUALITIES: Tuple[Tuple[str, str], ...] = (
    ('Maj', ''), ('Min', 'm'), ('Dim', 'dim'), ('Aug', 'aug'),
    ('Sus2', 'sus2'), ('Sus4', 'sus4'), ('5', '5'),
)
_BUILDER_EXTENSIONS: Tuple[Tuple[str, str], ...] = (
    ('None', ''), ('7', '7'), ('maj7', 'maj7'),
    ('9', '9'), ('6', '6'), ('add9', 'add9'),
)


def _build_chord_token(root: str, accidental: str,
                       quality: str, extension: str) -> str:
    """Compose a chord token, mirroring ``getCurrentChord()`` in the web."""
    base = f'{root}{accidental}'
    if quality == '5':
        return f'{base}5'
    if quality in ('sus2', 'sus4'):
        return f'{base}{quality}'
    if quality == 'm' and extension:
        return f'{base}m{extension}'
    return f'{base}{quality}{extension}'


def _is_accidental_disabled(root: str, accidental: str) -> bool:
    """Match the web rule: B# / E# / Cb / Fb are not offered."""
    if accidental == '#' and root in ('B', 'E'):
        return True
    if accidental == 'b' and root in ('C', 'F'):
        return True
    return False


def _extension_disabled_for(quality: str) -> bool:
    return quality in ('5', 'sus2', 'sus4')



_TARGET_TYPES: Tuple[str, ...] = ('button', 'group', 'startup')
_TRIGGER_OPTIONS: Tuple[str, ...] = ('release', 'press', 'hold')


class ActionRulesPanel(BoxLayout):
    """Editor for ``strummer.actionRules`` (rules + groupRules + startupRules).

    Mirrors the web ``<action-rules-config mode="actions">`` panel: a
    list view of all configured rules with type badges, swapped for a
    form view when adding or editing. Commits the full ``actionRules``
    snapshot so sibling lists (``groups`` managed by GroupsPanel) survive.
    """

    def __init__(self, bridge: Optional[UIBridge] = None,
                 button_count: int = 8, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_2, **kwargs)
        self._bridge = bridge
        self._button_count = button_count
        self._full = extract_action_rules(None)
        self._progressions: Dict[str, list] = {}

        # Form state — mirrors the web's @state fields.
        self._mode: str = 'list'  # 'list' | 'form'
        self._editing_kind: Optional[str] = None  # 'button'|'group'|'startup'
        self._editing_id: Optional[str] = None
        self._form_target: str = 'button'
        self._form_button: str = 'button:1'
        self._form_group_id: str = ''
        self._form_action: str = 'none'
        self._form_trigger: str = 'release'
        self._form_name: str = ''
        self._form_params: Dict[str, Any] = {}
        self._form_group_action_type: str = 'chord-progression'
        self._form_group_progression: str = ''
        self._form_group_octave: int = 4
        self._form_group_trigger: str = 'release'

        self._body = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        self.add_widget(self._body)
        self._render()

        if bridge is not None:
            bridge.on('config', self._on_config)

    # ---- Bridge events ------------------------------------------------

    def _on_config(self, payload: Any) -> None:
        self._full = extract_action_rules(payload)
        self._progressions = extract_chord_progressions(payload)
        if self._mode == 'list':
            self._render()

    # ---- Top-level render --------------------------------------------

    def _render(self) -> None:
        self._body.clear_widgets()
        if self._mode == 'list':
            self._body.add_widget(self._build_list_view())
        else:
            self._body.add_widget(self._build_form_view())

    # ---- List view ----------------------------------------------------

    def _build_list_view(self) -> BoxLayout:
        wrap = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        # Rounded-pill primary "+ Add Action" affordance, sized to match
        # the app's standard accent buttons. ``title=''`` drops the
        # redundant section header.
        add_btn = _accent_button(
            '+ Add Action', self._open_add_form,
            width=150,
            height=theme.CONTROL_HEIGHT,
            font_size='12sp', radius=int(theme.CONTROL_HEIGHT * 0.5),
        )
        scroll, self._list = _scroll_list()
        wrap.add_widget(_section_card('', scroll, header_widget=add_btn))
        self._populate_list()
        return wrap

    def _populate_list(self) -> None:
        self._list.clear_widgets()
        rules = self._full['rules']
        group_rules = self._full['groupRules']
        startup_rules = self._full['startupRules']
        if not (rules or group_rules or startup_rules):
            self._list.add_widget(_empty_row('No actions configured'))
            return
        for rule in rules:
            self._list.add_widget(self._make_button_row(rule))
        for rule in group_rules:
            self._list.add_widget(self._make_group_rule_row(rule))
        for rule in startup_rules:
            self._list.add_widget(self._make_startup_row(rule))

    def _row_shell(self) -> Tuple[BoxLayout, BoxLayout, BoxLayout, BoxLayout]:
        """Two-column rule row mirroring the web ``.rule-item`` layout.

        Returns ``(row, left_top, left_bottom, right)``.

        - ``left_top`` / ``left_bottom`` are the two stacked lines of
          the left 50%-wide column. ``left_top`` holds the type badge
          and identifier; ``left_bottom`` holds the action description.
        - ``right`` is a vertically-centred horizontal row inside the
          right 50%-wide column. Callers populate it with the rule
          name, trigger badge, and edit/delete icons in display order;
          the column is right-anchored so the icons hug the row edge.

        A 1-px bottom divider in ``GRAY_300`` separates rows — a step
        up from the subtle ``BORDER`` token so the boundary between
        items reads clearly without becoming a loud stripe.
        """
        row_h = max(ROW_ICON_SIZE + 2 * theme.SPACE_2, 66)
        # Asymmetric padding: extra top + bottom space separates adjacent
        # rows so the divider line (drawn at row.y) reads as a section
        # between items rather than a stripe hugging the content.
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        height=row_h, spacing=theme.SPACE_2,
                        padding=(theme.SPACE_2, theme.SPACE_2,
                                 theme.SPACE_2, theme.SPACE_3))

        # Left column: stacked badge/ident line on top, action line below.
        left = BoxLayout(orientation='vertical', size_hint_x=0.5,
                         spacing=theme.SPACE_1)
        left_top = BoxLayout(orientation='horizontal', size_hint_y=None,
                             height=24, spacing=theme.SPACE_2)
        left_bottom = BoxLayout(orientation='horizontal', size_hint_y=None,
                                height=24, spacing=theme.SPACE_2)
        left.add_widget(left_top)
        left.add_widget(left_bottom)

        # Right column: a single horizontal row of elements, vertically
        # centred and right-anchored inside its half of the row.
        right_wrap = AnchorLayout(anchor_x='right', anchor_y='center',
                                  size_hint_x=0.5, padding=0)
        right = BoxLayout(orientation='horizontal',
                          size_hint=(None, None),
                          height=ROW_ICON_SIZE,
                          spacing=theme.SPACE_2)
        right.bind(minimum_width=right.setter('width'))
        right_wrap.add_widget(right)

        row.add_widget(left)
        row.add_widget(right_wrap)
        with row.canvas.before:
            Color(*theme.GRAY_300)
            border = Rectangle(pos=row.pos, size=(row.width, 1))
        def _sync_border(w, *_):
            border.pos = (w.x, w.y)
            border.size = (w.width, 1)
        row.bind(pos=_sync_border, size=_sync_border)
        return row, left_top, left_bottom, right

    def _ident_label(self, text: str, width: int = 0) -> Label:
        # Auto-size to texture so long button IDs / group names aren't
        # truncated. Both axes are ``size_hint=(None, None)`` and the
        # label is pos_hint-centered on the cross axis of its parent
        # BoxLayout — the same pattern ``_badge`` uses.
        lbl = Label(text=text, color=theme.TEXT_PRIMARY,
                    font_size='8.5sp', bold=True,
                    halign='left', valign='middle',
                    size_hint=(None, None), width=width,
                    pos_hint={'center_y': 0.5})
        def _sync(_w, ts):
            _w.size = (max(width, ts[0]), ts[1])
        lbl.bind(texture_size=_sync)
        lbl.texture_update()
        lbl.size = (max(width, lbl.texture_size[0]), lbl.texture_size[1])
        return lbl

    def _action_label(self, text: str) -> Label:
        # ``shorten`` truncates against width — and the first paint can
        # happen before layout has assigned a width, leaving the label
        # stuck at "..." even after the row is sized. Skip it; the
        # surrounding row already caps width via fixed siblings.
        lbl = Label(text=text, color=theme.TEXT_SECONDARY,
                    font_size='8sp',
                    halign='left', valign='middle')
        lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        return lbl

    def _name_label(self, text: str) -> Label:
        # Italic muted label that sits on the action line just left of
        # the trigger badge. Auto-sizes to its texture so the action
        # description (flex) absorbs the slack, and pos_hint-centred so
        # the text aligns vertically with the trigger badge.
        lbl = Label(text=text, color=theme.TEXT_MUTED,
                    font_size='8sp', italic=True,
                    halign='right', valign='middle',
                    size_hint=(None, None),
                    pos_hint={'center_y': 0.5})
        def _sync(_w, ts):
            _w.size = (ts[0] + theme.SPACE_2, ts[1])
        lbl.bind(texture_size=_sync)
        lbl.texture_update()
        lbl.size = (lbl.texture_size[0] + theme.SPACE_2, lbl.texture_size[1])
        return lbl

    def _make_button_row(self, rule: dict) -> BoxLayout:
        row, left_top, left_bottom, right = self._row_shell()
        left_top.add_widget(_badge('Button', 'button'))
        left_top.add_widget(self._ident_label(rule.get('button', '?')))
        left_bottom.add_widget(self._action_label(
            format_action(rule.get('action'))))
        if rule.get('name'):
            right.add_widget(self._name_label(rule['name']))
        right.add_widget(_badge(rule.get('trigger', 'release'), 'trigger'))
        rid = rule.get('id')
        right.add_widget(_pencil_button(
            lambda: self._open_edit_button(rule)))
        right.add_widget(_trash_button(
            lambda: self._delete_button_rule(rid)))
        return row

    def _make_group_rule_row(self, rule: dict) -> BoxLayout:
        row, left_top, left_bottom, right = self._row_shell()
        left_top.add_widget(_badge('Group', 'group'))
        gid = rule.get('groupId', '?')
        gname = next((g.get('name', gid) for g in self._full['groups']
                      if g.get('id') == gid), gid)
        left_top.add_widget(self._ident_label(gname))
        left_bottom.add_widget(self._action_label(
            format_action(rule.get('action'))))
        if rule.get('name'):
            right.add_widget(self._name_label(rule['name']))
        right.add_widget(_badge(rule.get('trigger', 'release'), 'trigger'))
        rid = rule.get('id')
        right.add_widget(_pencil_button(
            lambda: self._open_edit_group_rule(rule)))
        right.add_widget(_trash_button(
            lambda: self._delete_group_rule(rid)))
        return row

    def _make_startup_row(self, rule: dict) -> BoxLayout:
        row, left_top, left_bottom, right = self._row_shell()
        left_top.add_widget(_badge('Startup', 'startup'))
        name = rule.get('name', '(unnamed)')
        left_top.add_widget(self._ident_label(name, width=180))
        left_bottom.add_widget(self._action_label(
            format_action(rule.get('action'))))
        rid = rule.get('id')
        right.add_widget(_pencil_button(
            lambda: self._open_edit_startup(rule)))
        right.add_widget(_trash_button(
            lambda: self._delete_startup_rule(rid)))
        return row

    # ---- Form open / close helpers -----------------------------------

    def _open_add_form(self) -> None:
        self._editing_kind = None
        self._editing_id = None
        self._form_target = 'button'
        self._form_button = 'button:1'
        self._form_action = 'none'
        self._form_trigger = 'release'
        self._form_name = ''
        self._form_params = {}
        groups = self._full['groups']
        self._form_group_id = groups[0].get('id', '') if groups else ''
        self._form_group_action_type = 'chord-progression'
        self._form_group_progression = self._default_progression()
        self._form_group_octave = 4
        self._form_group_trigger = 'release'
        self._mode = 'form'
        self._render()

    def _open_edit_button(self, rule: dict) -> None:
        self._editing_kind = 'button'
        self._editing_id = rule.get('id')
        self._form_target = 'button'
        self._form_button = rule.get('button', 'button:1')
        action = rule.get('action')
        self._form_action, self._form_params = _split_action(action)
        self._form_trigger = rule.get('trigger', 'release')
        self._form_name = rule.get('name', '')
        self._mode = 'form'
        self._render()

    def _open_edit_group_rule(self, rule: dict) -> None:
        self._editing_kind = 'group'
        self._editing_id = rule.get('id')
        self._form_target = 'group'
        self._form_group_id = rule.get('groupId', '')
        action = rule.get('action') or {}
        self._form_group_action_type = action.get('type', 'chord-progression')
        self._form_group_progression = action.get('progression',
                                                  self._default_progression())
        self._form_group_octave = int(action.get('octave', 4) or 4)
        self._form_group_trigger = rule.get('trigger', 'release')
        self._form_name = rule.get('name', '')
        self._mode = 'form'
        self._render()

    def _open_edit_startup(self, rule: dict) -> None:
        self._editing_kind = 'startup'
        self._editing_id = rule.get('id')
        self._form_target = 'startup'
        action = rule.get('action')
        self._form_action, self._form_params = _split_action(action)
        self._form_name = rule.get('name', '')
        self._mode = 'form'
        self._render()

    def _close_form(self) -> None:
        self._mode = 'list'
        self._editing_kind = None
        self._editing_id = None
        self._render()

    # ---- Form view ----------------------------------------------------

    def _build_form_view(self) -> BoxLayout:
        wrap = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        # Scrollable form body — 2-column grid matching the velocity /
        # strum-release panels' ``.settings-form`` layout.
        scroll = ScrollView(do_scroll_x=False, bar_width=4)
        form = _two_col_form()
        form.padding = [theme.SPACE_2, 0, theme.SPACE_2, 0]
        scroll.add_widget(form)
        # Only show target selector when adding (not editing).
        if self._editing_id is None:
            form.add_widget(_setting_row('Target Type', _dropdown(
                _TARGET_TYPES, self._form_target,
                on_change=self._on_target_change)))
        if self._form_target == 'button':
            self._build_button_fields(form)
        elif self._form_target == 'group':
            self._build_group_fields(form)
        else:
            self._build_startup_fields(form)
        # Name field intentionally omitted from the UI: this build
        # targets a keyboard-less appliance. Existing names on edited
        # rules are preserved because the save methods merge over the
        # original rule dict and only overwrite ``name`` when set.
        wrap.add_widget(scroll)
        # Form actions — match the rounded pill style of "+ Add Action".
        action_h = int(theme.CONTROL_HEIGHT * 1.5)
        action_r = int(theme.CONTROL_HEIGHT * 0.75)
        actions = BoxLayout(orientation='horizontal', size_hint_y=None,
                            height=action_h + 2 * theme.SPACE_1,
                            spacing=theme.SPACE_2,
                            padding=(0, theme.SPACE_1))
        actions.add_widget(Widget())
        actions.add_widget(_secondary_button(
            'Cancel', self._close_form,
            width=160, height=action_h,
            font_size='12sp', radius=action_r))
        actions.add_widget(_accent_button(
            'Save', self._save_form,
            width=160, height=action_h,
            font_size='12sp', radius=action_r))
        wrap.add_widget(actions)
        return wrap

    def _build_button_fields(self, form: GridLayout) -> None:
        buttons = _enabled_buttons(self._button_count)
        form.add_widget(_setting_row('Button', _dropdown(
            buttons, self._form_button,
            on_change=lambda v: self._set_attr('_form_button', v))))
        form.add_widget(_setting_row('Action', _dropdown(
            _action_choices(), self._form_action,
            on_change=self._on_action_change)))
        self._render_param_fields(form, self._form_action)
        form.add_widget(_setting_row('Trigger', _dropdown(
            _TRIGGER_OPTIONS, self._form_trigger,
            on_change=lambda v: self._set_attr('_form_trigger', v))))

    def _build_group_fields(self, form: GridLayout) -> None:
        groups = self._full['groups']
        group_ids = tuple(g.get('id', '') for g in groups) or ('',)
        # Resolve current id to name for the dropdown's display.
        id_to_name = {g.get('id', ''): g.get('name', g.get('id', ''))
                      for g in groups}
        name_to_id = {v: k for k, v in id_to_name.items()}
        names = tuple(id_to_name.get(gid, gid) for gid in group_ids)
        current_name = id_to_name.get(self._form_group_id,
                                      names[0] if names else '')
        form.add_widget(_setting_row('Group', _dropdown(
            names, current_name,
            on_change=lambda v: self._set_attr('_form_group_id',
                                               name_to_id.get(v, v)))))
        form.add_widget(_setting_row('Action Type', _dropdown(
            ('chord-progression',), 'chord-progression')))
        progs = self._progression_names()
        form.add_widget(_setting_row('Chord Progression', _dropdown(
            progs, self._form_group_progression,
            on_change=lambda v: self._set_attr('_form_group_progression', v))))
        oct_in = _number_input(self._form_group_octave, width_hint=1.0)
        oct_in.bind(text=lambda _w, v: self._set_int_attr(
            '_form_group_octave', v, default=4))
        form.add_widget(_setting_row('Octave', oct_in))
        form.add_widget(_setting_row('Trigger', _dropdown(
            _TRIGGER_OPTIONS, self._form_group_trigger,
            on_change=lambda v: self._set_attr('_form_group_trigger', v))))

    def _build_startup_fields(self, form: GridLayout) -> None:
        form.add_widget(_setting_row('Action', _dropdown(
            _action_choices(), self._form_action,
            on_change=self._on_action_change)))
        self._render_param_fields(form, self._form_action)

    def _render_param_fields(self, form: GridLayout, action: str) -> None:
        defn = _action_def(action)
        for param in defn.get('params') or ():
            key = param['key']
            current = self._form_params.get(key, param.get('default'))
            if param['type'] == 'select':
                widget = _dropdown(
                    tuple(param.get('options') or ()), str(current),
                    on_change=lambda v, k=key: self._set_param(k, v))
            elif param['type'] == 'number':
                allow_float = isinstance(param.get('step'), float) or \
                    isinstance(param.get('default'), float)
                widget = _number_input(current, width_hint=1.0,
                                       allow_float=allow_float)
                widget.bind(text=lambda _w, v, k=key,
                            f=allow_float: self._set_param(
                                k, _coerce_number(v, f)))
            else:
                widget = TextInput(
                    text=str(current), multiline=False, write_tab=False,
                    size_hint=(1, None), height=theme.CONTROL_HEIGHT, font_size='9.5sp',
                    background_color=theme.BG_SURFACE_ALT,
                    foreground_color=theme.TEXT_PRIMARY,
                    cursor_color=theme.ACCENT,
                )
                widget.bind(text=lambda _w, v, k=key:
                            self._set_param(k, v))
            form.add_widget(_setting_row(param['label'], widget))

    def _form_title(self) -> str:
        if self._editing_id is not None:
            target = self._editing_kind or self._form_target
            return f'Edit {target.capitalize()} Action'
        return 'Add Action'

    # ---- Form mutators -------------------------------------------------

    def _set_attr(self, name: str, value: Any) -> None:
        setattr(self, name, value)

    def _set_int_attr(self, name: str, value: str, default: int) -> None:
        try:
            setattr(self, name, int(value))
        except (TypeError, ValueError):
            setattr(self, name, default)

    def _set_param(self, key: str, value: Any) -> None:
        self._form_params = {**self._form_params, key: value}

    def _on_target_change(self, value: str) -> None:
        self._form_target = value
        self._form_action = 'none'
        self._form_params = {}
        self._render()

    def _on_action_change(self, value: str) -> None:
        self._form_action = value
        defn = _action_def(value)
        self._form_params = {p['key']: p.get('default')
                             for p in (defn.get('params') or ())}
        self._render()

    def _default_progression(self) -> str:
        names = self._progression_names()
        return names[0] if names else ''

    def _progression_names(self) -> Tuple[str, ...]:
        return tuple(sorted(self._progressions.keys())) or ('',)

    # ---- Save / delete -------------------------------------------------

    def _save_form(self) -> None:
        if self._form_target == 'button':
            self._save_button_rule()
        elif self._form_target == 'group':
            self._save_group_rule()
        else:
            self._save_startup_rule()

    def _save_button_rule(self) -> None:
        action = _materialize_action(self._form_action, self._form_params)
        if action is None:
            return
        rule = {'button': self._form_button, 'action': action,
                'trigger': self._form_trigger}
        if self._form_name:
            rule['name'] = self._form_name
        rules = list(self._full['rules'])
        if self._editing_id is not None:
            rules = [{**r, **rule} if r.get('id') == self._editing_id else r
                     for r in rules]
        else:
            rules.append(rule)
        self._full['rules'] = rules
        self._commit_and_close()

    def _save_group_rule(self) -> None:
        if not self._form_group_id:
            return
        action = {'type': self._form_group_action_type,
                  'progression': self._form_group_progression,
                  'octave': self._form_group_octave}
        rule = {'groupId': self._form_group_id,
                'trigger': self._form_group_trigger, 'action': action}
        if self._form_name:
            rule['name'] = self._form_name
        rules = list(self._full['groupRules'])
        if self._editing_id is not None:
            rules = [{**r, **rule} if r.get('id') == self._editing_id else r
                     for r in rules]
        else:
            rules.append(rule)
        self._full['groupRules'] = rules
        self._commit_and_close()

    def _save_startup_rule(self) -> None:
        action = _materialize_action(self._form_action, self._form_params)
        if action is None:
            return
        rule = {'action': action}
        if self._form_name:
            rule['name'] = self._form_name
        rules = list(self._full['startupRules'])
        if self._editing_id is not None:
            rules = [{**r, **rule} if r.get('id') == self._editing_id else r
                     for r in rules]
        else:
            rules.append(rule)
        self._full['startupRules'] = rules
        self._commit_and_close()

    def _delete_button_rule(self, rid: Optional[str]) -> None:
        if not rid:
            return
        self._full['rules'] = [r for r in self._full['rules']
                               if r.get('id') != rid]
        self._commit()

    def _delete_group_rule(self, rid: Optional[str]) -> None:
        if not rid:
            return
        self._full['groupRules'] = [r for r in self._full['groupRules']
                                    if r.get('id') != rid]
        self._commit()

    def _delete_startup_rule(self, rid: Optional[str]) -> None:
        if not rid:
            return
        self._full['startupRules'] = [r for r in self._full['startupRules']
                                      if r.get('id') != rid]
        self._commit()

    def _commit_and_close(self) -> None:
        self._mode = 'list'
        self._editing_kind = None
        self._editing_id = None
        self._commit()
        self._render()

    def _commit(self) -> None:
        if self._bridge is None:
            return
        self._bridge.set_config('strummer.actionRules', dict(self._full))


def _split_action(action: Any) -> Tuple[str, Dict[str, Any]]:
    """Split a stored action value into (action_name, params)."""
    if action is None:
        return 'none', {}
    if isinstance(action, str):
        return action, {}
    if isinstance(action, list):
        if not action:
            return 'none', {}
        name = str(action[0])
        defn = _action_def(name)
        params = {}
        for i, p in enumerate(defn.get('params') or ()):
            if i + 1 < len(action):
                params[p['key']] = action[i + 1]
        return name, params
    if isinstance(action, dict):
        kind = str(action.get('type') or 'none')
        params = {k: v for k, v in action.items() if k != 'type'}
        return kind, params
    return 'none', {}


def _materialize_action(name: str, params: Dict[str, Any]) -> Any:
    """Pack the form's (name, params) back into a config-ready action.

    Bare-string actions stay strings; parameterized ones become
    ``[name, p1, p2, ...]`` in the order declared in the catalog.
    """
    if not name or name == 'none':
        return None
    defn = _action_def(name)
    pdefs = defn.get('params') or ()
    if not pdefs:
        return name
    values = [params.get(p['key'], p.get('default')) for p in pdefs]
    return [name, *values]


def _coerce_number(text: str, allow_float: bool) -> Any:
    try:
        return float(text) if allow_float else int(text)
    except (TypeError, ValueError):
        return text


class GroupsPanel(BoxLayout):
    """Editor for ``actionRules.groups`` (named button collections).

    Mirrors the web ``<action-rules-config mode="groups">`` panel: a
    list view of group cards (name + button chips) with edit/delete
    affordances, swapped for a form view (name input + clickable
    button-chip toggle grid) when adding or editing. ``groupRules``
    are surfaced in :class:`ActionRulesPanel`; this panel preserves
    them on every commit so the sibling list stays intact.
    """

    def __init__(self, bridge: Optional[UIBridge] = None,
                 button_count: int = 8, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_2, **kwargs)
        self._bridge = bridge
        self._button_count = button_count
        self._full = extract_action_rules(None)

        # Form state
        self._mode: str = 'list'  # 'list' | 'form'
        self._editing_id: Optional[str] = None
        self._form_name: str = ''
        self._form_buttons: list = []

        self._body = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        self.add_widget(self._body)
        self._render()

        if bridge is not None:
            bridge.on('config', self._on_config)

    # ---- Bridge events ------------------------------------------------

    def _on_config(self, payload: Any) -> None:
        self._full = extract_action_rules(payload)
        if self._mode == 'list':
            self._render()

    # ---- Top-level render --------------------------------------------

    def _render(self) -> None:
        self._body.clear_widgets()
        if self._mode == 'list':
            self._body.add_widget(self._build_list_view())
        else:
            self._body.add_widget(self._build_form_view())

    # ---- List view ----------------------------------------------------

    def _build_list_view(self) -> BoxLayout:
        wrap = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        add_btn = _accent_button(
            '+ Add Group', self._open_add_form,
            width=150,
            height=theme.CONTROL_HEIGHT,
            font_size='12sp', radius=int(theme.CONTROL_HEIGHT * 0.5),
        )
        scroll, self._groups_list = _scroll_list()
        wrap.add_widget(_section_card('', scroll, header_widget=add_btn))
        self._populate_list()
        return wrap

    def _populate_list(self) -> None:
        self._groups_list.clear_widgets()
        if not self._full['groups']:
            self._groups_list.add_widget(
                _empty_row('No button groups configured'))
            return
        for group in self._full['groups']:
            self._groups_list.add_widget(self._make_group_row(group))

    def _make_group_row(self, group: dict) -> BoxLayout:
        # Asymmetric padding + 1-px bottom border mirrors the action-rules
        # row shell so the two panels read as the same family of items.
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        spacing=theme.SPACE_2,
                        padding=(theme.SPACE_2, theme.SPACE_1,
                                 theme.SPACE_2, theme.SPACE_3))
        with row.canvas.before:
            Color(*theme.GRAY_300)
            border = Rectangle(pos=row.pos, size=(row.width, 1))
        def _sync_border(w, *_):
            border.pos = (w.x, w.y)
            border.size = (w.width, 1)
        row.bind(pos=_sync_border, size=_sync_border)
        info = BoxLayout(orientation='vertical', spacing=theme.SPACE_1)
        # Line 1: group name
        name_lbl = Label(text=group.get('name', '(unnamed)'),
                         color=theme.TEXT_PRIMARY, font_size='8.5sp',
                         bold=True, halign='left', valign='middle',
                         size_hint_y=None, height=24)
        name_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        info.add_widget(name_lbl)
        # Line 2: button chips
        chips = self._chip_row(group.get('buttons') or [])
        info.add_widget(chips)
        row.add_widget(info)
        # Trailing edit/delete column
        gid = group.get('id')
        actions = BoxLayout(orientation='horizontal', size_hint=(None, None),
                            width=2 * ROW_ICON_SIZE + theme.SPACE_1,
                            height=ROW_ICON_SIZE, spacing=theme.SPACE_1,
                            pos_hint={'center_y': 0.5})
        actions.add_widget(_pencil_button(
            lambda g=group: self._open_edit_form(g)))
        actions.add_widget(_trash_button(
            lambda i=gid: self._delete_group(i)))
        row.add_widget(actions)
        row.height = max(ROW_ICON_SIZE + 2 * theme.SPACE_2,
                         24 + chips.height + theme.SPACE_1
                         + theme.SPACE_1 + theme.SPACE_3)
        return row

    def _chip_row(self, buttons: list) -> BoxLayout:
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        height=32, spacing=4)
        if not buttons:
            row.add_widget(Label(text='(no buttons)',
                                 color=theme.TEXT_MUTED, font_size='8sp',
                                 halign='left', valign='middle'))
            return row
        for btn in buttons:
            row.add_widget(_button_chip(str(btn), selected=False))
        row.add_widget(Widget())  # trailing spacer
        return row


    # ---- Form open / close --------------------------------------------

    def _open_add_form(self) -> None:
        self._editing_id = None
        # No keyboard on the appliance — auto-name new groups by index.
        self._form_name = f'Group {len(self._full["groups"]) + 1}'
        self._form_buttons = []
        self._mode = 'form'
        self._render()

    def _open_edit_form(self, group: dict) -> None:
        self._editing_id = group.get('id')
        self._form_name = group.get('name', '')
        self._form_buttons = list(group.get('buttons') or [])
        self._mode = 'form'
        self._render()

    def _close_form(self) -> None:
        self._mode = 'list'
        self._editing_id = None
        self._render()

    # ---- Form view ----------------------------------------------------

    def _build_form_view(self) -> BoxLayout:
        wrap = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        # Header omitted — Cancel at the bottom handles dismiss.
        scroll = ScrollView(do_scroll_x=False, bar_width=4)
        form = BoxLayout(orientation='vertical', size_hint_y=None,
                         spacing=theme.SPACE_3, padding=(theme.SPACE_2, 0))
        form.bind(minimum_height=form.setter('height'))
        scroll.add_widget(form)
        # Group name as a static title — no keyboard on the appliance, so
        # names are either preserved on edit or auto-generated on add.
        title_lbl = Label(
            text=self._form_name, color=theme.TEXT_PRIMARY,
            font_size='14.5sp', bold=True,
            size_hint_y=None, height=theme.CONTROL_HEIGHT,
            halign='left', valign='middle',
        )
        title_lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        form.add_widget(title_lbl)
        # Button-chip toggle grid — 1.5× sized chips that fill their cell.
        toggle_lbl = _form_field_label('Buttons (tap to toggle)')
        form.add_widget(toggle_lbl)
        chip_h = int(theme.CONTROL_HEIGHT * 1.5)
        grid = GridLayout(cols=4, spacing=theme.SPACE_2, size_hint_y=None)
        grid.bind(minimum_height=grid.setter('height'))
        for btn_id in _enabled_buttons(self._button_count):
            selected = btn_id in self._form_buttons
            grid.add_widget(_button_chip(
                btn_id, selected=selected,
                on_release=lambda b=btn_id: self._toggle_button(b),
                height=chip_h, font_size='12sp', size_hint_x=1))
        form.add_widget(grid)
        wrap.add_widget(scroll)
        # Save/cancel row — match the rounded pill style of the Actions form.
        action_h = int(theme.CONTROL_HEIGHT * 1.5)
        action_r = int(theme.CONTROL_HEIGHT * 0.75)
        actions = BoxLayout(orientation='horizontal', size_hint_y=None,
                            height=action_h + 2 * theme.SPACE_1,
                            spacing=theme.SPACE_2,
                            padding=(0, theme.SPACE_1))
        actions.add_widget(Widget())
        actions.add_widget(_secondary_button(
            'Cancel', self._close_form,
            width=160, height=action_h,
            font_size='12sp', radius=action_r))
        actions.add_widget(_accent_button(
            'Save', self._save_group,
            width=160, height=action_h,
            font_size='12sp', radius=action_r))
        wrap.add_widget(actions)
        return wrap

    def _set_attr(self, name: str, value: Any) -> None:
        setattr(self, name, value)

    def _toggle_button(self, btn_id: str) -> None:
        if btn_id in self._form_buttons:
            self._form_buttons = [b for b in self._form_buttons if b != btn_id]
        else:
            self._form_buttons = [*self._form_buttons, btn_id]
        self._render()

    # ---- Save / delete -------------------------------------------------

    def _save_group(self) -> None:
        name = (self._form_name or '').strip()
        if not name:
            return
        group = {'name': name, 'buttons': list(self._form_buttons)}
        groups = list(self._full['groups'])
        if self._editing_id is not None:
            groups = [{**g, **group} if g.get('id') == self._editing_id else g
                      for g in groups]
        else:
            groups.append(group)
        self._full['groups'] = groups
        self._mode = 'list'
        self._editing_id = None
        self._commit()
        self._render()

    def _delete_group(self, gid: Optional[str]) -> None:
        if not gid:
            return
        self._full['groups'] = [g for g in self._full['groups']
                                if g.get('id') != gid]
        self._commit()
        if self._mode == 'list':
            self._render()

    def _commit(self) -> None:
        if self._bridge is None:
            return
        self._bridge.set_config('strummer.actionRules', dict(self._full))


class ChordProgressionsPanel(BoxLayout):
    """Editor for ``strummer.chordProgressions`` (name -> list of chords).

    Mirrors the web ``<chord-progression-creator>`` layout: a
    progression selector at the top (name input + dropdown of existing
    progressions + New/Delete), a chord-chip preview row, an action row
    (Add chord / Clear All / Save), and a chord builder with Root +
    Accidental, Quality, and Extension button groups.
    """

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_2, **kwargs)
        self._bridge = bridge
        self._progressions: dict = {}

        # Editing state
        self._selected_key: Optional[str] = None  # None = new
        self._progression_name: str = ''
        self._selected_chords: list = []
        # Chord builder state
        self._root: str = 'C'
        self._accidental: str = ''
        self._quality: str = ''
        self._extension: str = ''

        self._body = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        self.add_widget(self._body)
        self._render()

        if bridge is not None:
            bridge.on('config', self._on_config)

    # ---- Bridge events ------------------------------------------------

    def _on_config(self, payload: Any) -> None:
        self._progressions = extract_chord_progressions(payload)
        self._render()

    # ---- Render -------------------------------------------------------

    def _render(self) -> None:
        # Auto-name new progressions before painting so the title
        # below the selector row has something to show.
        if self._selected_key is None and not self._progression_name:
            self._progression_name = self._default_new_name()
        self._body.clear_widgets()
        # Full-width selector row sits above a two-column split:
        # progression editing on the left, chord builder on the right.
        # A horizontal rule with padding above/below separates the two
        # regions so the selector reads as the top-of-panel chrome.
        self._body.add_widget(self._build_selector())
        self._body.add_widget(_hdivider(height=theme.SPACE_5))
        columns = BoxLayout(orientation='horizontal',
                            spacing=theme.SPACE_5)
        left = BoxLayout(orientation='vertical', spacing=theme.SPACE_2)
        left.add_widget(self._build_title())
        left.add_widget(self._build_actions())
        left.add_widget(self._build_preview())
        left.add_widget(Widget())
        right = BoxLayout(orientation='vertical', spacing=theme.SPACE_3)
        right.add_widget(self._build_builder_title())
        right.add_widget(self._build_chord_builder())
        right.add_widget(Widget())
        columns.add_widget(left)
        columns.add_widget(right)
        self._body.add_widget(columns)

    def _default_new_name(self) -> str:
        return f'Chord Progression {len(self._progressions) + 1}'

    def _build_selector(self) -> BoxLayout:
        # Row height + button radius mirror the shared ``_dropdown`` helper
        # so the existing-progression dropdown reads as the same family of
        # input controls used by the Actions / velocity panels.
        row_h = theme.INPUT_HEIGHT
        pill_r = row_h // 2
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        height=row_h, spacing=theme.SPACE_2)
        keys = sorted(self._progressions.keys())
        spinner_values = tuple(keys) if keys else ('(no progressions)',)
        current = self._selected_key if self._selected_key in keys else \
            spinner_values[0]
        spinner = _dropdown(
            spinner_values, current,
            on_change=self._select_from_dropdown if keys else None)
        spinner.disabled = not keys
        row.add_widget(spinner)
        row.add_widget(_secondary_button(
            'New', self._create_new,
            width=120, height=row_h, font_size='12sp', radius=pill_r))
        delete_btn = _secondary_button(
            'Delete', self._delete_selected,
            width=120, height=row_h, font_size='12sp', radius=pill_r)
        delete_btn.disabled = self._selected_key is None
        row.add_widget(delete_btn)
        return row

    def _build_title(self) -> Label:
        # Static title showing the current progression name. No keyboard on
        # the appliance, so names are either preserved on load or auto-
        # generated for new progressions. Height uses ``INPUT_HEIGHT`` so
        # 22sp descenders ('g', 'p', 'y') aren't clipped by the label box.
        lbl = Label(
            text=self._progression_name, color=theme.TEXT_PRIMARY,
            font_size='14.5sp', bold=True,
            size_hint_y=None, height=theme.INPUT_HEIGHT,
            halign='left', valign='middle',
        )
        lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        return lbl

    def _build_preview(self) -> BoxLayout:
        # Top padding adds breathing room below the action row above; the
        # gap between the label and chip area uses SPACE_3 so the heading
        # reads as a distinct caption rather than crowding the chips.
        chips_h = theme.INPUT_HEIGHT
        top_pad = theme.SPACE_3
        label_gap = theme.SPACE_3
        wrap = BoxLayout(orientation='vertical', size_hint_y=None,
                         spacing=label_gap,
                         padding=(0, top_pad, 0, 0))
        wrap.add_widget(_form_field_label(
            f'Progression ({len(self._selected_chords)} chords)'))
        if not self._selected_chords:
            chips_row = BoxLayout(orientation='horizontal', size_hint_y=None,
                                  height=chips_h, spacing=theme.SPACE_2)
            empty = Label(
                text='Build a chord below and tap "Add"',
                color=theme.TEXT_MUTED, font_size='8sp',
                halign='left', valign='middle',
            )
            empty.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
            chips_row.add_widget(empty)
        else:
            # StackLayout flows chips left-to-right, top-to-bottom so they
            # wrap onto a new row when the column width is exceeded.
            chips_row = StackLayout(size_hint_y=None,
                                    spacing=(theme.SPACE_2, theme.SPACE_2))
            chips_row.bind(minimum_height=chips_row.setter('height'))
            tag_r = theme.SPACE_2
            for i, chord in enumerate(self._selected_chords):
                chips_row.add_widget(_chord_chip(
                    chord, lambda idx=i: self._remove_chord(idx),
                    height=chips_h, font_size='12sp', radius=tag_r))
        wrap.add_widget(chips_row)
        def _sync_h(*_):
            wrap.height = (top_pad + theme.FIELD_LABEL_HEIGHT
                           + label_gap + chips_row.height)
        chips_row.bind(height=_sync_h)
        _sync_h()
        return wrap

    def _build_actions(self) -> BoxLayout:
        btn_h = theme.CONTROL_HEIGHT
        pill_r = btn_h // 2
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        height=btn_h, spacing=theme.SPACE_2)
        current = _build_chord_token(self._root, self._accidental,
                                     self._quality, self._extension)
        add_btn = _accent_button(
            f'Add {current}', lambda: self._add_chord(current),
            width=130, height=btn_h, font_size='12sp', radius=pill_r)
        add_btn.disabled = self._is_invalid_accidental()
        row.add_widget(add_btn)
        row.add_widget(_secondary_button(
            'Clear All', self._clear_all,
            width=100, height=btn_h, font_size='12sp', radius=pill_r))
        save_btn = _secondary_button(
            'Update' if self._is_editing() else 'Save',
            self._save_progression,
            width=90, height=btn_h, font_size='12sp', radius=pill_r)
        save_btn.disabled = (not (self._progression_name or '').strip()
                             or not self._selected_chords)
        row.add_widget(save_btn)
        row.add_widget(Widget())
        return row

    def _build_builder_title(self) -> Label:
        # Matches the progression-name title style on the left column so
        # the two columns read as the same heading hierarchy.
        lbl = Label(
            text='Build Progression', color=theme.TEXT_PRIMARY,
            font_size='14.5sp', bold=True,
            size_hint_y=None, height=theme.INPUT_HEIGHT,
            halign='left', valign='middle',
        )
        lbl.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        return lbl

    def _build_chord_builder(self) -> BoxLayout:
        # Section-to-section gap mirrors the breathing room between
        # adjacent ``_setting_row`` blocks in the Actions / Groups forms
        # (~24px), so the now-two-row Quality / Extension blocks don't
        # crowd their neighbours.
        wrap = BoxLayout(orientation='vertical', size_hint_y=None,
                         spacing=theme.SPACE_5)
        # Root + Accidental
        wrap.add_widget(self._builder_section(
            'Root & Accidental', self._root_accidental_buttons()))
        # Quality
        wrap.add_widget(self._builder_section(
            'Quality', self._quality_buttons()))
        # Extension
        wrap.add_widget(self._builder_section(
            'Extension', self._extension_buttons()))
        # Sections have dynamic heights (StackLayout rows wrap), so keep
        # the wrapper's height in sync with whatever each child reports.
        def _sync(*_):
            wrap.height = sum(c.height for c in wrap.children) + \
                theme.SPACE_5 * max(0, len(wrap.children) - 1)
        for child in wrap.children:
            child.bind(height=_sync)
        _sync()
        return wrap

    # Chord-builder rows are sized to the same 1.5× scale as the action
    # row above, so the whole panel reads as one family of tag controls.
    # ``_BUILDER_BTN_R`` is a small tag-style radius (not a full pill) so
    # the toggles read as selectable tags rather than action buttons.
    _BUILDER_BTN_H = theme.CONTROL_HEIGHT
    _BUILDER_FONT = '12sp'
    _BUILDER_BTN_R = theme.SPACE_2

    def _builder_section(self, label: str, buttons: list) -> BoxLayout:
        # Label-to-row gap matches the ``_setting_row`` pattern used by
        # the Actions / Groups forms so the field heading sits a clear
        # step above the controls rather than crowding them.
        label_gap = theme.SPACE_2
        col = BoxLayout(orientation='vertical', size_hint_y=None,
                        spacing=label_gap)
        col.add_widget(_form_field_label(label))
        # StackLayout flows buttons left-to-right and wraps to a new row
        # when the column width is exceeded, so wider toggles naturally
        # span two rows in the narrow right-hand column.
        row = StackLayout(size_hint_y=None,
                          spacing=(theme.SPACE_2, theme.SPACE_2))
        row.bind(minimum_height=row.setter('height'))
        for b in buttons:
            row.add_widget(b)
        col.add_widget(row)
        def _sync(*_):
            col.height = (theme.FIELD_LABEL_HEIGHT + row.height
                          + label_gap)
        row.bind(height=_sync)
        _sync()
        return col

    def _root_accidental_buttons(self) -> list:
        h, fs, r = self._BUILDER_BTN_H, self._BUILDER_FONT, self._BUILDER_BTN_R
        out: list = []
        for root in _BUILDER_ROOTS:
            out.append(_option_button(
                root, selected=(self._root == root),
                on_release=lambda r=root: self._set_root(r),
                width=41, height=h, font_size=fs, radius=r))
        # Visible vertical rule separating roots from accidentals,
        # matching the divider in the web chord builder.
        out.append(_vdivider(h, width=theme.SPACE_3))
        for label, value in _BUILDER_ACCIDENTALS:
            disabled = _is_accidental_disabled(self._root, value)
            out.append(_option_button(
                label, selected=(self._accidental == value),
                disabled=disabled,
                on_release=lambda v=value: self._set_accidental(v),
                width=41, height=h, font_size=fs, radius=r,
                painter=_ACCIDENTAL_PAINTERS.get(value)))
        return out

    def _quality_buttons(self) -> list:
        h, fs, r = self._BUILDER_BTN_H, self._BUILDER_FONT, self._BUILDER_BTN_R
        out: list = []
        for label, value in _BUILDER_QUALITIES:
            out.append(_option_button(
                label, selected=(self._quality == value),
                on_release=lambda v=value: self._set_quality(v),
                width=48, height=h, font_size=fs, radius=r))
        return out

    def _extension_buttons(self) -> list:
        disabled_all = _extension_disabled_for(self._quality)
        h, fs, r = self._BUILDER_BTN_H, self._BUILDER_FONT, self._BUILDER_BTN_R
        out: list = []
        for label, value in _BUILDER_EXTENSIONS:
            # 'None' is always allowed; other extensions blocked for sus/5
            disabled = disabled_all and value != ''
            out.append(_option_button(
                label, selected=(self._extension == value),
                disabled=disabled,
                on_release=lambda v=value: self._set_extension(v),
                width=56, height=h, font_size=fs, radius=r))
        return out

    # ---- Builder state mutators --------------------------------------

    def _set_root(self, root: str) -> None:
        self._root = root
        # Auto-clear invalid accidental for this root
        if self._accidental and _is_accidental_disabled(
                root, self._accidental):
            self._accidental = ''
        self._render()

    def _set_accidental(self, value: str) -> None:
        self._accidental = value
        self._render()

    def _set_quality(self, value: str) -> None:
        self._quality = value
        if _extension_disabled_for(value):
            self._extension = ''
        self._render()

    def _set_extension(self, value: str) -> None:
        self._extension = value
        self._render()

    def _is_invalid_accidental(self) -> bool:
        return bool(self._accidental) and _is_accidental_disabled(
            self._root, self._accidental)

    def _is_editing(self) -> bool:
        return self._selected_key is not None

    # ---- Chord list mutators -----------------------------------------

    def _add_chord(self, chord: str) -> None:
        self._selected_chords = [*self._selected_chords, chord]
        self._render()

    def _remove_chord(self, index: int) -> None:
        if 0 <= index < len(self._selected_chords):
            self._selected_chords = [
                c for i, c in enumerate(self._selected_chords) if i != index]
            self._render()

    def _clear_all(self) -> None:
        self._selected_chords = []
        self._render()

    # ---- Progression selection / persistence -------------------------

    def _select_from_dropdown(self, key: str) -> None:
        if key not in self._progressions:
            return
        self._selected_key = key
        self._progression_name = key
        self._selected_chords = list(self._progressions[key])
        self._render()

    def _create_new(self) -> None:
        self._selected_key = None
        self._progression_name = ''
        self._selected_chords = []
        self._render()

    def _save_progression(self) -> None:
        name = (self._progression_name or '').strip()
        if not name or not self._selected_chords:
            return
        new_progs = dict(self._progressions)
        # Renaming an existing key: drop the old entry first.
        if (self._selected_key is not None
                and self._selected_key != name
                and self._selected_key in new_progs):
            del new_progs[self._selected_key]
        new_progs[name] = list(self._selected_chords)
        self._progressions = new_progs
        self._selected_key = name
        self._commit()
        self._render()

    def _delete_selected(self) -> None:
        if self._selected_key is None:
            return
        self._delete(self._selected_key)
        self._create_new()

    # ---- Test-compatible add / delete helpers ------------------------

    def _add(self) -> None:
        """Save the current (name, chords) pair to ``chordProgressions``.

        Backwards-compatible entry point used by tests: mirrors the
        web's ``saveProgression`` flow.
        """
        self._save_progression()

    def _delete(self, name: str) -> None:
        if name not in self._progressions:
            return
        new_progs = dict(self._progressions)
        del new_progs[name]
        self._progressions = new_progs
        if self._selected_key == name:
            self._selected_key = None
        self._commit()
        self._render()

    def _commit(self) -> None:
        if self._bridge is None:
            return
        self._bridge.set_config('strummer.chordProgressions',
                                dict(self._progressions))





def extract_server_state(config_event: Any) -> dict:
    """Pull config-management fields out of a ``'config'`` event.

    The Server panel only needs ``currentConfigName``, the
    ``availableConfigs`` list, and ``isSavedState`` (which controls
    when the saved snapshot is refreshed for dirty tracking).
    """
    if not isinstance(config_event, dict):
        return {'currentConfigName': None, 'availableConfigs': [],
                'isSavedState': False, 'config': None, 'throttleMs': 150}
    try:
        throttle = int(config_event.get('throttleMs', 150))
    except (TypeError, ValueError):
        throttle = 150
    return {
        'currentConfigName': config_event.get('currentConfigName'),
        'availableConfigs': list(config_event.get('availableConfigs') or []),
        'isSavedState': bool(config_event.get('isSavedState')),
        'config': config_event.get('config'),
        'throttleMs': throttle,
    }


def compute_dirty(current_config: Any, saved_snapshot: Optional[str]) -> bool:
    """``True`` when the current config differs from the last saved snapshot.

    Snapshots are JSON strings (kept deterministic via ``sort_keys``) so a
    cheap string compare answers the question without recursing through
    nested dicts. A missing snapshot means we've never seen a saved
    state, so we report clean (the Save button will pick up the next
    real change).
    """
    import json
    if saved_snapshot is None or current_config is None:
        return False
    try:
        current = json.dumps(current_config, sort_keys=True)
    except (TypeError, ValueError):
        return False
    return current != saved_snapshot


class ServerSettingsPanel(BoxLayout):
    """Config save/load surface.

    Lists every ``.json`` file in the server's config directory, marks
    the active one, and lets the user switch between them. A Save button
    persists the current in-memory config; it stays disabled while the
    config matches the last saved snapshot (mirrors the web dashboard's
    dirty-tracking).
    """

    def __init__(self, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(orientation='vertical', spacing=theme.SPACE_3, **kwargs)
        self._bridge = bridge
        self._current_name: Optional[str] = None
        self._available: list = []
        self._saved_snapshot: Optional[str] = None
        self._dirty: bool = False
        self._throttle_ms: int = 150

        self.add_widget(self._build_header_row())
        self.add_widget(self._build_config_list())
        self.add_widget(self._build_create_row())
        # Push remaining space below the controls.
        self.add_widget(Widget())

        if bridge is not None:
            bridge.on('config', self._on_config)

    # ---- Rows ---------------------------------------------------------

    def _build_header_row(self) -> GridLayout:
        """Status + Save | Throttle stepper, packed into a 2-column grid."""
        form = _two_col_form()

        status_cell = BoxLayout(orientation='horizontal', size_hint_y=None,
                                height=theme.CONTROL_HEIGHT, spacing=theme.SPACE_2)
        self._status = Label(
            text='Current: (none)', color=theme.TEXT_SECONDARY,
            font_size='8.5sp', halign='left', valign='middle',
        )
        self._status.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        status_cell.add_widget(self._status)
        self._save_btn = Button(
            text='Save', size_hint=(None, None), size=(96, theme.CONTROL_HEIGHT),
            background_normal='', background_down='',
            background_color=theme.BG_SURFACE_ALT,
            color=theme.TEXT_MUTED, font_size='9.5sp',
            disabled=True,
        )
        self._save_btn.bind(on_release=lambda *_: self._save())
        status_cell.add_widget(self._save_btn)
        form.add_widget(status_cell)

        self._throttle_stepper = _NumberStepper(
            value=self._throttle_ms,
            min_value=0, max_value=250, step=1, decimals=0,
            on_commit=self._on_throttle_commit,
        )
        form.add_widget(_setting_row('Throttle (ms)', self._throttle_stepper))

        return form

    def _build_create_row(self) -> BoxLayout:
        row = BoxLayout(orientation='horizontal', size_hint_y=None,
                        height=theme.CONTROL_HEIGHT, spacing=theme.SPACE_2)
        row.add_widget(_setting_label('New config'))
        self._create_input = TextInput(
            text='', multiline=False, write_tab=False,
            size_hint=(1, None), height=theme.CONTROL_HEIGHT, font_size='9.5sp',
            background_color=theme.BG_SURFACE_ALT,
            foreground_color=theme.TEXT_PRIMARY,
            cursor_color=theme.ACCENT,
            hint_text='name (.json optional)',
        )
        self._create_input.bind(on_text_validate=lambda *_: self._create())
        row.add_widget(self._create_input)
        self._create_btn = _mode_button('Create', active=False)
        self._create_btn.size = (104, theme.CONTROL_HEIGHT)
        self._create_btn.font_size = '14sp'
        self._create_btn.bind(on_release=lambda *_: self._create())
        row.add_widget(self._create_btn)
        return row

    def _build_config_list(self) -> BoxLayout:
        wrap = BoxLayout(orientation='vertical', spacing=theme.SPACE_1)
        header = Label(
            text='[b]Available configs[/b]', markup=True, color=theme.TEXT_PRIMARY,
            font_size='9.5sp', size_hint_y=None, height=22,
            halign='left', valign='middle',
        )
        header.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        wrap.add_widget(header)
        scroll = ScrollView(do_scroll_x=False, bar_width=4)
        self._list_items = BoxLayout(orientation='vertical', size_hint_y=None,
                                     spacing=theme.SPACE_1)
        self._list_items.bind(minimum_height=self._list_items.setter('height'))
        scroll.add_widget(self._list_items)
        wrap.add_widget(scroll)
        return wrap

    # ---- Events from the bridge --------------------------------------

    def _on_config(self, payload: Any) -> None:
        state = extract_server_state(payload)
        self._current_name = state['currentConfigName']
        self._available = state['availableConfigs']
        if state['isSavedState']:
            self._refresh_snapshot(state['config'])
        self._dirty = compute_dirty(state['config'], self._saved_snapshot)
        self._throttle_ms = state['throttleMs']
        self._throttle_stepper.set_value(self._throttle_ms)
        self._sync_header()
        self._populate_list()

    def _refresh_snapshot(self, config: Any) -> None:
        import json
        if config is None:
            self._saved_snapshot = None
            return
        try:
            self._saved_snapshot = json.dumps(config, sort_keys=True)
        except (TypeError, ValueError):
            self._saved_snapshot = None

    # ---- User actions -------------------------------------------------

    def _save(self) -> None:
        if self._bridge is None or self._current_name is None:
            return
        self._bridge.save_config()

    def _load(self, name: str) -> None:
        if self._bridge is None or name == self._current_name:
            return
        self._bridge.load_config(name)

    def _create(self) -> None:
        if self._bridge is None:
            return
        name = (self._create_input.text or '').strip()
        if not name:
            return
        self._bridge.create_config(name)
        self._create_input.text = ''

    def _on_throttle_commit(self, raw: float) -> None:
        value = int(raw)
        if value == self._throttle_ms:
            return
        self._throttle_ms = value
        if self._bridge is not None:
            self._bridge.set_throttle(value)

    # ---- View sync helpers -------------------------------------------

    def _sync_header(self) -> None:
        name = self._current_name or '(none)'
        marker = ' •' if self._dirty else ''
        self._status.text = f'Current: {name}{marker}'
        can_save = self._bridge is not None and self._current_name is not None and self._dirty
        self._save_btn.disabled = not can_save
        self._save_btn.color = theme.TEXT_PRIMARY if can_save else theme.TEXT_MUTED
        self._save_btn.background_color = (
            theme.ACCENT_BG if can_save else theme.BG_SURFACE_ALT
        )

    def _populate_list(self) -> None:
        self._list_items.clear_widgets()
        if not self._available:
            self._list_items.add_widget(_empty_row('No saved configs'))
            return
        for name in self._available:
            is_active = (name == self._current_name)
            btn = _port_button(name, is_active)
            btn.bind(on_release=lambda _b, n=name: self._load(n))
            self._list_items.add_widget(btn)


def make_panel(panel_id: str, label: str, bridge: Optional[UIBridge]) -> BoxLayout:
    """Construct a panel body widget for ``panel_id``."""
    if panel_id == 'events':
        return EventsPanel(bridge=bridge)
    if panel_id == 'performance':
        return PerformancePanel(bridge=bridge)
    if panel_id == 'tabletVisualizer':
        return TabletVisualizerPanel(bridge=bridge)
    if panel_id == 'midiInput':
        return MIDIInputPanel(bridge=bridge)
    if panel_id == 'midiDevices':
        return MidiDevicesPanel(bridge=bridge)
    if panel_id == 'strummingSettings':
        return StrummingSettingsPanel(bridge=bridge)
    if panel_id == 'strumRelease':
        return StrumReleasePanel(bridge=bridge)
    if panel_id == 'slide':
        return SlidePanel(bridge=bridge)
    if panel_id == 'actions':
        return ActionRulesPanel(bridge=bridge)
    if panel_id == 'groups':
        return GroupsPanel(bridge=bridge)
    if panel_id == 'chordProgressions':
        return ChordProgressionsPanel(bridge=bridge)
    if panel_id == 'serverSettings':
        return ServerSettingsPanel(bridge=bridge)
    if panel_id in PARAMETER_MAPPING_SPECS:
        return ParameterMappingPanel(PARAMETER_MAPPING_SPECS[panel_id], bridge=bridge)
    return PlaceholderPanel(label=label)
