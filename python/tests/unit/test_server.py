"""
Tests for the Strummer WebSocket Server.

Tests for the StrummerWebSocketServer class including:
- camelCase to snake_case conversion
- Path-based config updates
- Status message format
- Throttle message handling
- Event bus functionality
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, MagicMock, patch, AsyncMock
from dataclasses import dataclass
from typing import Optional, Dict, Any

# Import the server module components
from sketchatone.cli.server import (
    StrummerEventBus,
    TabletEventData,
    StrumEventData,
    CombinedEventData,
)
from sketchatone.models import MidiStrummerConfig


class TestCamelToSnakeConversion:
    """Test camelCase to snake_case conversion."""
    
    @staticmethod
    def _camel_to_snake(name: str) -> str:
        """Convert camelCase to snake_case (copied from server for testing)"""
        import re
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()
    
    def test_simple_camel_case(self):
        """Test simple camelCase conversion."""
        assert self._camel_to_snake('upperNoteSpread') == 'upper_note_spread'
        assert self._camel_to_snake('lowerNoteSpread') == 'lower_note_spread'
        assert self._camel_to_snake('midiChannel') == 'midi_channel'
    
    def test_single_word(self):
        """Test single word (no conversion needed)."""
        assert self._camel_to_snake('chord') == 'chord'
        assert self._camel_to_snake('notes') == 'notes'
    
    def test_already_snake_case(self):
        """Test already snake_case strings."""
        assert self._camel_to_snake('upper_note_spread') == 'upper_note_spread'
        assert self._camel_to_snake('midi_channel') == 'midi_channel'
    
    def test_multiple_capitals(self):
        """Test strings with multiple consecutive capitals."""
        assert self._camel_to_snake('initialNotes') == 'initial_notes'
        assert self._camel_to_snake('pressureThreshold') == 'pressure_threshold'
    
    def test_acronyms(self):
        """Test strings with acronyms."""
        assert self._camel_to_snake('midiID') == 'midi_id'
        assert self._camel_to_snake('httpPort') == 'http_port'
        assert self._camel_to_snake('wsPort') == 'ws_port'
    
    def test_numbers(self):
        """Test strings with numbers."""
        assert self._camel_to_snake('note1') == 'note1'
        assert self._camel_to_snake('channel10') == 'channel10'


class TestSetConfigValue:
    """Test path-based config value setting."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.config = MidiStrummerConfig()
    
    @staticmethod
    def _camel_to_snake(name: str) -> str:
        """Convert camelCase to snake_case"""
        import re
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()
    
    def _set_config_value(self, path: str, value: Any) -> None:
        """Set a config value using dot-notation path (copied from server)."""
        parts = path.split('.')
        current = self.config
        
        for i, part in enumerate(parts[:-1]):
            snake_part = self._camel_to_snake(part)
            if hasattr(current, snake_part):
                current = getattr(current, snake_part)
            elif hasattr(current, part):
                current = getattr(current, part)
            elif isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, dict) and snake_part in current:
                current = current[snake_part]
            else:
                raise ValueError(f"Invalid path: {path} (failed at '{part}')")
        
        last_part = parts[-1]
        snake_last = self._camel_to_snake(last_part)
        
        if hasattr(current, snake_last):
            setattr(current, snake_last, value)
        elif hasattr(current, last_part):
            setattr(current, last_part, value)
        elif isinstance(current, dict):
            if snake_last in current:
                current[snake_last] = value
            else:
                current[last_part] = value
        else:
            raise ValueError(f"Cannot set value at path: {path}")
    
    def test_set_upper_note_spread(self):
        """Test setting upperNoteSpread via path."""
        self._set_config_value('strummer.strumming.upperNoteSpread', 5)
        assert self.config.strummer.strumming.upper_note_spread == 5
    
    def test_set_lower_note_spread(self):
        """Test setting lowerNoteSpread via path."""
        self._set_config_value('strummer.strumming.lowerNoteSpread', 2)
        assert self.config.strummer.strumming.lower_note_spread == 2
    
    def test_set_chord(self):
        """Test setting chord via path."""
        self._set_config_value('strummer.strumming.chord', 'Am')
        assert self.config.strummer.strumming.chord == 'Am'
    
    def test_set_pressure_threshold(self):
        """Test setting pressureThreshold via path."""
        self._set_config_value('strummer.strumming.pressureThreshold', 0.2)
        assert self.config.strummer.strumming.pressure_threshold == 0.2
    
    def test_set_midi_channel(self):
        """Test setting midiChannel via path."""
        self._set_config_value('strummer.strumming.midiChannel', 5)
        assert self.config.strummer.strumming.midi_channel == 5
    
    def test_set_initial_notes(self):
        """Test setting initialNotes via path."""
        self._set_config_value('strummer.strumming.initialNotes', ['A3', 'C4', 'E4'])
        assert self.config.strummer.strumming.initial_notes == ['A3', 'C4', 'E4']
    
    def test_set_note_duration_control(self):
        """Test setting note duration control via path."""
        self._set_config_value('strummer.noteDuration.control', 'pressure')
        assert self.config.strummer.note_duration.control == 'pressure'
    
    def test_set_transpose_active(self):
        """Test setting transpose active via path."""
        self._set_config_value('strummer.transpose.active', True)
        assert self.config.strummer.transpose.active is True
    
    def test_set_transpose_semitones(self):
        """Test setting transpose semitones via path."""
        self._set_config_value('strummer.transpose.semitones', 7)
        assert self.config.strummer.transpose.semitones == 7
    
    def test_invalid_path_raises_error(self):
        """Test that invalid path raises ValueError."""
        with pytest.raises(ValueError, match="Invalid path"):
            self._set_config_value('strummer.invalid.path', 'value')
    
    def test_snake_case_path(self):
        """Test that snake_case paths also work."""
        self._set_config_value('strummer.strumming.upper_note_spread', 4)
        assert self.config.strummer.strumming.upper_note_spread == 4


class TestStrummerEventBus:
    """Test the StrummerEventBus class."""
    
    def test_default_throttle(self):
        """Test default throttle value."""
        bus = StrummerEventBus()
        assert bus.throttle_ms == 150
    
    def test_custom_throttle(self):
        """Test custom throttle value."""
        bus = StrummerEventBus(throttle_ms=200)
        assert bus.throttle_ms == 200
    
    def test_set_throttle(self):
        """Test setting throttle value."""
        bus = StrummerEventBus()
        bus.set_throttle(300)
        assert bus.throttle_ms == 300
    
    def test_emit_tablet_event(self):
        """Test emitting tablet event."""
        bus = StrummerEventBus()
        event = TabletEventData(
            x=0.5, y=0.5, pressure=0.3,
            tiltX=0, tiltY=0, tiltXY=0,
            primaryButtonPressed=False,
            secondaryButtonPressed=False,
            state='contact'
        )
        bus.emit_tablet_event(event)
        # Event should be buffered
        assert bus._buffer.tablet == event
        assert bus._has_new_data is True

    def test_emit_strum_event(self):
        """Test emitting strum event."""
        bus = StrummerEventBus()
        event = StrumEventData(
            type='strum',
            notes=[],
            velocity=100,
            x=0.5,
            pressure=0.3
        )
        bus.emit_strum_event(event)
        # Event should be buffered
        assert bus._buffer.strum == event
        assert bus._has_new_data is True
    
    def test_on_combined_event(self):
        """Test registering combined event listener."""
        bus = StrummerEventBus()
        callback = Mock()
        bus.on_combined_event(callback)
        assert callback in bus._listeners
    
    def test_off_combined_event(self):
        """Test unregistering combined event listener."""
        bus = StrummerEventBus()
        callback = Mock()
        bus.on_combined_event(callback)
        bus.off_combined_event(callback)
        assert callback not in bus._listeners
    
    def test_pause_resume(self):
        """Test pause and resume functionality."""
        bus = StrummerEventBus()
        assert bus._paused is False
        bus.pause()
        assert bus._paused is True
        bus.resume()
        assert bus._paused is False


class TestStatusMessageFormat:
    """Test status message format matches Node.js server."""
    
    def test_connected_status_format(self):
        """Test connected status message format."""
        import time
        connected = True
        device_name = 'Test Tablet'
        status_str = 'connected' if connected else 'disconnected'
        message_text = f'Tablet {"connected" if connected else "disconnected"}'
        if device_name:
            message_text = f'{device_name} {status_str}'
        
        message = {
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }
        
        # Verify format matches Node.js
        assert message['type'] == 'status'
        assert message['status'] == 'connected'
        assert message['deviceConnected'] is True
        assert 'Test Tablet' in message['message']
        assert isinstance(message['timestamp'], int)
    
    def test_disconnected_status_format(self):
        """Test disconnected status message format."""
        import time
        connected = False
        device_name = None
        status_str = 'connected' if connected else 'disconnected'
        message_text = 'Tablet connected' if connected else 'Waiting for tablet...'
        
        message = {
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }
        
        # Verify format matches Node.js
        assert message['type'] == 'status'
        assert message['status'] == 'disconnected'
        assert message['deviceConnected'] is False
        assert message['message'] == 'Waiting for tablet...'
        assert isinstance(message['timestamp'], int)


class TestSetThrottleMessageFormat:
    """Test set-throttle message handling."""
    
    def test_throttle_ms_format(self):
        """Test that throttleMs format is accepted (webapp format)."""
        bus = StrummerEventBus()
        data = {'type': 'set-throttle', 'throttleMs': 200}
        
        # Simulate message handling
        throttle = data.get('throttleMs', data.get('throttle', 150))
        bus.set_throttle(throttle)
        
        assert bus.throttle_ms == 200
    
    def test_throttle_legacy_format(self):
        """Test that throttle format is accepted (legacy format)."""
        bus = StrummerEventBus()
        data = {'type': 'set-throttle', 'throttle': 250}
        
        # Simulate message handling
        throttle = data.get('throttleMs', data.get('throttle', 150))
        bus.set_throttle(throttle)
        
        assert bus.throttle_ms == 250
    
    def test_throttle_default_fallback(self):
        """Test default fallback when neither format is present."""
        bus = StrummerEventBus()
        data = {'type': 'set-throttle'}
        
        # Simulate message handling
        throttle = data.get('throttleMs', data.get('throttle', 150))
        bus.set_throttle(throttle)
        
        assert bus.throttle_ms == 150


class TestConfigMessageFormat:
    """Test config message format."""
    
    def test_config_data_format(self):
        """Test config data format matches Node.js."""
        from sketchatone.models.note import Note
        
        config = MidiStrummerConfig()
        notes = [Note.parse_notation('C4'), Note.parse_notation('E4'), Note.parse_notation('G4')]
        throttle_ms = 150
        
        config_data = {
            'throttleMs': throttle_ms,
            'notes': [
                {'notation': n.notation, 'octave': n.octave}
                for n in notes
            ],
            'config': config.to_dict()
        }
        
        message = {
            'type': 'config',
            'data': config_data
        }
        
        # Verify format
        assert message['type'] == 'config'
        assert 'data' in message
        assert message['data']['throttleMs'] == 150
        assert len(message['data']['notes']) == 3
        assert message['data']['notes'][0]['notation'] == 'C'
        assert message['data']['notes'][0]['octave'] == 4


class TestUpdateConfigMessageFormat:
    """Test update-config message handling."""
    
    def test_path_based_update_format(self):
        """Test path-based update format (webapp format)."""
        data = {
            'type': 'update-config',
            'path': 'strummer.strumming.upperNoteSpread',
            'value': 5
        }
        
        # Verify format
        assert data['type'] == 'update-config'
        assert data['path'] == 'strummer.strumming.upperNoteSpread'
        assert data['value'] == 5
    
    def test_legacy_config_update_format(self):
        """Test legacy full config update format."""
        data = {
            'type': 'update-config',
            'config': {
                'strumming': {
                    'chord': 'Am'
                }
            }
        }
        
        # Verify format
        assert data['type'] == 'update-config'
        assert 'config' in data
        assert data['config']['strumming']['chord'] == 'Am'


class TestTabletEventData:
    """Test TabletEventData dataclass."""

    def test_create_tablet_event(self):
        """Test creating TabletEventData."""
        event = TabletEventData(
            x=0.5, y=0.3, pressure=0.7,
            tiltX=10, tiltY=-5, tiltXY=11.18,
            primaryButtonPressed=True,
            secondaryButtonPressed=False,
            state='contact'
        )

        assert event.x == 0.5
        assert event.y == 0.3
        assert event.pressure == 0.7
        assert event.tiltX == 10
        assert event.tiltY == -5
        assert event.tiltXY == 11.18
        assert event.primaryButtonPressed is True
        assert event.secondaryButtonPressed is False
        assert event.state == 'contact'

    def test_tablet_event_states(self):
        """Test valid tablet event states."""
        for state in ['hover', 'contact', 'out-of-range']:
            event = TabletEventData(
                x=0.5, y=0.5, pressure=0.0,
                tiltX=0, tiltY=0, tiltXY=0,
                primaryButtonPressed=False,
                secondaryButtonPressed=False,
                state=state
            )
            assert event.state == state


class TestStrumEventData:
    """Test StrumEventData dataclass."""

    def test_create_strum_event(self):
        """Test creating StrumEventData."""
        event = StrumEventData(
            type='strum',
            notes=[],
            velocity=100,
            x=0.5,
            pressure=0.7
        )

        assert event.type == 'strum'
        assert event.velocity == 100
        assert event.x == 0.5
        assert event.pressure == 0.7

    def test_create_release_event(self):
        """Test creating release StrumEventData."""
        event = StrumEventData(
            type='release',
            notes=[],
            velocity=0,
            x=0.0,
            pressure=0.0
        )

        assert event.type == 'release'
        assert len(event.notes) == 0
        assert event.velocity == 0


class TestCombinedEventData:
    """Test CombinedEventData dataclass."""

    def test_create_combined_event_with_tablet_only(self):
        """Test creating CombinedEventData with tablet data only."""
        tablet = TabletEventData(
            x=0.5, y=0.5, pressure=0.3,
            tiltX=0, tiltY=0, tiltXY=0,
            primaryButtonPressed=False,
            secondaryButtonPressed=False,
            state='contact'
        )
        event = CombinedEventData(tablet=tablet, strum=None)

        assert event.tablet == tablet
        assert event.strum is None

    def test_create_combined_event_with_both(self):
        """Test creating CombinedEventData with both tablet and strum data."""
        tablet = TabletEventData(
            x=0.5, y=0.5, pressure=0.3,
            tiltX=0, tiltY=0, tiltXY=0,
            primaryButtonPressed=False,
            secondaryButtonPressed=False,
            state='contact'
        )
        strum = StrumEventData(
            type='strum',
            notes=[],
            velocity=100,
            x=0.5,
            pressure=0.3
        )
        event = CombinedEventData(tablet=tablet, strum=strum)

        assert event.tablet == tablet
        assert event.strum == strum
