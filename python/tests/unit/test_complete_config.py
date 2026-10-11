import json
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sketchatone.cli.server import StrummerWebSocketServer
from sketchatone.models import MidiStrummerConfig
from sketchatone.models.config_validation import (
    config_validation_template, validate_complete_config, normalize_complete_config,
)
from sketchatone.strummer.strummer import Strummer
from sketchatone.strummer.slider import Slider
from sketchatone.strummer.actions import Actions
from sketchatone.models.note import Note
from sketchatone.models.chord_mode import resolve_chord_mode_entry


@pytest.fixture
def server():
    directory = Path.cwd() / ('.config-apply-test-' + uuid4().hex)
    directory.mkdir()
    instance = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    instance.config = MidiStrummerConfig()
    instance.current_config_name = 'current.json'
    instance.strummer_config_path = str(directory / 'current.json')
    Path(instance.strummer_config_path).write_text(json.dumps(instance.config.to_dict()))
    instance.strummer = Strummer()
    instance.slider = Slider()
    instance.actions = Actions(instance.config, instance.strummer)
    instance.event_bus = MagicMock()
    instance.event_bus.throttle_ms = 150
    instance.backend = None
    instance.bridge = None
    instance.midi_input = None
    instance.keyboard_listener = None
    instance._clear_controller_state = MagicMock()
    instance.tablet_client = None
    instance._perf = MagicMock()
    instance._list_configs = MagicMock(return_value=['current.json'])
    instance._broadcast = MagicMock()
    instance._broadcast_midi_devices = MagicMock()
    yield instance
    for file in directory.iterdir():
        file.unlink()
    directory.rmdir()


async def apply(server, config, **overrides):
    websocket = AsyncMock()
    def check_guard(_message):
        assert not server._applying_config
    websocket.send.side_effect = check_guard
    message = {
        'type': 'apply-config', 'requestId': 'request', 'configName': 'current.json',
        'baseConfig': server.config.to_dict(), 'config': config, **overrides,
    }
    await server._handle_client_message(websocket, json.dumps(message))
    return json.loads(websocket.send.call_args[0][0])['data']


@pytest.mark.asyncio
async def test_complete_apply_refreshes_runtime_and_saves_once(server):
    config = server.config.to_dict()
    config['strummer']['pitch']['startingOffset'] = 7
    config['strummer']['harmonicContext']['startingRoot'] = 'D'
    config['strummer']['strumming']['initialNotes'] = ['D4', 'F#4']
    config['server']['wsMessageThrottle'] = 25
    config['deviceButtons']['buttons'] = [{'code': 42, 'name': 'Tablet'}]
    from sketchatone.utils.config_file import write_config_file
    with patch('sketchatone.cli.server.write_config_file', wraps=write_config_file) as write:
        result = await apply(server, config)
    assert result['success'], result
    assert write.call_count == 1
    assert json.loads(Path(server.strummer_config_path).read_text()) == server.config.to_dict()
    assert server.actions.config is server.config
    assert server.actions.get_pitch_offset() == 7
    server.event_bus.set_throttle.assert_called_once_with(25)
    server._clear_controller_state.assert_called_once()

@pytest.mark.asyncio
async def test_bundled_jazz_half_diminished_validates_and_applies(server):
    config = MidiStrummerConfig.from_dict(json.loads(
        (Path(__file__).parents[2] / 'sketchatone/ui/assets/default_config.json').read_text(),
    )).to_dict()
    assert validate_complete_config(config) == []
    result = await apply(server, config)
    assert result['success'], result
    resolved = resolve_chord_mode_entry(server.config.strummer.chord_modes['jazz'][2])
    assert resolved['chordSuffix'] == 'm7b5'
    notes = Note.parse_chord('B' + resolved['chordSuffix'], 4)
    assert [(note.notation, note.octave) for note in notes] == [
        ('B', 4), ('D', 5), ('F', 5), ('A', 5),
    ]


@pytest.mark.parametrize('quality,extension', [
    ('half-diminished', 'none'), ('half-diminished', '7'),
    ('major', 'm7b5'), ('minor', 'm7b5'),
])
def test_incompatible_half_diminished_combinations(quality, extension):
    assert resolve_chord_mode_entry({
        'degree': 7, 'alteration': 0, 'quality': quality, 'extension': extension,
    }) is None


@pytest.mark.asyncio
@pytest.mark.parametrize('config', [None, [], {'strummer': None, 'midi': {}, 'server': {}}])
async def test_invalid_input_does_not_mutate(server, config):
    previous = server.config
    file = Path(server.strummer_config_path).read_text()
    result = await apply(server, config)
    assert not result['success']
    assert server.config is previous
    assert Path(server.strummer_config_path).read_text() == file
    server._clear_controller_state.assert_not_called()


@pytest.mark.asyncio
async def test_conflicts_and_write_failure(server):
    config = server.config.to_dict()
    for override in [{'configName': 'other.json'}, {'baseConfig': {}}]:
        result = await apply(server, config, **override)
        assert not result['success'] and 'changed' in result['error']
    previous = server.config
    with patch('sketchatone.cli.server.write_config_file', side_effect=OSError('disk failure')):
        result = await apply(server, config)
    assert 'disk failure' in result['error']
    assert server.config is previous
    server._clear_controller_state.assert_not_called()


@pytest.mark.asyncio
async def test_runtime_failure_rolls_back(server):
    previous = server.config
    config = server.config.to_dict()
    config['server']['wsMessageThrottle'] = 99
    with patch.object(server, '_refresh_complete_config', side_effect=[ValueError('runtime failure'), None]):
        result = await apply(server, config)
    assert not result['success'] and 'runtime failure' in result['error']
    assert server.config is previous
    assert json.loads(Path(server.strummer_config_path).read_text()) == previous.to_dict()
    assert not server._applying_config
    snapshot = json.loads(server._broadcast.call_args[0][0])
    assert snapshot['data']['config'] == previous.to_dict()
    assert snapshot['data']['isSavedState']


@pytest.mark.asyncio
async def test_apply_broadcasts_after_clearing_guard_and_future_updates_persist(server):
    def during_refresh():
        assert server._applying_config
        server.broadcast_config()
        server._persist_config_to_file()
    callback = MagicMock(side_effect=during_refresh)
    server.strummer.on('notes_changed', callback)
    config = server.config.to_dict()
    config['server']['wsMessageThrottle'] = 25
    result = await apply(server, config)
    assert result['success'], result
    assert not server._applying_config
    callback.assert_called()
    server._broadcast.assert_called_once()
    snapshot = json.loads(server._broadcast.call_args[0][0])
    assert snapshot['data']['config'] == server.config.to_dict()
    assert snapshot['data']['isSavedState']
    server._handle_config_update('server.wsMessageThrottle', 40)
    assert json.loads(Path(server.strummer_config_path).read_text())['server']['wsMessageThrottle'] == 40
    server.broadcast_config(is_saved_state=True)
    assert server._broadcast.call_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('selection', ['output', 'single input', 'multiple inputs'])
async def test_failed_explicit_midi_selection_rolls_back(server, selection):
    server.config.midi.midi_output_id = 1
    server.config.midi.midi_input_id = [1]
    Path(server.strummer_config_path).write_text(json.dumps(server.config.to_dict()))
    previous = server.config
    file = Path(server.strummer_config_path).read_text()
    server.backend = MagicMock()
    server.backend.connect.return_value = True
    server.midi_input = MagicMock()
    server.midi_input.connect.return_value = True
    server.midi_input.connect_multiple.return_value = True
    server.midi_input.connect_all.return_value = False
    server._register_midi_input_callback = MagicMock()
    config = previous.to_dict()
    if selection == 'output':
        config['midi']['midiOutputId'] = 2
        server.backend.connect.side_effect = [False, True]
    elif selection == 'single input':
        config['midi']['midiInputId'] = 'missing input'
        server.midi_input.connect.side_effect = [False, True]
    else:
        config['midi']['midiInputId'] = [3]
        server.midi_input.connect_multiple.side_effect = [False, True]
    result = await apply(server, config)
    assert not result['success']
    assert 'Failed to connect MIDI' in result['error']
    assert 'Rollback failed' not in result['error']
    assert server.config is previous
    assert json.loads(Path(server.strummer_config_path).read_text()) == json.loads(file)
    assert not server._applying_config
    if selection == 'output':
        server.backend.connect.assert_called_with(1)
    else:
        server.midi_input.connect_multiple.assert_called_with([1], exclude_ports=list(previous.midi.midi_input_exclude))
    snapshot = json.loads(server._broadcast.call_args[0][0])
    assert snapshot['data']['config'] == previous.to_dict()


@pytest.mark.asyncio
@pytest.mark.parametrize('port', [[], None])
async def test_intentional_disconnect_and_unavailable_automatic_inputs(server, port):
    server.config.midi.midi_output_id = 1
    server.config.midi.midi_input_id = [2]
    server.backend = MagicMock()
    server.backend.connect.return_value = False
    server.midi_input = MagicMock()
    server.midi_input.connect_all.return_value = False
    server._register_midi_input_callback = MagicMock()
    config = server.config.to_dict()
    config['midi']['midiOutputId'] = None
    config['midi']['midiInputId'] = port
    result = await apply(server, config)
    assert result['success'], result
    server.backend.disconnect.assert_called_once()
    server.backend.connect.assert_not_called()
    server.midi_input.connect.assert_not_called()
    server.midi_input.connect_multiple.assert_not_called()
    assert server.midi_input.connect_all.call_count == (1 if port is None else 0)


@pytest.mark.asyncio
async def test_apply_clears_midi_passthrough_callback(server):
    server.backend = MagicMock()
    server.midi_input = MagicMock()
    server._register_midi_input_callback = MagicMock()
    server.config.midi.midi_passthrough = [{'inputPort': 3, 'outputPort': 2}]
    server._register_midi_passthrough()
    assert callable(server.midi_input.set_passthrough_callback.call_args[0][0])
    config = server.config.to_dict()
    config['midi']['midiPassthrough'] = []
    result = await apply(server, config)
    assert result['success'], result
    server.midi_input.set_passthrough_callback.assert_called_with(None)


def test_validation_nested_types_ranges_and_aliases():
    config = MidiStrummerConfig().to_dict()
    assert validate_complete_config(config) == []
    config['strummer']['chordModes'] = {'major': [{'degree': 3, 'quality': 'minor', 'extension': 'maj7'}]}
    config['deviceButtons']['buttons'] = [{'code': 'wrong'}]
    config['strummer']['strumming']['pressureBufferSize'] = False
    config['midi']['inputMode'] = 'invalid'
    config['server']['unknown'] = True
    assert len(validate_complete_config(config)) >= 5
    aliased = {'strummer': {'pitch': {'starting_offset': 7}}, 'midi': {'output_port': 1}, 'server': {}}
    assert validate_complete_config(aliased) == []
    normalized = normalize_complete_config(aliased)
    assert normalized['midi']['midiOutputId'] == 1
    assert normalized['strummer']['pitch']['startingOffset'] == 7


@pytest.mark.asyncio
async def test_refreshes_midi_channel_ports_exclusions_and_duration(server):
    server.backend = MagicMock()
    server.midi_input = MagicMock()
    server.bridge = MagicMock()
    server._register_midi_input_callback = MagicMock()
    config = server.config.to_dict()
    config['midi']['midiOutputId'] = 2
    config['midi']['midiInputId'] = [3]
    config['midi']['midiInputExclude'] = ['exclude']
    config['midi']['defaultNoteDuration'] = 2
    config['strummer']['strumming']['midiChannel'] = 5
    result = await apply(server, config)
    assert result['success'], result
    server.backend.set_channel.assert_called_once_with(4)
    server.backend.connect.assert_called_once_with(2)
    server.midi_input.connect_multiple.assert_called_once_with([3], exclude_ports=['exclude'])
    assert server.bridge.note_duration == 2
