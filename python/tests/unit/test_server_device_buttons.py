"""
Tests for device-button and device-key detection wiring in
StrummerWebSocketServer.

Covers the ephemeral ``detecting_device_buttons`` flag, the
``set-button-detection`` client message, ``_maybe_learn_device_button`` /
``_maybe_learn_device_key`` gating, and the ``button-detection-state``
broadcast.
"""

import json
import asyncio
from unittest.mock import MagicMock, patch

import pytest

from sketchatone.cli.server import StrummerWebSocketServer, StrummerEventBus
from sketchatone.models import MidiStrummerConfig


def _make_server():
    """Build a minimal server instance bypassing the heavy __init__."""
    server = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    server.config = MidiStrummerConfig()
    server.event_bus = StrummerEventBus(throttle_ms=0)
    server.detecting_device_buttons = False
    # No real websocket clients; _broadcast is patched or bypassed via _main_loop.
    server.clients = set()
    server._main_loop = None
    return server


class TestDetectingDeviceButtonsInitialState:
    def test_flag_defaults_to_false(self):
        server = _make_server()
        assert server.detecting_device_buttons is False


class TestMaybeLearnDeviceButton:
    def test_does_not_learn_when_detection_off(self):
        server = _make_server()
        with patch.object(server, '_persist_config_to_file') as persist, \
             patch.object(server, 'broadcast_config') as bcast:
            server._maybe_learn_device_button(42)

        assert server.config.device_buttons.buttons == []
        persist.assert_not_called()
        bcast.assert_not_called()

    def test_learns_new_code_when_detection_on(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file') as persist, \
             patch.object(server, 'broadcast_config') as bcast:
            server._maybe_learn_device_button(42)

        buttons = server.config.device_buttons.buttons
        assert len(buttons) == 1
        assert buttons[0].code == 42
        assert buttons[0].name == 'Button 1'
        persist.assert_called_once()
        bcast.assert_called_once_with(is_saved_state=True)

    def test_ignores_already_known_code(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file'), \
             patch.object(server, 'broadcast_config'):
            server._maybe_learn_device_button(42)
            server._maybe_learn_device_button(42)

        assert len(server.config.device_buttons.buttons) == 1

    def test_names_use_sequential_indices(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file'), \
             patch.object(server, 'broadcast_config'):
            server._maybe_learn_device_button(10)
            server._maybe_learn_device_button(20)
            server._maybe_learn_device_button(30)

        names = [b.name for b in server.config.device_buttons.buttons]
        assert names == ['Button 1', 'Button 2', 'Button 3']


class TestMaybeLearnDeviceKey:
    def test_does_not_learn_when_detection_off(self):
        server = _make_server()
        with patch.object(server, '_persist_config_to_file') as persist, \
             patch.object(server, 'broadcast_config') as bcast:
            server._maybe_learn_device_key('a')

        assert server.config.device_buttons.keys == []
        persist.assert_not_called()
        bcast.assert_not_called()

    def test_learns_new_key_when_detection_on(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file') as persist, \
             patch.object(server, 'broadcast_config') as bcast:
            server._maybe_learn_device_key('a')

        keys = server.config.device_buttons.keys
        assert len(keys) == 1
        assert keys[0].key == 'a'
        assert keys[0].name == 'Key A'
        persist.assert_called_once()
        bcast.assert_called_once_with(is_saved_state=True)

    def test_ignores_already_known_key(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file'), \
             patch.object(server, 'broadcast_config'):
            server._maybe_learn_device_key('a')
            server._maybe_learn_device_key('a')

        assert len(server.config.device_buttons.keys) == 1

    def test_ignores_empty_key(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_persist_config_to_file') as persist, \
             patch.object(server, 'broadcast_config') as bcast:
            server._maybe_learn_device_key('')

        assert server.config.device_buttons.keys == []
        persist.assert_not_called()
        bcast.assert_not_called()


class TestBroadcastButtonDetectionState:
    def test_broadcasts_current_flag(self):
        server = _make_server()
        server.detecting_device_buttons = True

        with patch.object(server, '_broadcast') as bcast:
            server._broadcast_button_detection_state()

        bcast.assert_called_once()
        payload = json.loads(bcast.call_args[0][0])
        assert payload == {'type': 'button-detection-state', 'enabled': True}

    def test_broadcasts_false_when_off(self):
        server = _make_server()
        server.detecting_device_buttons = False

        with patch.object(server, '_broadcast') as bcast:
            server._broadcast_button_detection_state()

        payload = json.loads(bcast.call_args[0][0])
        assert payload == {'type': 'button-detection-state', 'enabled': False}


class TestSetButtonDetectionMessage:
    def test_enables_flag_and_broadcasts(self):
        server = _make_server()
        websocket = MagicMock()

        with patch.object(server, '_broadcast_button_detection_state') as bcast:
            asyncio.run(server._handle_client_message(
                websocket,
                json.dumps({'type': 'set-button-detection', 'enabled': True}),
            ))

        assert server.detecting_device_buttons is True
        bcast.assert_called_once()

    def test_disables_flag_and_broadcasts(self):
        server = _make_server()
        server.detecting_device_buttons = True
        websocket = MagicMock()

        with patch.object(server, '_broadcast_button_detection_state') as bcast:
            asyncio.run(server._handle_client_message(
                websocket,
                json.dumps({'type': 'set-button-detection', 'enabled': False}),
            ))

        assert server.detecting_device_buttons is False
        bcast.assert_called_once()

    def test_missing_enabled_field_defaults_to_false(self):
        server = _make_server()
        server.detecting_device_buttons = True
        websocket = MagicMock()

        with patch.object(server, '_broadcast_button_detection_state'):
            asyncio.run(server._handle_client_message(
                websocket,
                json.dumps({'type': 'set-button-detection'}),
            ))

        assert server.detecting_device_buttons is False



