"""Tests for the subprocess-backed Kivy UI bridge."""

from __future__ import annotations

import json
import sys
import asyncio
import threading
import time

import pytest

from sketchatone.ui import bridge as bridge_mod
from sketchatone.ui.bridge import EVENT_NAMES, UIBridge


@pytest.fixture(autouse=True)
def _run_on_main_inline(monkeypatch):
    """Run scheduled callbacks inline so tests do not need a Kivy loop."""
    monkeypatch.setattr(
        bridge_mod, '_schedule_on_kivy_main',
        lambda callback, *args: callback(*args),
    )


class _FakeLoop:
    def call_soon_threadsafe(self, callback, *args):
        callback(*args)


class _FakeQueue:
    def __init__(self):
        self.items = []

    def put_nowait(self, item):
        self.items.append(item)


def _bridge_with_outbox():
    bridge = UIBridge()
    outbox = _FakeQueue()
    bridge._loop = _FakeLoop()
    bridge._send_queue = outbox
    bridge._ws = object()
    return bridge, outbox


def _messages(outbox):
    return [json.loads(message) for message in outbox.items]


class TestUIBridgeSubscription:
    def test_event_names_are_documented(self):
        assert set(EVENT_NAMES) == {
            'device-status', 'tablet', 'strum', 'combined', 'config',
            'midi-devices', 'midi-input', 'button-detection-state',
            'notes-changed', 'action',
        }

    def test_on_unknown_event_raises(self):
        with pytest.raises(ValueError):
            UIBridge().on('not-a-real-event', lambda _payload: None)

    def test_on_returns_unsubscribe(self):
        bridge = UIBridge()
        received = []
        off = bridge.on('device-status', received.append)

        bridge._emit('device-status', {'connected': True})
        off()
        bridge._emit('device-status', {'connected': False})

        assert received == [{'connected': True}]

    def test_multiple_listeners_each_called(self):
        bridge = UIBridge()
        first, second = [], []
        bridge.on('tablet', first.append)
        bridge.on('tablet', second.append)

        bridge._emit('tablet', 'event')

        assert first == ['event']
        assert second == ['event']

    def test_clear_listeners_removes_subscriptions_but_preserves_cache(self):
        bridge = UIBridge()
        received = []
        bridge.on('config', received.append)
        bridge._dispatch_message({'type': 'config', 'data': {'config': {}}})
        bridge.clear_listeners()
        bridge.replay_config()

        assert len(received) == 1
        assert bridge._last_config == {'config': {}}


class TestUIBridgeMessageDispatch:
    def test_tablet_message_fans_out_tablet_strum_and_combined(self):
        bridge = UIBridge()
        combined, tablet, strum = [], [], []
        bridge.on('combined', combined.append)
        bridge.on('tablet', tablet.append)
        bridge.on('strum', strum.append)

        bridge._dispatch_message({
            'type': 'tablet-data',
            'x': 0.5,
            'y': 0.25,
            'pressure': 0.8,
            'strum': {
                'type': 'strum',
                'velocity': 90,
                'notes': [{'note': {'notation': 'C', 'octave': 4, 'midiNote': 60},
                           'velocity': 90}],
            },
        })

        assert tablet[0].x == 0.5
        assert tablet[0].y == 0.25
        assert tablet[0].pressure == 0.8
        assert not hasattr(tablet[0], 'type')
        assert strum[0].type == 'strum'
        assert strum[0].notes[0].name == 'C'
        assert strum[0].notes[0].octave == 4
        assert strum[0].notes[0].note == 60
        assert combined[0].tablet is tablet[0]
        assert combined[0].strum is strum[0]

    def test_tablet_message_without_strum_only_emits_tablet(self):
        bridge = UIBridge()
        tablet, strum, combined = [], [], []
        bridge.on('tablet', tablet.append)
        bridge.on('strum', strum.append)
        bridge.on('combined', combined.append)

        bridge._dispatch_message({'type': 'tablet-data', 'x': 0.1})

        assert len(tablet) == 1
        assert strum == []
        assert combined[0].strum is None

    def test_status_message_is_cached_and_replayable(self):
        bridge = UIBridge()
        bridge._dispatch_message({
            'type': 'status', 'deviceConnected': True, 'message': 'XP-Pen Deco connected',
        })
        received = []
        bridge.on('device-status', received.append)
        assert received == []

        bridge.replay_status()

        assert received == [{'connected': True, 'deviceName': 'XP-Pen Deco'}]

    def test_disconnected_status_has_no_device_name(self):
        bridge = UIBridge()
        received = []
        bridge.on('device-status', received.append)

        bridge._dispatch_message({
            'type': 'status', 'deviceConnected': False, 'message': 'No tablet connected',
        })

        assert received == [{'connected': False, 'deviceName': None}]

    def test_config_message_is_cached_and_replayed(self):
        bridge = UIBridge()
        payload = {'currentConfigName': 'default.json', 'config': {}}
        bridge._dispatch_message({'type': 'config', 'data': payload})
        received = []
        bridge.on('config', received.append)

        assert received == [payload]
        received.clear()
        bridge.replay_config()
        assert received == [payload]

    def test_midi_devices_message_emits_payload(self):
        bridge = UIBridge()
        received = []
        bridge.on('midi-devices', received.append)
        payload = {'outputPorts': [], 'inputPorts': []}

        bridge._dispatch_message({'type': 'midi-devices', 'data': payload})

        assert received == [payload]

    def test_midi_input_is_cached_for_late_subscribers(self):
        bridge = UIBridge()
        payload = {'type': 'midi-input', 'connected': True}
        bridge._dispatch_message(payload)
        received = []
        bridge.on('midi-input', received.append)

        assert received == [payload]

    def test_button_detection_state_is_cached_for_late_subscribers(self):
        bridge = UIBridge()
        bridge._dispatch_message({'type': 'button-detection-state', 'enabled': True})
        received = []

        bridge.on('button-detection-state', received.append)

        assert received == [{'enabled': True}]

    @pytest.mark.parametrize(
        ('message_type', 'event_name'),
        [('notes-changed', 'notes-changed'), ('action-event', 'action')],
    )
    def test_forwarded_event_messages(self, message_type, event_name):
        bridge = UIBridge()
        received = []
        bridge.on(event_name, received.append)
        message = {'type': message_type, 'data': 'payload'}

        bridge._dispatch_message(message)

        assert received == [message]


class TestUIBridgeTransport:
    def test_default_and_explicit_websocket_ports(self):
        assert UIBridge()._ws_port == 8081
        assert UIBridge(ws_port=9001)._ws_port == 9001

    def test_server_command_includes_transport_and_optional_arguments(self):
        bridge = UIBridge(
            strummer_config_path='config.json',
            ws_port=9001,
            poll_ms=500,
            dev_mode=True,
            throttle_ms=60,
        )

        assert bridge._build_server_cmd() == [
            sys.executable, '-m', 'sketchatone.cli.server',
            '--ws-port', '9001', '--no-http', '--no-https',
            '-c', 'config.json', '--poll', '500', '--dev', '--throttle', '60',
        ]

    def test_outgoing_requests_and_config_commands(self):
        bridge, outbox = _bridge_with_outbox()
        bridge.request_midi_devices()
        bridge.set_midi_output('IAC Bus 1')
        bridge.set_midi_output(None)
        bridge.set_midi_input([0, 2])
        bridge.set_midi_input([])
        bridge.set_config('strummer.mode', 'slide')
        bridge.save_config()
        bridge.load_config('default.json')
        bridge.load_config('')
        bridge.create_config('custom.json')
        bridge.create_config('')
        bridge.set_button_detection(True)

        assert _messages(outbox) == [
            {'type': 'get-midi-devices'},
            {'type': 'update-config', 'path': 'midi.midiOutputId', 'value': 'IAC Bus 1'},
            {'type': 'update-config', 'path': 'midi.midiInputId', 'value': [0, 2]},
            {'type': 'update-config', 'path': 'midi.midiInputId', 'value': []},
            {'type': 'update-config', 'path': 'strummer.mode', 'value': 'slide'},
            {'type': 'save-config'},
            {'type': 'load-config', 'configName': 'default.json'},
            {'type': 'create-config', 'configName': 'custom.json'},
            {'type': 'set-button-detection', 'enabled': True},
        ]

    def test_set_throttle_coerces_valid_values_and_rejects_invalid_values(self):
        bridge, outbox = _bridge_with_outbox()
        bridge.set_throttle('60')
        bridge.set_throttle(-1)
        bridge.set_throttle('invalid')

        assert _messages(outbox) == [{'type': 'set-throttle', 'throttleMs': 60}]

    def test_commands_are_safe_before_transport_starts(self):
        bridge = UIBridge()
        bridge.request_midi_devices()
        bridge.set_config('strummer.mode', 'slide')
        bridge.save_config()
        bridge.set_button_detection(True)

    def test_duplicate_config_uploads_copy_with_available_configs(self):
        bridge, outbox = _bridge_with_outbox()
        config = {'strummer': {'mode': 'strum'}}
        bridge._last_config = {
            'availableConfigs': ['live.json', 'live Copy.json'],
            'currentConfigName': 'live.json',
            'config': config,
        }

        name = bridge.duplicate_current_config()

        assert name == 'live Copy 2.json'
        assert _messages(outbox) == [{
            'type': 'upload-config',
            'configName': name,
            'configData': config,
        }]

    def test_duplicate_config_seeds_bundled_default_when_pool_is_empty(self, monkeypatch):
        bridge, outbox = _bridge_with_outbox()
        default_config = {'strummer': {'mode': 'strum'}}
        monkeypatch.setattr(
            bridge_mod, '_load_bundled_default_config', lambda: default_config,
        )

        name = bridge.duplicate_current_config()

        assert name == 'default.json'
        assert _messages(outbox) == [{
            'type': 'upload-config',
            'configName': 'default.json',
            'configData': default_config,
        }]

    def test_duplicate_config_returns_none_without_any_source(self, monkeypatch):
        bridge, outbox = _bridge_with_outbox()
        monkeypatch.setattr(bridge_mod, '_load_bundled_default_config', lambda: None)

        assert bridge.duplicate_current_config() is None
        assert outbox.items == []


class TestUIBridgeAttach:
    @pytest.mark.parametrize('url', [
        'http://localhost:8081', 'ws://', 'ws://localhost:99999',
        'ws://localhost:bad', 'ws://localhost:8081/#fragment', 'not a URL',
    ])
    def test_invalid_endpoint_rejected(self, url):
        with pytest.raises(ValueError, match='--connect'):
            UIBridge(connect=url)

    @pytest.mark.parametrize('kwargs', [
        {'strummer_config_path': 'config.json'}, {'dev_mode': True},
        {'ws_port': 8081}, {'throttle_ms': 20}, {'poll_ms': None},
    ])
    def test_backend_start_options_rejected(self, kwargs):
        with pytest.raises(ValueError, match='--connect'):
            UIBridge(connect='ws://localhost:8081', **kwargs)

    def test_attach_never_spawns_and_stop_cancels_pending_connection(self, monkeypatch):
        import websockets
        attempting = threading.Event()

        async def connect(*args, **kwargs):
            attempting.set()
            await asyncio.sleep(3600)

        def forbidden(*args, **kwargs):
            pytest.fail('Attach mode must not spawn or terminate a subprocess')

        monkeypatch.setattr(websockets, 'connect', connect)
        monkeypatch.setattr(bridge_mod.subprocess, 'Popen', forbidden)
        bridge = UIBridge(connect='ws://127.0.0.1:8081')
        bridge._process = type('Process', (), {'poll': forbidden})()
        bridge.start()
        assert attempting.wait(2)
        started = time.monotonic()
        thread = bridge._thread
        bridge.stop()
        assert time.monotonic() - started < 2
        assert not thread.is_alive()
        assert bridge._thread is None

    def test_failed_connections_back_off_with_bounded_delay(self, monkeypatch):
        import websockets
        delays = []

        async def connect(*args, **kwargs):
            raise OSError('service unavailable')

        async def sleep(delay):
            delays.append(delay)
            if len(delays) == 9:
                raise asyncio.CancelledError

        monkeypatch.setattr(websockets, 'connect', connect)
        monkeypatch.setattr(bridge_mod.asyncio, 'sleep', sleep)
        bridge = UIBridge(connect='ws://127.0.0.1:8081')
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(bridge._run())
        assert delays == [0.25, 0.5, 1.0, 2.0, 4.0, 5.0, 5.0, 5.0, 5.0]
        assert bridge._last_status['connected'] is False

    def test_stop_interrupts_reconnect_delay(self, monkeypatch):
        import websockets
        sleeping = threading.Event()
        original_sleep = asyncio.sleep

        async def connect(*args, **kwargs):
            raise OSError('offline')

        async def sleep(delay):
            sleeping.set()
            await original_sleep(3600)

        monkeypatch.setattr(websockets, 'connect', connect)
        monkeypatch.setattr(bridge_mod.asyncio, 'sleep', sleep)
        bridge = UIBridge(connect='ws://localhost:8081')
        bridge.start()
        assert sleeping.wait(2)
        thread = bridge._thread
        bridge.stop()
        assert not thread.is_alive()

    def test_reconnect_reads_fresh_config_and_discards_pending_edits(self, monkeypatch):
        import websockets
        bridge = UIBridge(connect='ws://localhost:8081')
        configs = []
        bridge.on('config', configs.append)
        sockets = []
        old_queue = None

        class Socket:
            def __init__(self, number):
                self.number = number
                self.closed = False
                self.sent = []

            def __aiter__(self):
                return self.messages()

            async def messages(self):
                nonlocal old_queue
                if self.number == 2:
                    assert bridge._send_queue is not old_queue
                yield json.dumps({
                    'type': 'config',
                    'data': {'currentConfigName': f'server-{self.number}.json'},
                })
                old_queue = bridge._send_queue
                bridge._send_queue.put_nowait(f'mutation-{self.number}')
                if self.number == 2:
                    bridge._stopping.set()

            async def send(self, msg):
                self.sent.append(msg)

            async def close(self):
                self.closed = True

        async def connect(url, **kwargs):
            assert url == 'ws://localhost:8081'
            assert bridge._last_config is None
            socket = Socket(len(sockets) + 1)
            sockets.append(socket)
            return socket

        async def no_wait(delay):
            assert bridge._ws is None
            assert bridge._send_queue is None
            bridge.set_config('strummer.mode', 'offline edit')

        async def run():
            bridge._loop = asyncio.get_running_loop()
            await bridge._run()

        monkeypatch.setattr(websockets, 'connect', connect)
        monkeypatch.setattr(bridge_mod.asyncio, 'sleep', no_wait)
        asyncio.run(run())
        assert configs == [
            {'currentConfigName': 'server-1.json'},
            {'currentConfigName': 'server-2.json'},
        ]
        assert len(sockets) == 2
        assert all(socket.closed for socket in sockets)
        assert 'mutation-1' not in sockets[1].sent
        assert all('offline edit' not in str(socket.sent) for socket in sockets)

    def test_scheduled_command_is_not_carried_across_reconnect(self):
        callbacks = []

        class DeferredLoop:
            def call_soon_threadsafe(self, callback):
                callbacks.append(callback)

        bridge, old_queue = _bridge_with_outbox()
        bridge._loop = DeferredLoop()
        bridge.save_config()
        bridge._ws = object()
        bridge._send_queue = new_queue = _FakeQueue()
        callbacks[0]()
        assert old_queue.items == new_queue.items == []

    def test_disconnected_commands_are_dropped(self):
        bridge, outbox = _bridge_with_outbox()
        bridge._ws = None
        bridge.save_config()
        bridge.set_config('strummer.mode', 'slide')
        assert outbox.items == []

    def test_unexpected_connection_error_is_not_retried(self, monkeypatch):
        import websockets

        async def connect(*args, **kwargs):
            raise RuntimeError('programming error')

        monkeypatch.setattr(websockets, 'connect', connect)
        bridge = UIBridge(connect='ws://localhost:8081')
        with pytest.raises(RuntimeError, match='programming error'):
            asyncio.run(bridge._run())

    def test_malformed_json_and_protocol_messages_are_logged(self, caplog):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                for message in ('{broken', '[]', '{"type": 12}',
                                '{"type": "config", "data": {"config": {}}}'):
                    yield message

        bridge = UIBridge(connect='ws://localhost:8081')
        asyncio.run(bridge._receive_loop(Socket()))
        assert bridge._last_config == {'config': {}}
        assert 'malformed backend WebSocket JSON' in caplog.text
        assert caplog.text.count('without a string type') == 2

    def test_dispatch_bug_propagates_and_connection_is_closed(self, monkeypatch):
        class Socket:
            closed = False

            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield '{"type": "config"}'

            async def close(self):
                self.closed = True

        def dispatch(message):
            raise RuntimeError('dispatch bug')

        bridge = UIBridge(connect='ws://localhost:8081')
        monkeypatch.setattr(bridge, '_dispatch_message', dispatch)
        socket = Socket()
        with pytest.raises(RuntimeError, match='dispatch bug'):
            asyncio.run(bridge._serve_connection(socket))
        assert socket.closed
        assert bridge._ws is None
        assert bridge._send_queue is None

    def test_repeated_outage_logs_one_warning_then_debug(self, monkeypatch, caplog):
        import logging
        import websockets
        attempts = 0

        async def connect(*args, **kwargs):
            raise OSError('offline')

        async def sleep(delay):
            nonlocal attempts
            attempts += 1
            if attempts == 3:
                raise asyncio.CancelledError

        monkeypatch.setattr(websockets, 'connect', connect)
        monkeypatch.setattr(bridge_mod.asyncio, 'sleep', sleep)
        caplog.set_level(logging.DEBUG, logger=bridge_mod.__name__)
        bridge = UIBridge(connect='ws://localhost:8081')
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(bridge._run())
        records = [record for record in caplog.records
                   if record.name == bridge_mod.__name__]
        assert [record.levelno for record in records] == [
            logging.WARNING, logging.DEBUG, logging.DEBUG,
        ]
