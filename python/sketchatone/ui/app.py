"""
Sketchatone native Kivy app.

Hosts the dashboard skeleton: top bar, panel tab strip, active panel
area, status bar. Panel bodies are placeholders for now — real widgets
will land one at a time as they're ported from the web build.

Kivy is imported at module load time, so this module must only be
imported when the optional ``[ui]`` extra is installed. The CLI in
``sketchatone.cli.ui`` does the lazy import.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from kivy.app import App
from kivy.graphics import Color, Ellipse, Line, Rectangle, RoundedRectangle
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.image import Image
from kivy.uix.label import Label
from kivy.uix.scrollview import ScrollView
from kivy.uix.widget import Widget

from . import panel_widgets, theme
from .bridge import UIBridge
from .panels import (
    CATEGORIES,
    DEFAULT_PANEL_ID,
    PANELS,
    CategoryInfo,
    PanelInfo,
    find_category,
    find_category_for_panel,
    find_panel,
)


# ---- Small canvas helper -------------------------------------------------

def _paint_bg(widget, rgba: theme.RGBA) -> None:
    """Paint ``widget`` with a solid background that tracks pos/size."""
    with widget.canvas.before:
        Color(*rgba)
        rect = Rectangle(pos=widget.pos, size=widget.size)

    def _sync(_instance, _value):
        rect.pos = widget.pos
        rect.size = widget.size

    widget.bind(pos=_sync, size=_sync)


# ---- Top bar -------------------------------------------------------------

LOGO_PATH = str(Path(__file__).parent / 'assets' / 'sketchatone-logo.png')

# Horizontal text padding applied inside each top-bar category button.
CATEGORY_TAB_PAD_X = 15


class TopBar(BoxLayout):
    def __init__(self, active_category_id: str,
                 on_select_category, on_toggle_theme=None, **kwargs) -> None:
        super().__init__(
            orientation='horizontal',
            size_hint_y=None,
            height=theme.TOPBAR_HEIGHT,
            padding=(theme.SPACE_4, theme.SPACE_3),
            spacing=theme.SPACE_3,
            **kwargs,
        )
        _paint_bg(self, theme.BG_SURFACE)

        # Left-aligned category strip.
        self._category_tabs: dict = {}
        for cat in CATEGORIES:
            tab = TopCategoryTab(cat, cat.id == active_category_id, on_select_category)
            self._category_tabs[cat.id] = tab
            self.add_widget(tab)

        # Divider between categories and the theme toggle.
        self.add_widget(Divider())

        # Theme toggle (icon, no label).
        self.theme_btn = ThemeToggleIcon(on_toggle=on_toggle_theme)
        self.add_widget(self.theme_btn)

        # Stretchy trailing spacer so all of the above stay left-packed.
        self.add_widget(Widget(size_hint_x=1))

    def set_active_category(self, category_id: str) -> None:
        for cid, tab in self._category_tabs.items():
            tab.set_active(cid == category_id)


class TopCategoryTab(Button):
    def __init__(self, category: CategoryInfo, active: bool, on_select, **kwargs) -> None:
        super().__init__(
            text=category.label,
            size_hint=(None, None), height=54,
            pos_hint={'center_y': 0.5},
            background_normal='', background_down='',
            background_color=(0, 0, 0, 0),
            color=theme.TEXT_PRIMARY,
            font_size='14sp',
            bold=True,
            **kwargs,
        )
        self.category = category
        # Pill background — radius tracks half the height so the ends
        # stay fully rounded regardless of the tab size.
        with self.canvas.before:
            self._pill_color = Color(*(theme.ACCENT_BG if active else theme.BG_SURFACE_ALT))
            self._pill = RoundedRectangle(pos=self.pos, size=self.size,
                                          radius=[self.height / 2.0])
        self.bind(pos=self._sync_pill, size=self._sync_pill)
        # Width tracks the rendered text plus a generous horizontal pad
        # on each side so labels feel airy regardless of length.
        self.bind(texture_size=self._sync_width)
        self.texture_update()
        self._sync_width(self, self.texture_size)
        self.bind(on_release=lambda *_: on_select(category.id))

    def _sync_width(self, _w, size) -> None:
        self.width = int(size[0]) + 2 * CATEGORY_TAB_PAD_X

    def _sync_pill(self, *_args: object) -> None:
        self._pill.pos = self.pos
        self._pill.size = self.size
        self._pill.radius = [self.height / 2.0]

    def set_active(self, active: bool) -> None:
        self._pill_color.rgba = theme.ACCENT_BG if active else theme.BG_SURFACE_ALT


class Divider(Widget):
    """Thin vertical divider line, vertically centered in its parent row."""

    def __init__(self, height: int = 32, width: int = 1, **kwargs) -> None:
        super().__init__(
            size_hint=(None, None),
            size=(width, height),
            pos_hint={'center_y': 0.5},
            **kwargs,
        )
        with self.canvas:
            self._color = Color(*theme.BORDER)
            self._rect = Rectangle(pos=self.pos, size=self.size)
        self.bind(pos=self._sync, size=self._sync)

    def _sync(self, *_args: object) -> None:
        self._rect.pos = self.pos
        self._rect.size = self.size


class ThemeToggleIcon(Button):
    """Half-filled circle icon for toggling between light and dark themes."""

    def __init__(self, on_toggle=None, size: int = 36, **kwargs) -> None:
        super().__init__(
            text='',
            size_hint=(None, None),
            size=(size, size),
            pos_hint={'center_y': 0.5},
            background_normal='',
            background_down='',
            background_color=(0, 0, 0, 0),
            **kwargs,
        )
        with self.canvas.after:
            self._fill_color = Color(*theme.TEXT_PRIMARY)
            # Left half of the circle (angles 180..360 sweep clockwise
            # from 6 o'clock through 9 back up to 12).
            self._fill = Ellipse(angle_start=180, angle_end=360)
            self._outline_color = Color(*theme.TEXT_PRIMARY)
            self._outline = Line(width=1.4)
        self.bind(pos=self._sync_icon, size=self._sync_icon)
        self._sync_icon()
        if on_toggle is not None:
            self.bind(on_release=lambda *_: on_toggle())

    def _sync_icon(self, *_args: object) -> None:
        pad = 6
        d = min(self.width, self.height) - 2 * pad
        ix = self.x + (self.width - d) / 2.0
        iy = self.y + (self.height - d) / 2.0
        self._fill.pos = (ix, iy)
        self._fill.size = (d, d)
        self._outline.ellipse = (ix, iy, d, d)


class StatusBadge(BoxLayout):
    """Plain status indicator: a coloured dot followed by a label."""

    def __init__(self, text: str, connected: bool, **kwargs) -> None:
        super().__init__(
            orientation='horizontal',
            size_hint=(None, 1),
            spacing=theme.SPACE_2,
            **kwargs,
        )
        dot_color = theme.STATUS_CONNECTED if connected else theme.STATUS_DISCONNECTED
        self._dot = Widget(size_hint=(None, None), size=(10, 10),
                           pos_hint={'center_y': 0.5})
        with self._dot.canvas:
            self._dot_color = Color(*dot_color)
            self._dot_ellipse = Ellipse(pos=self._dot.pos, size=self._dot.size)
        self._dot.bind(pos=self._sync_dot, size=self._sync_dot)
        self._label = Label(
            text=text, color=theme.TEXT_SECONDARY, font_size='12sp',
            size_hint=(None, 1),
            halign='left', valign='middle',
        )
        self._label.bind(texture_size=lambda w, s: setattr(w, 'width', s[0]))
        self.add_widget(self._dot)
        self.add_widget(self._label)
        self.bind(minimum_width=lambda w, v: setattr(w, 'width', v))

    def _sync_dot(self, *_args: object) -> None:
        self._dot_ellipse.pos = self._dot.pos
        self._dot_ellipse.size = self._dot.size

    def set_state(self, connected: bool, text: Optional[str] = None) -> None:
        """Update the dot colour and label text in-place."""
        self._dot_color.rgba = theme.STATUS_CONNECTED if connected else theme.STATUS_DISCONNECTED
        if text is not None:
            self._label.text = text


# ---- Tab bar -------------------------------------------------------------

# Horizontal text padding applied inside each sub-category panel tab.
PANEL_TAB_PAD_X = 16

# Active-tab underline geometry.
PANEL_TAB_UNDERLINE_THICKNESS = 3
PANEL_TAB_UNDERLINE_OFFSET = 10


class PanelTab(Button):
    def __init__(self, panel: PanelInfo, active: bool, on_select, **kwargs) -> None:
        super().__init__(
            text=panel.label,
            size_hint=(None, 1),
            background_normal='',
            background_down='',
            background_color=theme.BG_SURFACE,
            color=(theme.TEXT_PRIMARY if active else theme.TEXT_SECONDARY),
            font_size='19sp',
            bold=True,
            **kwargs,
        )
        self.panel = panel
        self._active = active
        with self.canvas.after:
            self._underline_color = Color(*self._underline_rgba(active))
            self._underline = Rectangle(pos=(0, 0), size=(0, 0))
        self.bind(
            pos=self._sync_underline,
            size=self._sync_underline,
            texture_size=self._on_texture_size,
        )
        self._sync_width(self, self.texture_size)
        self._sync_underline()
        self.bind(on_release=lambda *_: on_select(panel.id))

    @staticmethod
    def _underline_rgba(active: bool):
        return theme.TEXT_PRIMARY if active else (0, 0, 0, 0)

    def set_active(self, active: bool) -> None:
        self._active = active
        self.color = theme.TEXT_PRIMARY if active else theme.TEXT_SECONDARY
        self._underline_color.rgba = self._underline_rgba(active)
        self._sync_underline()

    def _on_texture_size(self, _w, size) -> None:
        self._sync_width(_w, size)
        self._sync_underline()

    def _sync_width(self, _w, size) -> None:
        self.width = int(size[0]) + 2 * PANEL_TAB_PAD_X

    def _sync_underline(self, *_args) -> None:
        if not self._active:
            self._underline.size = (0, 0)
            return
        tw, th = self.texture_size
        x = self.center_x - tw / 2.0
        y = (self.center_y - th / 2.0) - PANEL_TAB_UNDERLINE_OFFSET
        self._underline.pos = (x, y)
        self._underline.size = (tw, PANEL_TAB_UNDERLINE_THICKNESS)


class PanelTabBar(ScrollView):
    """Subcategory strip: shows the panels in the currently active category."""

    def __init__(self, active_id: str, on_select, **kwargs) -> None:
        super().__init__(
            size_hint_y=None,
            height=theme.TABBAR_HEIGHT,
            do_scroll_y=False,
            bar_width=0,
            scroll_distance='50sp',
            scroll_timeout=250,
            **kwargs,
        )
        _paint_bg(self, theme.BG_SURFACE)
        self._on_select = on_select
        self._row = BoxLayout(
            orientation='horizontal',
            size_hint_x=None,
            spacing=theme.SPACE_1,
            padding=(theme.SPACE_2, theme.SPACE_2),
        )
        self._row.bind(minimum_width=self._row.setter('width'))
        self.add_widget(self._row)
        self._active_id = active_id
        self._category: CategoryInfo = find_category_for_panel(active_id)
        self._rebuild()

    def _rebuild(self) -> None:
        self._row.clear_widgets()
        self.scroll_x = 0
        for pid in self._category.panel_ids:
            try:
                panel = find_panel(pid)
            except KeyError:
                continue
            self._row.add_widget(PanelTab(panel, pid == self._active_id, self._on_select))

    def set_active(self, active_id: str) -> None:
        self._active_id = active_id
        cat = find_category_for_panel(active_id)
        if cat.id != self._category.id:
            self._category = cat
            self._rebuild()
            return
        for child in self._row.children:
            if isinstance(child, PanelTab):
                child.set_active(child.panel.id == active_id)



# ---- Panel content (placeholder bodies) ---------------------------------

class PanelArea(BoxLayout):
    """Hosts all panel bodies; swaps which one is visible without rebuilding.

    Panels are constructed once with a reference to the bridge so their
    event subscriptions stay live across tab switches.
    """

    def __init__(self, active_id: str, bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(
            orientation='vertical',
            padding=theme.SPACE_4,
            spacing=theme.SPACE_3,
            **kwargs,
        )
        _paint_bg(self, theme.BG_PAGE)

        self._bodies: dict = {p.id: panel_widgets.make_panel(p.id, p.label, bridge) for p in PANELS}
        self._active_body: Optional[BoxLayout] = None
        self.set_active(active_id)

    def set_active(self, active_id: str) -> None:
        if self._active_body is not None:
            self.remove_widget(self._active_body)
        self._active_body = self._bodies[active_id]
        self.add_widget(self._active_body)


# ---- Status bar ----------------------------------------------------------

class StatusBar(BoxLayout):
    def __init__(self, ws_port: Optional[int], config: Optional[str],
                 bridge: Optional[UIBridge] = None, **kwargs) -> None:
        super().__init__(
            orientation='horizontal',
            size_hint_y=None,
            height=theme.STATUSBAR_HEIGHT,
            padding=(theme.SPACE_4, 0),
            spacing=theme.SPACE_4,
            **kwargs,
        )
        _paint_bg(self, theme.BG_SURFACE)

        left_text = f'ws://localhost:{ws_port}' if ws_port else 'in-process (no WS)'
        left = Label(
            text=left_text,
            color=theme.TEXT_SECONDARY,
            font_size='12sp',
            halign='left', valign='middle',
        )
        left.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))

        # The label tracks the strummer config the backend is actually
        # using; ``config`` is the explicit ``--strummer-config`` arg
        # (if any) and acts as a fallback until the bridge replays its
        # first ``'config'`` event with ``currentConfigName``.
        self._right = Label(
            text=self._format_config_label(config),
            color=theme.TEXT_MUTED,
            font_size='12sp',
            size_hint=(None, 1),
            halign='right', valign='middle',
        )
        self._right.bind(texture_size=lambda w, s: setattr(w, 'width', s[0]))
        self._right.bind(size=lambda w, *_: setattr(w, 'text_size', w.size))
        right = self._right

        if bridge is not None:
            bridge.on('config', self._on_config)

        self.badge = StatusBadge('Disconnected', connected=False)

        self.add_widget(left)
        self.add_widget(right)
        self.add_widget(self.badge)

    @staticmethod
    def _format_config_label(name: Optional[str]) -> str:
        if not name:
            return 'config: (none)'
        # ``currentConfigName`` is already a basename (e.g. 'default.json');
        # explicit ``--strummer-config`` values are paths — strip the dir
        # so the footer stays inside the 800x480 layout.
        import os
        return f'config: {os.path.basename(name)}'

    def _on_config(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        name = payload.get('currentConfigName')
        self._right.text = self._format_config_label(name)


# ---- Header (top + tab bars + branding column) --------------------------

class HeaderArea(BoxLayout):
    """Top region: left column with TopBar + PanelTabBar, logo on the right."""

    LOGO_COLUMN_WIDTH = 280

    def __init__(self, topbar: 'TopBar', tabbar: 'PanelTabBar', **kwargs) -> None:
        super().__init__(
            orientation='horizontal',
            size_hint_y=None,
            height=theme.TOPBAR_HEIGHT + theme.TABBAR_HEIGHT,
            spacing=0,
            **kwargs,
        )
        # Header background so the transparent logo on the right shows
        # the same row colour that TopBar / PanelTabBar paint on the left.
        with self.canvas.before:
            self._top_color = Color(*theme.BG_SURFACE)
            self._top_rect = Rectangle()
            self._bot_color = Color(*theme.BG_SURFACE)
            self._bot_rect = Rectangle()
        self.bind(pos=self._sync_bands, size=self._sync_bands)

        left = BoxLayout(orientation='vertical', spacing=0)
        left.add_widget(topbar)
        left.add_widget(tabbar)
        self.add_widget(left)

        logo = Image(
            source=LOGO_PATH,
            size_hint=(None, 1),
            width=self.LOGO_COLUMN_WIDTH,
            fit_mode='contain',
        )
        self.add_widget(logo)

    def _sync_bands(self, *_args: object) -> None:
        x, y = self.pos
        w = self.width
        self._bot_rect.pos = (x, y)
        self._bot_rect.size = (w, theme.TABBAR_HEIGHT)
        self._top_rect.pos = (x, y + theme.TABBAR_HEIGHT)
        self._top_rect.size = (w, theme.TOPBAR_HEIGHT)


# ---- Root layout ---------------------------------------------------------

class DashboardRoot(BoxLayout):
    def __init__(
        self,
        ws_port: Optional[int],
        config: Optional[str],
        bridge: Optional[UIBridge] = None,
        active_id: str = DEFAULT_PANEL_ID,
        on_toggle_theme=None,
        **kwargs,
    ) -> None:
        super().__init__(orientation='vertical', spacing=0, **kwargs)
        self._active_id = active_id
        active_category_id = find_category_for_panel(active_id).id
        self._tabbar = PanelTabBar(self._active_id, self._handle_select)
        self._panel_area = PanelArea(self._active_id, bridge=bridge)
        self._topbar = TopBar(
            active_category_id=active_category_id,
            on_select_category=self._handle_category_select,
            on_toggle_theme=on_toggle_theme,
        )
        self._header = HeaderArea(self._topbar, self._tabbar)
        self._statusbar = StatusBar(ws_port=ws_port, config=config, bridge=bridge)

        self.add_widget(self._header)
        self.add_widget(self._panel_area)
        self.add_widget(self._statusbar)

        if bridge is not None:
            bridge.on('device-status', self._on_device_status)

    @property
    def active_id(self) -> str:
        return self._active_id

    def _handle_select(self, panel_id: str) -> None:
        if panel_id == self._active_id:
            return
        self._active_id = panel_id
        self._tabbar.set_active(panel_id)
        self._panel_area.set_active(panel_id)
        self._topbar.set_active_category(find_category_for_panel(panel_id).id)

    def _handle_category_select(self, category_id: str) -> None:
        category = find_category(category_id)
        if not category.panel_ids:
            return
        if self._active_id in category.panel_ids:
            self._topbar.set_active_category(category_id)
            return
        self._handle_select(category.panel_ids[0])

    def _on_device_status(self, payload: dict) -> None:
        connected = bool(payload.get('connected'))
        name = payload.get('deviceName')
        if connected:
            text = f'Connected: {name}' if name else 'Connected'
        else:
            text = 'Disconnected'
        self._statusbar.badge.set_state(connected, text=text)


# ---- App -----------------------------------------------------------------

class SketchatoneUIApp(App):
    title = 'Sketchatone'

    def __init__(
        self,
        *,
        config_path: Optional[str],
        ws_port: Optional[int],
        bridge: Optional[UIBridge] = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self._config_path = config_path
        self._ws_port = ws_port
        self._bridge = bridge

    def _make_root(self, active_id: str = DEFAULT_PANEL_ID) -> DashboardRoot:
        return DashboardRoot(
            ws_port=self._ws_port,
            config=self._config_path,
            bridge=self._bridge,
            active_id=active_id,
            on_toggle_theme=self.toggle_theme,
        )

    def build(self) -> DashboardRoot:  # type: ignore[override]
        return self._make_root()

    def _current_dashboard(self) -> Optional[DashboardRoot]:
        """Return the currently-mounted DashboardRoot, or None.

        Exists as a hook so subclasses that wrap the root in an
        intermediary container (e.g. the Kaki hot-reload app) can
        return ``self.approot`` instead of ``self.root``.
        """
        if isinstance(self.root, DashboardRoot):
            return self.root
        return None

    def _swap_dashboard(self, new_root: DashboardRoot) -> None:
        """Replace the currently-mounted DashboardRoot with ``new_root``.

        Subclasses can override to route the swap through a container
        (e.g. Kaki's ``set_widget``) instead of touching ``root_window``
        directly.
        """
        window = self.root_window
        if self.root is not None and window is not None:
            window.remove_widget(self.root)
        self.root = new_root
        if window is not None:
            window.add_widget(new_root)

    def toggle_theme(self) -> None:
        """Swap palette and rebuild the root widget tree.

        Kivy ``Color`` instructions cache RGBA at construction, so a hot
        swap requires reconstructing every theme-coloured widget. We
        clear bridge subscriptions first to avoid leaks, then rebuild
        and replay the cached device status so the badge stays correct.
        """
        new_theme = 'light' if theme.ACTIVE == 'dark' else 'dark'
        theme.set_theme(new_theme)

        dash = self._current_dashboard()
        active_id = dash.active_id if dash is not None else DEFAULT_PANEL_ID
        if self._bridge is not None:
            self._bridge.clear_listeners()

        self._swap_dashboard(self._make_root(active_id=active_id))

        if self._bridge is not None:
            self._bridge.replay_status()
            self._bridge.replay_config()

    def on_stop(self) -> None:  # type: ignore[override]
        if self._bridge is not None:
            self._bridge.stop()


def run_app(
    *,
    config: Optional[str],
    ws_port: Optional[int],
    throttle_ms: int = 150,
    fullscreen: bool,
    poll_ms: Optional[int] = 2000,
    dev_mode: bool = False,
    strummer_config: Optional[str] = None,
    hot_reload: bool = False,
) -> int:
    """Start the in-process bridge and run the app. Kivy graphics/input
    config is pinned by the CLI entry point (``sketchatone.cli.ui``) so it
    takes effect before this module's top-level kivy imports trigger
    Window initialisation."""
    bridge = UIBridge(
        tablet_config_path=config,
        strummer_config_path=strummer_config,
        throttle_ms=throttle_ms,
        ws_port=ws_port,
        poll_ms=poll_ms,
        dev_mode=dev_mode,
    )
    try:
        bridge.start()
    except FileNotFoundError as exc:
        # The bridge surfaces strummer-config load failures here so we
        # can exit before initialising Kivy. Print a concise message
        # rather than the full stack trace.
        print(f'❌ Failed to start bridge: {exc}')
        bridge.stop()
        return 1

    if hot_reload:
        try:
            from .hotreload import HotReloadUIApp as _AppCls
        except ImportError as exc:
            print(f'❌ Hot reload requested but kaki/watchdog are missing: {exc}')
            print('   Install with: pip install -e ".[hotreload]"')
            bridge.stop()
            return 1
    else:
        _AppCls = SketchatoneUIApp

    try:
        _AppCls(
            config_path=strummer_config,
            ws_port=ws_port,
            bridge=bridge,
        ).run()
    finally:
        bridge.stop()
    return 0
