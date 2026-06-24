"""
Dev-only hot-reload wrapper around ``SketchatoneUIApp``.

Uses `kaki <https://github.com/tito/kaki>`_ to watch ``sketchatone/ui``
for source changes and rebuild the widget tree in place without
restarting the host process — so the bridge thread, WebSocket server,
and HID reader stay alive across edits. Editing this module or
``app.py`` itself triggers a full process restart via Kaki's
``_restart_app`` (which re-execs ``sys.executable`` with the original
argv); everything else is a soft rebuild.

Activated by passing ``--hot-reload`` to ``sketchatone-ui``. Requires
the ``[hotreload]`` extra (``pip install -e ".[hotreload]"``); imports
fail loudly otherwise and the CLI prints the install hint.

``bridge.py`` is excluded from the watch list because the bridge runs
on a background asyncio thread that holds live references to the
module's classes — reloading it mid-flight would leave the worker
talking to a stale namespace.
"""

from __future__ import annotations

from fnmatch import fnmatch
from pathlib import Path
from typing import Optional

from kaki.app import App as KakiApp
from kivy.clock import Clock, mainthread
from kivy.logger import Logger

from .app import DEFAULT_PANEL_ID, DashboardRoot, SketchatoneUIApp


# Package source root: this file lives at
# ``python/sketchatone/ui/hotreload.py`` and the importable package is
# ``sketchatone`` — so the parent of ``sketchatone/`` (i.e. the
# ``python/`` directory) is what ``get_root_path()`` must return.
# Kaki uses it twice: (a) ``AUTORELOADER_PATHS`` are joined against it
# to schedule watchdog observers, and (b) ``_filename_to_module``
# strips it from the changed file path then converts the remainder
# into a dotted module name to look up in ``sys.modules``. If the root
# is the workspace root, the computed name is ``python.sketchatone.…``
# which isn't in ``sys.modules`` and the soft reload silently no-ops.
_PACKAGE_ROOT = str(Path(__file__).resolve().parents[2])


class HotReloadUIApp(KakiApp, SketchatoneUIApp):
    """Kaki-driven variant of ``SketchatoneUIApp``.

    MRO is ``HotReloadUIApp -> KakiApp -> SketchatoneUIApp -> kivy.app.App``,
    so Kaki's ``build()`` runs first and drives the rebuild lifecycle;
    we hook in via ``build_app``, ``apply_state``, and
    ``unload_app_dependencies``.
    """

    DEBUG = 1

    AUTORELOADER_PATHS = [
        ('sketchatone/ui', {'recursive': True}),
    ]

    AUTORELOADER_IGNORE_PATTERNS = [
        '*.pyc',
        '*__pycache__*',
        # Bridge state lives on a worker thread; reloading would alias
        # the running coroutine to a stale module. Edits to bridge.py
        # require a manual process restart.
        '*/bridge.py',
        # Hot-reload glue itself; editing triggers Kaki's full process
        # restart via _restart_app rather than a soft rebuild.
        '*/hotreload.py',
    ]

    def get_root_path(self) -> str:  # type: ignore[override]
        return _PACKAGE_ROOT

    # ---- Kaki lifecycle hooks ------------------------------------------

    def build_app(self, first: bool = False) -> DashboardRoot:  # type: ignore[override]
        """Construct (or reconstruct) the dashboard. Called by Kaki on
        every rebuild as well as the initial boot."""
        if not first and self._bridge is not None:
            # Old widget tree's subscriptions would otherwise leak into
            # the bridge and double-fire on the next event.
            self._bridge.clear_listeners()
        active_id = self.state.get('active_id', DEFAULT_PANEL_ID)
        return self._make_root(active_id=active_id)

    def unload_app_dependencies(self) -> None:  # type: ignore[override]
        """Snapshot UI state before Kaki tears down the widget tree so
        the user's active panel survives the rebuild."""
        dash = self._current_dashboard()
        if dash is not None:
            self.state['active_id'] = dash.active_id
        super().unload_app_dependencies()

    def apply_state(self, state: dict) -> None:  # type: ignore[override]
        """Replay cached bridge events after the new tree is mounted so
        the freshly-constructed panels render their last-known state
        instead of waiting for the next tablet/config event."""
        if self._bridge is not None:
            self._bridge.replay_status()
            self._bridge.replay_config()

    # ---- SketchatoneUIApp hooks (Kaki root indirection) ----------------

    def _current_dashboard(self) -> Optional[DashboardRoot]:  # type: ignore[override]
        # Kaki holds the user-facing widget on ``approot``; ``root`` is
        # an internal container created by ``get_root()``.
        approot = getattr(self, 'approot', None)
        if isinstance(approot, DashboardRoot):
            return approot
        return None

    def _swap_dashboard(self, new_root: DashboardRoot) -> None:  # type: ignore[override]
        # Route through Kaki so it keeps ``approot`` in sync with
        # whatever the rebuild pipeline expects on the next reload.
        self.set_widget(new_root)

    # ---- Watchdog event override ---------------------------------------
    #
    # Kaki's stock handler only reacts to ``FileModifiedEvent``. Editors
    # that save atomically (vim, JetBrains, Sublime, VS Code with
    # ``files.atomicSaveOnFileModification``) write to a temp file and
    # rename it over the target, which fires ``FileMovedEvent`` /
    # ``FileCreatedEvent`` instead — so the stock handler silently
    # ignores the save and the UI stays stale until a manual restart.

    @mainthread
    def _reload_from_watchdog(self, event):  # type: ignore[override]
        from watchdog.events import (
            FileCreatedEvent, FileModifiedEvent, FileMovedEvent,
        )
        if isinstance(event, FileMovedEvent):
            path = event.dest_path
        elif isinstance(event, (FileModifiedEvent, FileCreatedEvent)):
            path = event.src_path
        else:
            return
        for pat in self.AUTORELOADER_IGNORE_PATTERNS:
            if fnmatch(path, pat):
                return
        if not path.endswith('.py'):
            return
        Logger.debug(f"Reloader: triggered by {type(event).__name__} on {path}")
        try:
            self._reload_py(path)
        except Exception as exc:
            import traceback
            self.set_error(repr(exc), traceback.format_exc())
            return
        Clock.unschedule(self.rebuild)
        Clock.schedule_once(self.rebuild, 0.1)
