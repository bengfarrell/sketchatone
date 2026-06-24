"""
Tests for the in-process UI bridge (sketchatone.ui.bridge).

These tests exercise subscription semantics and event fan-out without
booting Kivy or the WebSocket transport. We monkey-patch the bridge's
Kivy main-thread scheduler so callbacks run synchronously.
"""

from __future__ import annotations

import pytest

from sketchatone.ui import bridge as bridge_mod
from sketchatone.ui.bridge import UIBridge, EVENT_NAMES


@pytest.fixture(autouse=True)
def _run_on_main_inline(monkeypatch):
    """Make ``_schedule_on_kivy_main`` invoke the callback synchronously
    so tests don't need a Kivy event loop."""
    def _inline(func, *args):
        func(*args)
    monkeypatch.setattr(bridge_mod, '_schedule_on_kivy_main', _inline)


class TestUIBridgeSubscription:
    def test_event_names_are_documented(self):
        assert set(EVENT_NAMES) == {
            'device-status', 'tablet', 'strum', 'combined', 'config',
            'midi-devices',
        }

    def test_on_unknown_event_raises(self):
        b = UIBridge()
        with pytest.raises(ValueError):
            b.on('not-a-real-event', lambda _payload: None)

    def test_on_returns_unsubscribe(self):
        b = UIBridge()
        received: list = []
        off = b.on('device-status', received.append)
        b._emit('device-status', {'connected': True})
        assert received == [{'connected': True}]
        off()
        b._emit('device-status', {'connected': False})
        assert received == [{'connected': True}]  # no further deliveries

    def test_multiple_listeners_each_called(self):
        b = UIBridge()
        a, c = [], []
        b.on('tablet', a.append)
        b.on('tablet', c.append)
        b._emit('tablet', 'evt')
        assert a == ['evt']
        assert c == ['evt']


class TestUIBridgeFanOut:
    def test_combined_event_fans_to_tablet_and_strum(self):
        from sketchatone.cli.server import (
            CombinedEventData, TabletEventData, StrumEventData,
        )
        b = UIBridge()
        combined, tablet, strum = [], [], []
        b.on('combined', combined.append)
        b.on('tablet', tablet.append)
        b.on('strum', strum.append)

        tablet_data = TabletEventData(x=0.5, y=0.5)
        strum_data = StrumEventData(type='strum')
        b._on_combined(CombinedEventData(tablet=tablet_data, strum=strum_data))

        assert combined and combined[0].tablet is tablet_data
        assert tablet == [tablet_data]
        assert strum == [strum_data]

    def test_combined_event_without_tablet_skips_tablet_listeners(self):
        from sketchatone.cli.server import CombinedEventData, StrumEventData
        b = UIBridge()
        tablet, strum = [], []
        b.on('tablet', tablet.append)
        b.on('strum', strum.append)
        b._on_combined(CombinedEventData(tablet=None, strum=StrumEventData(type='strum')))
        assert tablet == []
        assert len(strum) == 1

    def test_status_callback_emits_device_status(self):
        b = UIBridge()
        received: list = []
        b.on('device-status', received.append)
        b._on_status(True, 'XP-Pen Deco')
        assert received == [{'connected': True, 'deviceName': 'XP-Pen Deco'}]

    def test_status_is_cached_for_replay(self):
        b = UIBridge()
        b._on_status(True, 'Huion')
        # Subscriber that joined after the event must miss it initially...
        received: list = []
        b.on('device-status', received.append)
        assert received == []
        # ...but ``replay_status`` re-emits the cached payload.
        b.replay_status()
        assert received == [{'connected': True, 'deviceName': 'Huion'}]

    def test_replay_status_noop_when_never_received(self):
        b = UIBridge()
        received: list = []
        b.on('device-status', received.append)
        b.replay_status()
        assert received == []

    def test_clear_listeners_drops_all_subscriptions(self):
        b = UIBridge()
        received_tablet: list = []
        received_status: list = []
        b.on('tablet', received_tablet.append)
        b.on('device-status', received_status.append)
        b.clear_listeners()
        b._emit('tablet', 'evt')
        b._on_status(True, 'X')
        assert received_tablet == []
        assert received_status == []

    def test_config_callback_emits_config(self):
        b = UIBridge()
        received: list = []
        b.on('config', received.append)
        b._on_config({'throttleMs': 150, 'notes': []})
        assert received == [{'throttleMs': 150, 'notes': []}]

    def test_config_is_cached_and_replayed_to_late_subscriber(self):
        # The backend broadcasts during server ``__init__`` (before any
        # panel exists). Subscribers that arrive afterwards must still
        # receive the snapshot, otherwise the Actions panel boots empty.
        b = UIBridge()
        b._on_config({'config': {'strummer': {'actionRules': {'rules': [{'id': 'r1'}]}}}})
        received: list = []
        b.on('config', received.append)
        assert received == [{'config': {'strummer': {'actionRules': {'rules': [{'id': 'r1'}]}}}}]

    def test_replay_config_redelivers_to_current_listeners(self):
        b = UIBridge()
        b._on_config({'currentConfigName': 'default.json'})
        received: list = []
        b.on('config', received.append)
        received.clear()
        b.replay_config()
        assert received == [{'currentConfigName': 'default.json'}]

    def test_replay_config_noop_when_never_received(self):
        b = UIBridge()
        received: list = []
        b.on('config', received.append)
        b.replay_config()
        assert received == []

    def test_start_reraises_worker_exception(self, monkeypatch):
        # Simulate a strummer-config FileNotFoundError surfacing from
        # the worker thread. ``start()`` must propagate so the CLI can
        # exit cleanly instead of letting Kivy boot a dead bridge.
        from sketchatone.ui import bridge as bridge_mod

        class _BoomServer:
            def __init__(self, *_a, **_kw):
                raise FileNotFoundError("simulated missing config")

        monkeypatch.setattr(bridge_mod, '_BridgeServer', _BoomServer)
        b = UIBridge(dev_mode=True)
        with pytest.raises(FileNotFoundError, match='simulated missing config'):
            b.start()
        # _run_on_loop must no-op against the closed/missing loop so
        # follow-up calls from panel widgets don't blow up.
        b._run_on_loop(lambda: None)

    def test_run_on_loop_noop_when_loop_closed(self):
        import asyncio
        b = UIBridge()
        loop = asyncio.new_event_loop()
        loop.close()
        b._loop = loop
        # Should silently no-op, not raise RuntimeError('Event loop is closed').
        b._run_on_loop(lambda: None)

    def test_clear_listeners_preserves_config_cache(self):
        # After a theme rebuild the bridge drops subscriptions but the
        # cached config must survive so ``replay_config`` can reseed the
        # new panel tree.
        b = UIBridge()
        b._on_config({'currentConfigName': 'default.json'})
        b.clear_listeners()
        assert b._last_config == {'currentConfigName': 'default.json'}


class TestUIBridgeDefaultsToNoWS:
    """The bridge must default to no WebSocket transport for boot speed."""

    def test_default_ws_port_is_none(self):
        b = UIBridge()
        assert b._ws_port is None

    def test_explicit_ws_port_is_kept(self):
        b = UIBridge(ws_port=9001)
        assert b._ws_port == 9001


class TestUIBridgeDeviceResolution:
    """Bridge must auto-detect tablet config so the HID reader starts."""

    def test_default_poll_ms_is_set(self):
        # Without polling, the backend would skip the tablet thread when
        # no config is provided — exactly the empty-events bug.
        b = UIBridge()
        assert b._poll_ms is not None
        assert b._poll_ms > 0

    def test_dev_mode_skips_resolution(self):
        b = UIBridge(dev_mode=True)
        path, search_dir = b._resolve_device_config()
        assert path is None and search_dir is None

    def test_explicit_config_routes_through_resolver(self, monkeypatch):
        # ``-c`` may be a file or a directory; either way it must go
        # through ``resolve_device_config_path`` so directory paths get
        # scanned for a matching device instead of being opened as a
        # file (which would IsADirectoryError downstream).
        captured = {}

        def fake_resolve(device_path, base_dir=None, poll_ms=None, **_kwargs):
            captured['device_path'] = device_path
            captured['base_dir'] = base_dir
            captured['poll_ms'] = poll_ms
            return ('/resolved/cfg.json', '/resolved/devices')

        monkeypatch.setattr(bridge_mod, 'resolve_device_config_path', fake_resolve)
        b = UIBridge(tablet_config_path='/tmp/devices', search_dir='/tmp/base')
        path, search_dir = b._resolve_device_config()
        assert captured == {
            'device_path': '/tmp/devices',
            'base_dir': '/tmp/base',
            'poll_ms': b._poll_ms,
        }
        assert path == '/resolved/cfg.json'
        assert search_dir == '/resolved/devices'

    def test_no_config_calls_resolver_with_poll(self, monkeypatch):
        captured = {}

        def fake_resolve(device_path, base_dir=None, poll_ms=None, **_kwargs):
            captured['device_path'] = device_path
            captured['base_dir'] = base_dir
            captured['poll_ms'] = poll_ms
            return ('/auto/cfg.json', '/auto/devices')

        monkeypatch.setattr(bridge_mod, 'resolve_device_config_path', fake_resolve)
        b = UIBridge(poll_ms=1234)
        path, search_dir = b._resolve_device_config()
        assert captured == {'device_path': None, 'base_dir': None, 'poll_ms': 1234}
        assert path == '/auto/cfg.json'
        assert search_dir == '/auto/devices'



class TestUIBridgeEventBusKeptResumed:
    """Without a WS client, the event bus is paused by ``run_server`` and
    never resumed by the upstream code, so combined-event listeners never
    fire. The bridge must resume it explicitly for the in-process UI."""

    def test_keep_event_bus_resumed_calls_resume_once_ready(self):
        import asyncio

        class _FakeBus:
            def __init__(self):
                self._interval_task = None
                self.resumed = 0
            def resume(self):
                self.resumed += 1

        class _FakeServer:
            def __init__(self):
                self.event_bus = _FakeBus()

        b = UIBridge()
        srv = _FakeServer()
        b._server = srv  # type: ignore[assignment]

        async def _run():
            # Simulate ``run_server`` starting the bus shortly after.
            async def _later():
                await asyncio.sleep(0.05)
                srv.event_bus._interval_task = object()
            asyncio.create_task(_later())
            await b._keep_event_bus_resumed()

        asyncio.run(_run())
        assert srv.event_bus.resumed == 1

    def test_flushed_combined_event_reaches_listener(self):
        """End-to-end check on the bus: emit + flush + listener invocation
        with the bridge's bus-resume in effect."""
        from sketchatone.cli.server import (
            StrummerEventBus, TabletEventData,
        )
        bus = StrummerEventBus(throttle_ms=1)
        received: list = []
        bus.on_combined_event(received.append)
        bus.emit_tablet_event(TabletEventData(x=0.1, y=0.2, pressure=0.5))
        # While paused, flush returns None
        bus.pause()
        assert bus.flush() is None
        # Emit again, resume, then flush should deliver
        bus.emit_tablet_event(TabletEventData(x=0.3, y=0.4, pressure=0.6))
        bus.resume()
        payload = bus.flush()
        assert payload is not None
        assert payload.tablet is not None
        assert payload.tablet.x == pytest.approx(0.3)



class _FakeLoop:
    """Stand-in for the bridge's asyncio loop; runs callbacks inline."""

    def __init__(self):
        self.scheduled: list = []

    def call_soon_threadsafe(self, fn, *args):
        self.scheduled.append(fn)
        fn(*args)


class _FakeServer:
    def __init__(self, devices: dict):
        self._devices = devices
        self.config_updates: list = []
        self.save_calls: int = 0
        self.load_calls: list = []
        self.create_calls: list = []

    def _get_midi_devices_data(self) -> dict:
        return self._devices

    def _handle_config_update(self, path: str, value):
        self.config_updates.append((path, value))

    def _handle_save_config(self):
        self.save_calls += 1

    def _handle_load_config(self, name: str):
        self.load_calls.append(name)

    def _handle_create_config(self, name: str):
        self.create_calls.append(name)


class _FakeEventBus:
    def __init__(self, throttle_ms: int = 150):
        self.throttle_ms = throttle_ms
        self.set_calls: list = []

    def set_throttle(self, value: int) -> None:
        self.set_calls.append(value)
        self.throttle_ms = value


class TestUIBridgeMidiDevices:
    def test_midi_devices_callback_emits_event(self):
        b = UIBridge()
        received: list = []
        b.on('midi-devices', received.append)
        b._on_midi_devices({'outputPorts': [], 'inputPorts': []})
        assert received == [{'outputPorts': [], 'inputPorts': []}]

    def test_request_midi_devices_fetches_and_emits(self):
        b = UIBridge()
        snapshot = {
            'outputPorts': [{'id': 0, 'name': 'IAC Bus 1'}],
            'inputPorts': [],
            'currentOutputPort': 0,
            'currentInputPorts': [],
        }
        b._server = _FakeServer(snapshot)  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]

        received: list = []
        b.on('midi-devices', received.append)
        b.request_midi_devices()
        assert received == [snapshot]

    def test_request_midi_devices_noop_without_loop(self):
        b = UIBridge()
        # No loop, no server — should not raise.
        b.request_midi_devices()

    def test_request_midi_devices_noop_without_server(self):
        b = UIBridge()
        b._loop = _FakeLoop()  # type: ignore[assignment]
        received: list = []
        b.on('midi-devices', received.append)
        b.request_midi_devices()
        assert received == []

    def test_set_midi_output_dispatches_config_update(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        b.set_midi_output('IAC Bus 1')
        assert srv.config_updates == [('midi.midiOutputId', 'IAC Bus 1')]

    def test_set_midi_output_none_is_ignored(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        b.set_midi_output(None)
        assert srv.config_updates == []

    def test_set_midi_input_dispatches_config_update(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        b.set_midi_input([0, 2])
        assert srv.config_updates == [('midi.midiInputId', [0, 2])]

    def test_set_midi_input_empty_list_disconnects(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        b.set_midi_input([])
        assert srv.config_updates == [('midi.midiInputId', [])]


class TestUIBridgeSetConfig:
    """Generic config writes used by settings panels."""

    def test_set_config_dispatches_path_and_value(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        b.set_config('strummer.strumming.pressureThreshold', 0.25)
        assert srv.config_updates == [
            ('strummer.strumming.pressureThreshold', 0.25),
        ]

    def test_set_config_noop_without_loop(self):
        b = UIBridge()
        # No loop, no server — must not raise.
        b.set_config('strummer.mode', 'slide')


class TestUIBridgeConfigPersistence:
    """Bridge methods that wrap save/load/create config dispatch."""

    def _wired(self):
        b = UIBridge()
        srv = _FakeServer({})
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        return b, srv

    def test_save_config_invokes_server_handler(self):
        b, srv = self._wired()
        b.save_config()
        assert srv.save_calls == 1

    def test_load_config_invokes_server_handler(self):
        b, srv = self._wired()
        b.load_config('default.json')
        assert srv.load_calls == ['default.json']

    def test_load_config_empty_name_ignored(self):
        b, srv = self._wired()
        b.load_config('')
        assert srv.load_calls == []

    def test_create_config_invokes_server_handler(self):
        b, srv = self._wired()
        b.create_config('my-new.json')
        assert srv.create_calls == ['my-new.json']

    def test_create_config_empty_name_ignored(self):
        b, srv = self._wired()
        b.create_config('')
        assert srv.create_calls == []

    def test_persistence_methods_noop_without_loop(self):
        # No loop, no server — must not raise.
        b = UIBridge()
        b.save_config()
        b.load_config('default.json')
        b.create_config('new.json')



class TestUIBridgeSetThrottle:
    """Throttle adjustment flows through to event_bus + rebroadcasts config."""

    def _wired(self, throttle_ms: int = 150):
        b = UIBridge()
        srv = _FakeServer({})
        srv.event_bus = _FakeEventBus(throttle_ms)  # type: ignore[attr-defined]
        srv.broadcast_calls = 0  # type: ignore[attr-defined]

        def _bcast():
            srv.broadcast_calls += 1  # type: ignore[attr-defined]
        srv.broadcast_config = _bcast  # type: ignore[attr-defined]
        b._server = srv  # type: ignore[assignment]
        b._loop = _FakeLoop()  # type: ignore[assignment]
        return b, srv

    def test_set_throttle_updates_event_bus_and_broadcasts(self):
        b, srv = self._wired()
        b.set_throttle(33)
        assert srv.event_bus.set_calls == [33]
        assert srv.event_bus.throttle_ms == 33
        assert srv.broadcast_calls == 1

    def test_set_throttle_coerces_to_int(self):
        b, srv = self._wired()
        b.set_throttle('60')  # type: ignore[arg-type]
        assert srv.event_bus.set_calls == [60]

    def test_set_throttle_rejects_negative(self):
        b, srv = self._wired()
        b.set_throttle(-1)
        assert srv.event_bus.set_calls == []
        assert srv.broadcast_calls == 0

    def test_set_throttle_rejects_non_numeric(self):
        b, srv = self._wired()
        b.set_throttle('abc')  # type: ignore[arg-type]
        assert srv.event_bus.set_calls == []

    def test_set_throttle_noop_without_loop(self):
        b = UIBridge()
        # No loop, no server — must not raise.
        b.set_throttle(60)
