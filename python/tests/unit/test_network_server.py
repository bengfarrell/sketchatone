import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest

from sketchatone.cli.server import StrummerWebSocketServer


@pytest.fixture
def server():
    server = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    server.clients = set()
    server._network_apply_task = None
    server._network_store = Mock()
    server._network_store.config = {'enabled': False, 'password': 'secret'}
    server._network_store.public_config.return_value = {'enabled': False, 'passwordSet': True}
    server._network_manager = Mock()
    server._network_manager.status = {'supported': True, 'mode': 'disabled'}
    server._network_manager.busy = False
    server._network_manager.apply = AsyncMock()
    return server


async def test_settings_are_redacted_and_separate_from_presets(server):
    socket = AsyncMock()
    await server._handle_client_message(socket, '{"type":"get-network-settings"}')

    message = json.loads(socket.send.call_args.args[0])
    assert message['type'] == 'network-settings'
    assert message['data']['supported']
    assert message['data']['settings'] == {'enabled': False, 'passwordSet': True}
    assert 'secret' not in json.dumps(message)
    assert len(message['data']['revision']) == 64


async def test_networking_unavailable_without_explicit_path():
    server = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    socket = AsyncMock()

    await server._handle_client_message(socket, '{"type":"get-network-settings"}')

    assert json.loads(socket.send.call_args.args[0])['data']['supported'] is False


async def test_stale_settings_rejected_without_saving(server):
    socket = AsyncMock()
    await server._handle_network_settings(socket, {
        'requestId': 'stale', 'revision': 'wrong', 'settings': {'enabled': True},
    })

    server._network_store.save.assert_not_called()
    result = json.loads(socket.send.call_args.args[0])['data']
    assert not result['success']
    assert 'changed' in result['error']
    assert server._network_apply_task is None


async def test_external_json_edits_invalidate_revision(server):
    revision = server._network_settings_snapshot()['revision']
    server._network_store.load.side_effect = lambda: server._network_store.config.update(enabled=True)
    socket = AsyncMock()

    await server._handle_network_settings(socket, {
        'requestId': 'external', 'revision': revision, 'settings': {'enabled': False},
    })

    server._network_store.save.assert_not_called()
    assert not json.loads(socket.send.call_args.args[0])['data']['success']


async def test_acceptance_precedes_network_transition(server):
    socket = AsyncMock()
    settings = {'enabled': True}
    await server._handle_network_settings(socket, {
        'requestId': 'apply', 'revision': server._network_settings_snapshot()['revision'],
        'settings': settings,
    })
    try:
        server._network_store.save.assert_called_once_with(settings)
        result = json.loads(socket.send.call_args.args[0])['data']
        assert result['success']
        assert result['requestId'] == 'apply'
        server._network_manager.apply.assert_not_awaited()
    finally:
        server._network_apply_task.cancel()
        await asyncio.gather(server._network_apply_task, return_exceptions=True)


async def test_busy_manager_rejects_apply(server):
    server._network_manager.busy = True
    socket = AsyncMock()
    await server._handle_network_settings(socket, {
        'requestId': 'busy', 'revision': server._network_settings_snapshot()['revision'],
        'settings': {},
    })

    server._network_store.save.assert_not_called()
    assert 'already' in json.loads(socket.send.call_args.args[0])['data']['error']


async def test_validation_failure_is_correlated(server):
    server._network_store.save.side_effect = ValueError('Invalid network settings.')
    socket = AsyncMock()
    await server._handle_network_settings(socket, {
        'requestId': 'invalid', 'revision': server._network_settings_snapshot()['revision'],
        'settings': {},
    })

    result = json.loads(socket.send.call_args.args[0])['data']
    assert result == {
        'requestId': 'invalid', 'success': False, 'error': 'Invalid network settings.',
    }


async def test_saved_settings_apply_even_if_acknowledgement_disconnects(server):
    socket = AsyncMock()
    socket.send.side_effect = ConnectionError('Browser disconnected')

    with pytest.raises(ConnectionError):
        await server._handle_network_settings(socket, {
            'requestId': 'disconnect', 'revision': server._network_settings_snapshot()['revision'],
            'settings': {'enabled': True},
        })

    await server._network_apply_task
    server._network_manager.apply.assert_awaited_once()


async def test_real_store_and_manager_protocol_contract(tmp_path, monkeypatch):
    from sketchatone.networking import NetworkConfigStore, NetworkManager

    monkeypatch.setattr('sketchatone.networking.manager.platform.system', lambda: 'Linux')
    monkeypatch.setattr('sketchatone.networking.manager.shutil.which', lambda _: '/usr/bin/nmcli')
    instance = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    instance.clients = set()
    instance._network_apply_task = None
    instance._network_store = NetworkConfigStore(tmp_path / 'device-network.json')
    instance._network_store.load()
    instance._network_manager = NetworkManager(instance._network_store)
    await instance._network_manager.start()
    snapshot = instance._network_settings_snapshot()
    assert snapshot['supported']
    assert snapshot['settings']['enabled'] is False
    assert not snapshot['settings']['wifi']['hotspot']['passwordSet']
    socket = AsyncMock()

    await instance._handle_network_settings(socket, {
        'requestId': 'real-store', 'revision': snapshot['revision'],
        'settings': {'enabled': False},
    })

    try:
        assert json.loads(socket.send.call_args.args[0])['data']['success']
        assert (tmp_path / 'device-network.json').exists()
        assert not instance._network_manager.busy
    finally:
        instance._network_apply_task.cancel()
        await asyncio.gather(instance._network_apply_task, return_exceptions=True)
        await instance._network_manager.stop()
