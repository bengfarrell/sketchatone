"""
Subprocess bridge between the Kivy UI and the Sketchatone backend.

The backend (StrummerWebSocketServer) runs in a child Python process with
its own GIL, eliminating contention between Kivy's render loop and the HID
reader / strummer threads. The bridge connects to the child as a WebSocket
client and forwards events to Kivy widgets via the same subscribe/emit API
as before, so no panel widget code needs to change.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
import types
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


# Packaged fallback config used when the config pool is empty (all
# user configs deleted). Shipped via ``[tool.setuptools.package-data]``
# so it travels with the wheel / .deb / source install alike.
_BUNDLED_DEFAULT_CONFIG_PATH = Path(__file__).parent / 'assets' / 'default_config.json'
_bundled_default_cache: Optional[Any] = None


def _load_bundled_default_config() -> Optional[Any]:
    """Return the packaged default config data (parsed JSON), or None
    if the file is missing / malformed. Result is cached after the
    first successful read."""
    global _bundled_default_cache
    if _bundled_default_cache is not None:
        return _bundled_default_cache
    try:
        with open(_BUNDLED_DEFAULT_CONFIG_PATH, 'r') as f:
            _bundled_default_cache = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    return _bundled_default_cache


# Event names accepted by UIBridge.on. Mirrors a subset of the web-side
# StrummerWebSocketClientEvents so panel widgets share one interface.
EVENT_NAMES = ('device-status', 'tablet', 'strum', 'combined', 'config',
               'midi-devices', 'midi-input', 'button-detection-state', 'notes-changed', 'action')

Listener = Callable[[Any], None]

# Default internal WS port used when the caller does not specify one.
_DEFAULT_WS_PORT = 8081


def _schedule_on_kivy_main(func: Callable[..., None], *args: Any) -> None:
    """Bounce ``func`` onto the Kivy main thread."""
    from kivy.clock import Clock
    Clock.schedule_once(lambda _dt: func(*args), 0)


def _adapt_tablet_ns(msg: dict) -> types.SimpleNamespace:
    """Build a SimpleNamespace from a flat tablet-data WS message dict.

    All fields except 'type' are copied verbatim so attribute access
    (``ev.x``, ``ev.pressure``, etc.) works in panel widgets.
    """
    return types.SimpleNamespace(**{k: v for k, v in msg.items() if k != 'type'})


def _next_copy_name(current_name: Optional[str], available) -> str:
    """Pick a fresh ``<stem> Copy[.n].json`` filename not in ``available``.

    Falls back to ``Untitled Copy`` when no config is loaded. The numeric
    suffix (`` 2``, `` 3``, ...) is appended only on collision so the
    first duplicate stays clean.
    """
    taken = {n for n in (available or []) if isinstance(n, str)}
    if current_name and current_name.endswith('.json'):
        stem = current_name[:-len('.json')]
    elif current_name:
        stem = current_name
    else:
        stem = 'Untitled'
    base = f'{stem} Copy'
    candidate = f'{base}.json'
    n = 2
    while candidate in taken:
        candidate = f'{base} {n}.json'
        n += 1
    return candidate


def _adapt_strum_ns(strum_dict: dict) -> types.SimpleNamespace:
    """Reshape a WS strum dict into the shape panel widgets expect.

    WS note shape:  {"note": {"notation": "C", "octave": 4, "midiNote": 60}, "velocity": 100}
    Widget expects: note.name, note.octave, note.velocity  (via getattr)
    """
    raw_notes = strum_dict.get('notes') or []
    notes = []
    for n in raw_notes:
        if not isinstance(n, dict):
            continue
        note_info = n.get('note') or {}
        notes.append(types.SimpleNamespace(
            name=note_info.get('notation', '?'),
            octave=note_info.get('octave', ''),
            note=note_info.get('midiNote', 0),
            velocity=n.get('velocity', 0),
        ))
    return types.SimpleNamespace(
        type=strum_dict.get('type', ''),
        notes=notes,
        velocity=strum_dict.get('velocity', 0),
    )


class UIBridge:
    """Owns the backend subprocess, exposes a subscribe/emit API for the Kivy UI."""

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
        self._ws_port = ws_port or _DEFAULT_WS_PORT
        self._poll_ms = poll_ms
        self._dev_mode = dev_mode

        self._listeners: Dict[str, List[Listener]] = {name: [] for name in EVENT_NAMES}
        self._process: Optional[subprocess.Popen] = None
        self._ws: Any = None  # websockets ClientConnection
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._run_task: Optional[asyncio.Task] = None
        self._send_queue: Optional[asyncio.Queue] = None
        self._ready = threading.Event()
        self._start_error: Optional[BaseException] = None

        # Cached payloads replayed to late subscribers (same as before).
        self._last_status: Optional[Dict[str, Any]] = None
        self._last_config: Optional[Dict[str, Any]] = None
        self._last_midi_input: Optional[Dict[str, Any]] = None
        self._last_button_detection: bool = False

    # ---- Subscribe / emit --------------------------------------------------

    def on(self, event: str, callback: Listener) -> Callable[[], None]:
        """Subscribe to ``event``. Returns an unsubscribe function.

        Subscribers to ``'config'``, ``'midi-input'``, and
        ``'button-detection-state'`` receive the cached snapshot immediately.
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
        """Drop every subscription. Used on UI rebuild (e.g. theme swap)."""
        for event in self._listeners:
            self._listeners[event].clear()

    def replay_status(self) -> None:
        """Re-emit the last device-status payload to current listeners."""
        if self._last_status is not None:
            self._emit('device-status', dict(self._last_status))

    def replay_config(self) -> None:
        """Re-emit the last config payload to current listeners."""
        if self._last_config is not None:
            self._emit('config', self._last_config)

    def _emit(self, event: str, payload: Any) -> None:
        for cb in list(self._listeners.get(event, ())):
            _schedule_on_kivy_main(cb, payload)

    # ---- Lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Spawn the backend subprocess and connect as a WebSocket client.

        Blocks until the connection is established (up to ~12 s) then returns.
        Re-raises any startup exception so callers can show a user-friendly
        message instead of falling through into a half-initialised Kivy app.
        """
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._thread_main, name='sketchatone-bridge', daemon=True)
        self._thread.start()
        self._ready.wait(timeout=15.0)
        if self._start_error is not None:
            raise self._start_error

    def stop(self) -> None:
        """Cancel the asyncio task, join the worker thread, and kill the subprocess."""
        loop = self._loop
        if loop is not None and self._run_task is not None:
            loop.call_soon_threadsafe(self._run_task.cancel)
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None
            self._loop = None
        self._kill_process()

    def _kill_process(self) -> None:
        proc = self._process
        if proc is None or proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            proc.kill()

    # ---- Subprocess --------------------------------------------------------

    def _build_server_cmd(self) -> List[str]:
        cmd = [sys.executable, '-m', 'sketchatone.cli.server',
               '--ws-port', str(self._ws_port),
               '--no-http', '--no-https']  # bridge doesn't need HTTP; avoids port <1024 root requirement
        if self._strummer_config_path:
            cmd += ['-c', self._strummer_config_path]
        if self._poll_ms:
            cmd += ['--poll', str(self._poll_ms)]
        if self._dev_mode:
            cmd.append('--dev')
        if self._throttle_ms != 150:
            cmd += ['--throttle', str(self._throttle_ms)]
        return cmd

    # ---- Worker thread (asyncio loop) --------------------------------------

    def _thread_main(self) -> None:
        try:
            cmd = self._build_server_cmd()
            self._process = subprocess.Popen(cmd)
        except Exception as exc:
            self._start_error = exc
            self._ready.set()
            return

        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        self._send_queue = asyncio.Queue()
        try:
            self._run_task = loop.create_task(self._run())
            loop.run_until_complete(self._run_task)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                loop.close()
            except Exception:
                pass
            self._kill_process()

    async def _run(self) -> None:
        """Connect to the server subprocess and forward messages indefinitely."""
        import websockets

        url = f'ws://127.0.0.1:{self._ws_port}'

        # Retry until the server subprocess starts accepting connections.
        ws = None
        for _ in range(60):  # up to ~12 s at 200 ms intervals
            try:
                ws = await websockets.connect(url)
                break
            except Exception:
                await asyncio.sleep(0.2)

        if ws is None:
            self._start_error = RuntimeError(
                f'Could not connect to server subprocess at {url} after 12 s')
            self._ready.set()
            return

        self._ws = ws
        self._ready.set()

        send_task = asyncio.ensure_future(self._send_loop())
        try:
            async for raw in ws:
                try:
                    self._dispatch_message(json.loads(raw))
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            # Signal the send loop to stop.
            if self._send_queue is not None:
                await self._send_queue.put(None)
            await send_task

    async def _send_loop(self) -> None:
        """Drain the outgoing queue and write frames to the WebSocket."""
        ws = self._ws
        while True:
            msg = await self._send_queue.get()
            if msg is None:
                break
            if ws is not None:
                try:
                    await ws.send(msg)
                except Exception:
                    pass

    # ---- Message dispatch --------------------------------------------------

    def _dispatch_message(self, msg: dict) -> None:
        msg_type = msg.get('type')

        if msg_type == 'tablet-data':
            tablet_ns = _adapt_tablet_ns(msg)
            strum_dict = msg.get('strum')
            strum_ns = _adapt_strum_ns(strum_dict) if strum_dict else None
            combined = types.SimpleNamespace(tablet=tablet_ns, strum=strum_ns)
            self._emit('combined', combined)
            self._emit('tablet', tablet_ns)
            if strum_ns is not None:
                self._emit('strum', strum_ns)

        elif msg_type == 'config':
            data = msg.get('data') or {}
            self._last_config = data
            self._emit('config', data)

        elif msg_type == 'status':
            connected = bool(msg.get('deviceConnected', False))
            message_text = msg.get('message', '')
            # Strip trailing " connected" so device_name is just the model string.
            device_name = message_text.removesuffix(' connected') if connected else None
            self._last_status = {'connected': connected, 'deviceName': device_name}
            self._emit('device-status', dict(self._last_status))

        elif msg_type == 'midi-devices':
            self._emit('midi-devices', msg.get('data', {}))

        elif msg_type == 'midi-input':
            self._last_midi_input = msg
            self._emit('midi-input', msg)

        elif msg_type == 'button-detection-state':
            enabled = bool(msg.get('enabled', False))
            self._last_button_detection = enabled
            self._emit('button-detection-state', {'enabled': enabled})

        elif msg_type == 'notes-changed':
            self._emit('notes-changed', msg)

        elif msg_type == 'action-event':
            self._emit('action', msg)

    # ---- Outgoing command API (callable from any thread) -------------------

    def _send(self, msg: dict) -> None:
        """Thread-safe: enqueue a JSON message for the send loop."""
        loop = self._loop
        queue = self._send_queue
        if loop is None or queue is None:
            return
        try:
            loop.call_soon_threadsafe(queue.put_nowait, json.dumps(msg))
        except Exception:
            pass

    def request_midi_devices(self) -> None:
        self._send({'type': 'get-midi-devices'})

    def request_midi_input_status(self) -> None:
        # The server sends midi-input status on connect; replay the cache for
        # panels that subscribe after the initial burst.
        if self._last_midi_input is not None:
            self._emit('midi-input', self._last_midi_input)

    def set_button_detection(self, enabled: bool) -> None:
        self._send({'type': 'set-button-detection', 'enabled': bool(enabled)})

    def set_midi_output(self, port: Optional[str]) -> None:
        if port is None:
            return
        self._send({'type': 'update-config', 'path': 'midi.midiOutputId', 'value': port})

    def set_midi_input(self, value: Any) -> None:
        self._send({'type': 'update-config', 'path': 'midi.midiInputId', 'value': value})

    def set_config(self, path: str, value: Any) -> None:
        self._send({'type': 'update-config', 'path': path, 'value': value})

    def save_config(self) -> None:
        self._send({'type': 'save-config'})

    def load_config(self, name: str) -> None:
        if name:
            self._send({'type': 'load-config', 'configName': name})

    def create_config(self, name: str) -> None:
        if name:
            self._send({'type': 'create-config', 'configName': name})

    def duplicate_current_config(self) -> Optional[str]:
        """Create a new config file on the server.

        When the config pool already contains at least one file, this
        clones the currently-loaded config under a new ' Copy' name.
        When the pool is empty (all configs deleted), seeds a fresh
        ``default.json`` from the packaged default so the user always
        has a starting point. Returns the chosen filename, or ``None``
        if neither source is available.
        """
        available = (self._last_config or {}).get('availableConfigs') or []
        if not available:
            config_data = _load_bundled_default_config()
            if config_data is None:
                return None
            new_name = 'default.json'
            self._send({'type': 'upload-config',
                        'configName': new_name, 'configData': config_data})
            return new_name
        if not self._last_config:
            return None
        config_data = self._last_config.get('config')
        if config_data is None:
            return None
        current_name = self._last_config.get('currentConfigName')
        new_name = _next_copy_name(current_name, available)
        self._send({'type': 'upload-config',
                    'configName': new_name, 'configData': config_data})
        return new_name

    def set_throttle(self, throttle_ms: int) -> None:
        try:
            value = int(throttle_ms)
        except (TypeError, ValueError):
            return
        if value >= 0:
            self._send({'type': 'set-throttle', 'throttleMs': value})
