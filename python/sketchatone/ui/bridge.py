"""
In-process bridge between the Kivy UI and the Sketchatone backend.

The Kivy UI lives in the same Python process as the HID reader, the
``Strummer``, and the ``StrummerEventBus``. There is no reason to go
through a localhost WebSocket; this bridge subscribes to the backend's
event sources directly and re-emits on the Kivy main thread.

The WebSocket transport itself is opt-in (``ws_port``) so the minimum
boot footprint stays minimal: no port binding, no TLS setup, no
``websockets.serve()`` task. The same listener tree, MIDI setup,
strummer logic, etc. is reused unchanged.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Callable, Dict, List, Optional

from sketchatone.cli.server import (
    CombinedEventData,
    StrummerWebSocketServer,
)


# Event names accepted by ``UIBridge.on``. Mirrors a subset of the
# web-side ``StrummerWebSocketClientEvents`` so panel widgets can be
# written against a single interface.
EVENT_NAMES = ('device-status', 'tablet', 'strum', 'combined', 'config',
               'midi-devices', 'midi-input', 'button-detection-state')

Listener = Callable[[Any], None]


def _schedule_on_kivy_main(func: Callable[..., None], *args: Any) -> None:
    """Bounce ``func`` onto the Kivy main thread.

    Kivy widgets must only be mutated from the main thread; the event
    bus and HID reader fire from worker threads.
    """
    from kivy.clock import Clock
    Clock.schedule_once(lambda _dt: func(*args), 0)


class _BridgeServer(StrummerWebSocketServer):
    """Subclass that fans status / config broadcasts out to a local hook.

    Existing ``broadcast_*`` behaviour is preserved (calls super); the
    extra callback fires after, so opt-in WS clients still receive the
    same messages they always did.
    """

    # Defaults so the hooks exist even if ``broadcast_*`` is invoked during
    # the parent ``__init__`` (notes setup triggers ``broadcast_config``).
    _status_hook: Optional[Callable[[bool, Optional[str]], None]] = None
    _config_hook: Optional[Callable[[Dict[str, Any]], None]] = None
    _midi_devices_hook: Optional[Callable[[Dict[str, Any]], None]] = None
    _midi_input_hook: Optional[Callable[[Dict[str, Any]], None]] = None
    _button_detection_hook: Optional[Callable[[bool], None]] = None

    def __init__(self, *args: Any, _on_status: Optional[Callable[[bool, Optional[str]], None]] = None,
                 _on_config: Optional[Callable[[Dict[str, Any]], None]] = None,
                 _on_midi_devices: Optional[Callable[[Dict[str, Any]], None]] = None,
                 _on_midi_input: Optional[Callable[[Dict[str, Any]], None]] = None,
                 _on_button_detection: Optional[Callable[[bool], None]] = None,
                 **kwargs: Any) -> None:
        self._status_hook = _on_status
        self._config_hook = _on_config
        self._midi_devices_hook = _on_midi_devices
        self._midi_input_hook = _on_midi_input
        self._button_detection_hook = _on_button_detection
        super().__init__(*args, **kwargs)

    def broadcast_status(self, connected: bool, device_name: Optional[str] = None) -> None:  # type: ignore[override]
        device_name = self._resolve_device_name(device_name)
        super().broadcast_status(connected, device_name)
        if self._status_hook is not None:
            self._status_hook(connected, device_name)

    def broadcast_config(self, is_saved_state: bool = False) -> None:  # type: ignore[override]
        super().broadcast_config(is_saved_state)
        if self._config_hook is not None:
            try:
                self._config_hook(self._get_config_data(is_saved_state))
            except Exception:
                pass

    def _broadcast_midi_devices(self) -> None:  # type: ignore[override]
        super()._broadcast_midi_devices()
        if self._midi_devices_hook is not None:
            try:
                self._midi_devices_hook(self._get_midi_devices_data())
            except Exception:
                pass

    def _broadcast_midi_input(self, event: Dict[str, Any]) -> None:  # type: ignore[override]
        super()._broadcast_midi_input(event)
        if self._midi_input_hook is not None:
            try:
                self._midi_input_hook(self._build_midi_input_payload(event))
            except Exception:
                pass

    def _broadcast_button_detection_state(self) -> None:  # type: ignore[override]
        super()._broadcast_button_detection_state()
        if self._button_detection_hook is not None:
            try:
                self._button_detection_hook(bool(self.detecting_device_buttons))
            except Exception:
                pass

    def _build_midi_input_payload(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Same shape as the WS ``midi-input`` message, but as a dict."""
        midi_input = getattr(self, 'midi_input', None)
        available_ports = []
        connected_port = None
        if midi_input is not None:
            try:
                available_ports = midi_input.get_available_ports() or []
            except Exception:
                available_ports = []
            connected_ports = getattr(midi_input, 'connected_ports', None) or []
            if connected_ports:
                connected_port = connected_ports[0].get('name')
        return {
            'notes': event.get('notes', []),
            'added': event.get('added'),
            'removed': event.get('removed'),
            'portName': event.get('port_name'),
            'availablePorts': [
                {'id': p['id'], 'name': p['name']} for p in available_ports
            ],
            'connectedPort': connected_port,
            'connected': bool(getattr(midi_input, 'is_connected', False)),
        }

    def _get_midi_input_status(self) -> Dict[str, Any]:
        """Synchronous snapshot in the same shape as the broadcast payload.

        Mirrors :meth:`_send_midi_input_status` so a freshly-subscribed
        panel can render the current state without waiting for the next
        note event."""
        midi_input = getattr(self, 'midi_input', None)
        if midi_input is None:
            return {
                'notes': [], 'added': None, 'removed': None,
                'portName': None, 'availablePorts': [],
                'connectedPort': None, 'connected': False,
            }
        try:
            available_ports = midi_input.get_available_ports() or []
        except Exception:
            available_ports = []
        connected_ports = getattr(midi_input, 'connected_ports', None) or []
        connected_port = connected_ports[0].get('name') if connected_ports else None
        return {
            'notes': list(getattr(midi_input, 'notes', []) or []),
            'added': None,
            'removed': None,
            'portName': connected_port,
            'availablePorts': [
                {'id': p['id'], 'name': p['name']} for p in available_ports
            ],
            'connectedPort': connected_port,
            'connected': bool(getattr(midi_input, 'is_connected', False)),
        }


class UIBridge:
    """Owns the backend, exposes a subscribe/emit API for the Kivy UI."""

    def __init__(
        self,
        *,
        strummer_config_path: Optional[str] = None,
        throttle_ms: int = 150,
        ws_port: Optional[int] = None,
        poll_ms: Optional[int] = 2000,
        dev_mode: bool = False,
    ) -> None:
        self._strummer_config_path = strummer_config_path
        self._throttle_ms = throttle_ms
        self._ws_port = ws_port
        self._poll_ms = poll_ms
        self._dev_mode = dev_mode

        self._listeners: Dict[str, List[Listener]] = {name: [] for name in EVENT_NAMES}
        self._server: Optional[_BridgeServer] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._run_task: Optional[asyncio.Task] = None
        self._ready = threading.Event()
        # Exception captured from the worker thread during server
        # construction (e.g. ``FileNotFoundError`` for a bad strummer
        # config path). Re-raised by ``start()`` so callers fail fast
        # instead of cascading into the Kivy main loop.
        self._start_error: Optional[BaseException] = None
        # Last known device status, replayed when widgets re-subscribe after
        # a UI rebuild (e.g. theme toggle).
        self._last_status: Optional[Dict[str, Any]] = None
        # Last config payload. The backend broadcasts once during server
        # ``__init__`` (notes setup triggers ``broadcast_config``), which
        # fires before panel widgets are constructed on the main thread.
        # Cached here so a fresh 'config' subscriber receives the current
        # snapshot immediately rather than waiting for the next mutation.
        self._last_config: Optional[Dict[str, Any]] = None
        # Last MIDI input snapshot/event; replayed on subscribe so a panel
        # opened after the backend has already started shows current notes
        # and source port without waiting for the next input event.
        self._last_midi_input: Optional[Dict[str, Any]] = None
        # Ephemeral button-detection flag mirrored from the backend so a
        # freshly-subscribed panel reflects the current toggle immediately.
        self._last_button_detection: bool = False

    def on(self, event: str, callback: Listener) -> Callable[[], None]:
        """Subscribe to ``event``. Returns an unsubscribe function.

        Subscribers to ``'config'`` receive the cached snapshot (if any)
        immediately, mirroring the web WS server's connect-time push so
        panels render their initial state without waiting for a mutation.
        """
        if event not in self._listeners:
            raise ValueError(f'Unknown event {event!r}; expected one of {EVENT_NAMES}')
        self._listeners[event].append(callback)
        if event == 'config' and self._last_config is not None:
            _schedule_on_kivy_main(callback, self._last_config)
        if event == 'midi-input' and self._last_midi_input is not None:
            _schedule_on_kivy_main(callback, self._last_midi_input)
        if event == 'button-detection-state':
            _schedule_on_kivy_main(callback, {'enabled': self._last_button_detection})
        def _off() -> None:
            if callback in self._listeners[event]:
                self._listeners[event].remove(callback)
        return _off

    def clear_listeners(self) -> None:
        """Drop every subscription. Used on UI rebuild (e.g. theme swap) so
        the old widget tree doesn't leak callbacks into the new one."""
        for event in self._listeners:
            self._listeners[event].clear()

    def replay_status(self) -> None:
        """Re-emit the last device-status payload to current listeners.

        Status events fire only on transitions; after a rebuild the badge
        would otherwise stay 'Disconnected' until the next plug/unplug."""
        if self._last_status is not None:
            self._emit('device-status', dict(self._last_status))

    def replay_config(self) -> None:
        """Re-emit the last config payload to current listeners.

        Used after a UI rebuild (theme toggle) so freshly-constructed
        panels re-receive the cached snapshot. New ``on('config', ...)``
        subscribers already get an automatic replay; this method exists
        for the bulk-resubscribe case after ``clear_listeners``."""
        if self._last_config is not None:
            self._emit('config', self._last_config)

    def _emit(self, event: str, payload: Any) -> None:
        for cb in list(self._listeners.get(event, ())):
            _schedule_on_kivy_main(cb, payload)

    # ---- Lifecycle ------------------------------------------------------

    def start(self) -> None:
        """Spin up the backend in a background asyncio loop.

        Re-raises any exception that the worker thread caught while
        constructing the backend (e.g. a missing strummer config) so
        callers can surface a user-friendly message and exit instead
        of falling through into a half-initialised Kivy app.
        """
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._thread_main, name='sketchatone-bridge', daemon=True)
        self._thread.start()
        self._ready.wait(timeout=5.0)
        if self._start_error is not None:
            raise self._start_error

    def stop(self) -> None:
        """Tear down the backend and join the worker thread."""
        if self._loop is None or self._thread is None:
            return
        loop = self._loop
        if self._run_task is not None:
            loop.call_soon_threadsafe(self._run_task.cancel)
        self._thread.join(timeout=5.0)
        self._thread = None
        self._loop = None

    # ---- Backend wiring (runs on the worker thread) --------------------

    def _on_status(self, connected: bool, device_name: Optional[str]) -> None:
        self._last_status = {'connected': connected, 'deviceName': device_name}
        self._emit('device-status', dict(self._last_status))

    def _on_config(self, config_data: Dict[str, Any]) -> None:
        self._last_config = config_data
        self._emit('config', config_data)

    def _on_midi_devices(self, data: Dict[str, Any]) -> None:
        self._emit('midi-devices', data)

    def _on_midi_input(self, data: Dict[str, Any]) -> None:
        self._last_midi_input = data
        self._emit('midi-input', data)

    def _on_button_detection(self, enabled: bool) -> None:
        self._last_button_detection = bool(enabled)
        self._emit('button-detection-state', {'enabled': self._last_button_detection})

    # ---- Public command API (callable from the Kivy main thread) ------

    def request_midi_devices(self) -> None:
        """Ask the backend for the current MIDI device snapshot.

        The result is delivered via the ``'midi-devices'`` event so the
        same listener path is used for refreshes and unsolicited
        broadcasts (e.g. after a port change).
        """
        def _fetch() -> None:
            srv = self._server
            if srv is None:
                return
            try:
                data = srv._get_midi_devices_data()
            except Exception:
                return
            self._emit('midi-devices', data)
        self._run_on_loop(_fetch)

    def request_midi_input_status(self) -> None:
        """Ask the backend for the current MIDI input snapshot.

        Delivered via the ``'midi-input'`` event so the same listener path
        is used for refreshes and unsolicited note broadcasts. Also
        updates the cached ``_last_midi_input`` so subsequent subscribers
        receive the snapshot immediately."""
        def _fetch() -> None:
            srv = self._server
            if srv is None:
                return
            try:
                data = srv._get_midi_input_status()
            except Exception:
                return
            self._on_midi_input(data)
        self._run_on_loop(_fetch)

    def set_button_detection(self, enabled: bool) -> None:
        """Toggle the backend's ephemeral device-button learning flag.

        Mirrors the web ``set-button-detection`` message: flips
        ``detecting_device_buttons`` and rebroadcasts the state so every
        subscriber (this UI and any WS clients) stays in sync.
        """
        target = bool(enabled)

        def _apply() -> None:
            srv = self._server
            if srv is None:
                return
            try:
                srv.detecting_device_buttons = target
                srv._broadcast_button_detection_state()
            except Exception:
                pass
        self._run_on_loop(_apply)

    def set_midi_output(self, port: Optional[str]) -> None:
        """Switch the MIDI output port. ``port`` is a port name or index
        string (matching ``backend.connect``); ``None`` is ignored."""
        if port is None:
            return
        self._call_handle_config_update('midi.midiOutputId', port)

    def set_midi_input(self, value: Any) -> None:
        """Switch MIDI input port(s). ``value`` is a list of port ids
        (multi-select), a single port id, or an empty list to disconnect."""
        self._call_handle_config_update('midi.midiInputId', value)

    def set_config(self, path: str, value: Any) -> None:
        """Apply a dot-notation config update on the backend.

        ``path`` uses the camelCase form accepted by
        ``_handle_config_update`` (e.g. ``'strummer.strumming.pressureThreshold'``).
        The backend re-applies dependent state (strummer reconfigure,
        MIDI port reconnect, etc.) automatically.
        """
        self._call_handle_config_update(path, value)

    def save_config(self) -> None:
        """Persist the current config to its backing file.

        Backend broadcasts a fresh ``'config'`` event with
        ``isSavedState=True`` on success; panels use that to clear their
        dirty indicator.
        """
        self._call_server_method('_handle_save_config')

    def load_config(self, name: str) -> None:
        """Load a named config file from the server's config directory.

        Triggers a full strummer reconfigure on the backend; the
        ``'config'`` broadcast carries the new ``currentConfigName`` and
        ``isSavedState=True``.
        """
        if not name:
            return
        self._call_server_method('_handle_load_config', name)

    def create_config(self, name: str) -> None:
        """Create a new config file pre-populated with defaults and
        switch to it. ``name`` should include the ``.json`` extension."""
        if not name:
            return
        self._call_server_method('_handle_create_config', name)

    def set_throttle(self, throttle_ms: int) -> None:
        """Update the event-bus throttle interval.

        Mirrors the web dashboard's ``set-throttle`` WS message: applies
        the new interval on the backend and rebroadcasts config so the
        new ``throttleMs`` field reaches every connected client.
        """
        try:
            value = int(throttle_ms)
        except (TypeError, ValueError):
            return
        if value < 0:
            return

        def _apply() -> None:
            srv = self._server
            if srv is None:
                return
            try:
                srv.event_bus.set_throttle(value)
                srv.broadcast_config()
            except Exception:
                pass
        self._run_on_loop(_apply)

    def _call_handle_config_update(self, path: str, value: Any) -> None:
        def _apply() -> None:
            srv = self._server
            if srv is None:
                return
            try:
                srv._handle_config_update(path, value)
                # Mirror the WebSocket ``update-config`` handler:
                # ``_handle_config_update`` doesn't broadcast on its own,
                # so without this call the in-process listeners (status
                # bar dirty tracker, other panels reflecting shared
                # state) would never see the change.
                srv.broadcast_config()
            except Exception:
                pass
        self._run_on_loop(_apply)

    def _call_server_method(self, method: str, *args: Any) -> None:
        """Invoke a synchronous ``Server._method(*args)`` on the bridge
        worker loop. Errors are swallowed; the backend logs failures
        itself and broadcasts state on success."""
        def _apply() -> None:
            srv = self._server
            if srv is None:
                return
            fn = getattr(srv, method, None)
            if fn is None:
                return
            try:
                fn(*args)
            except Exception:
                pass
        self._run_on_loop(_apply)

    def _run_on_loop(self, fn: Callable[[], None]) -> None:
        """Schedule a synchronous ``fn()`` onto the bridge's worker loop.

        Backend mutations (port (re)connect, config writes) happen on the
        worker thread; calling them directly from the Kivy main thread
        would race with the HID reader and websocket handlers. No-ops if
        the loop is missing or already closed (e.g. the worker thread
        bailed out during construction) so panel widgets don't crash
        the UI while the bridge is in a failed state.
        """
        loop = self._loop
        if loop is None:
            return
        # ``is_closed`` is absent on test fakes; treat missing as open.
        is_closed = getattr(loop, 'is_closed', None)
        if callable(is_closed) and is_closed():
            return
        try:
            loop.call_soon_threadsafe(fn)
        except RuntimeError:
            pass

    def _on_combined(self, data: CombinedEventData) -> None:
        self._emit('combined', data)
        if data.tablet is not None:
            self._emit('tablet', data.tablet)
        if data.strum is not None:
            self._emit('strum', data.strum)

    async def _keep_event_bus_resumed(self) -> None:
        """Resume the event bus once ``run_server`` has started it.

        Polls briefly because ``start()`` and ``pause()`` happen partway
        through ``run_server``; we resume right after so panel widgets
        receive ``combined`` events without needing a WS client.

        Also fires a one-shot ``broadcast_config(is_saved_state=True)``
        so the StatusBar's dirty tracker captures a baseline snapshot.
        The server's initial ``broadcast_config`` (triggered by
        ``_setup_notes`` during ``__init__``) defaults to
        ``is_saved_state=False``; without this re-broadcast no in-process
        subscriber would ever see a saved-state payload, leaving Save /
        Revert permanently disabled.
        """
        for _ in range(100):
            srv = self._server
            if srv is not None and getattr(srv.event_bus, '_interval_task', None) is not None:
                srv.event_bus.resume()
                try:
                    srv.broadcast_config(is_saved_state=True)
                except Exception:
                    pass
                return
            await asyncio.sleep(0.05)

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            try:
                # Device discovery is delegated to ``TabletClient.discover()``
                # inside the server's reader thread — no path resolution
                # needed here; the bundled OTD config index handles it.
                self._server = _BridgeServer(
                    strummer_config_path=self._strummer_config_path,
                    ws_port=self._ws_port,
                    throttle_ms=self._throttle_ms,
                    poll_ms=self._poll_ms,
                    dev_mode=self._dev_mode,
                    _on_status=self._on_status,
                    _on_config=self._on_config,
                    _on_midi_devices=self._on_midi_devices,
                    _on_midi_input=self._on_midi_input,
                    _on_button_detection=self._on_button_detection,
                )
                self._server.event_bus.on_combined_event(self._on_combined)
                self._run_task = loop.create_task(self._server.run_server())
                # ``run_server()`` calls ``event_bus.start()`` then ``pause()``
                # because the upstream design only resumes on WebSocket-client
                # connect. The Kivy UI is our in-process client, so keep the
                # bus running for the lifetime of the bridge.
                loop.create_task(self._keep_event_bus_resumed())
            except BaseException as exc:
                # Capture so ``start()`` can re-raise on the main thread;
                # otherwise the failure would only surface as a stack
                # trace from the worker, and the UI would proceed.
                self._start_error = exc
                return
            finally:
                self._ready.set()
            try:
                loop.run_until_complete(self._run_task)
            except asyncio.CancelledError:
                pass
        finally:
            try:
                loop.close()
            except Exception:
                pass
