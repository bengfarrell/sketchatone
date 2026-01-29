"""
Tests for MidiStrummerConfig model.
"""

import pytest
import json
import tempfile
import os
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
from sketchatone.models.strummer_config import StrummerConfig
from sketchatone.models.midi_config import MidiConfig


class TestMidiStrummerConfigBasic:
    """Test basic MidiStrummerConfig functionality."""
    
    def test_default_values(self):
        """Test default values."""
        config = MidiStrummerConfig()
        # Strummer defaults
        assert config.strummer.strumming.pressure_threshold == 0.1
        assert config.strummer.note_duration.control == 'tiltXY'
        # MIDI defaults
        assert config.midi.midi_output_backend == 'rtmidi'
        assert config.midi.jack_client_name == 'sketchatone'
    
    def test_from_separate_configs(self):
        """Test creating from separate configs."""
        strummer = StrummerConfig()
        strummer.strumming.chord = 'Am'
        
        midi = MidiConfig()
        midi.midi_output_backend = 'jack'
        midi.jack_client_name = 'test_client'
        
        config = MidiStrummerConfig.from_separate_configs(strummer, midi)
        assert config.strummer.strumming.chord == 'Am'
        assert config.midi.midi_output_backend == 'jack'
        assert config.midi.jack_client_name == 'test_client'
    
    def test_to_strummer_config(self):
        """Test extracting strummer config."""
        config = MidiStrummerConfig()
        config.strummer.strumming.chord = 'Dm'
        
        strummer = config.to_strummer_config()
        assert strummer.strumming.chord == 'Dm'
    
    def test_to_midi_config(self):
        """Test extracting MIDI config."""
        config = MidiStrummerConfig()
        config.midi.midi_output_backend = 'jack'
        
        midi = config.to_midi_config()
        assert midi.midi_output_backend == 'jack'


class TestMidiStrummerConfigNewFormat:
    """Test MidiStrummerConfig with new format."""
    
    def test_from_dict_new_format(self):
        """Test creating from new format dictionary."""
        data = {
            'note_duration': {
                'min': 0.1,
                'max': 2.0,
                'control': 'tiltXY'
            },
            'strumming': {
                'chord': 'Em',
                'pressure_threshold': 0.15
            },
            'transpose': {
                'active': True,
                'semitones': 12
            },
            'midi': {
                'midi_output_backend': 'jack',
                'jack_client_name': 'my_strummer'
            }
        }
        config = MidiStrummerConfig.from_dict(data)
        assert config.strummer.note_duration.min == 0.1
        assert config.strummer.strumming.chord == 'Em'
        assert config.strummer.transpose.active is True
        assert config.midi.midi_output_backend == 'jack'
        assert config.midi.jack_client_name == 'my_strummer'
    
    def test_to_dict(self):
        """Test converting to dictionary (nested structure matching Node.js)."""
        config = MidiStrummerConfig()
        config.strummer.strumming.chord = 'G'
        config.midi.midi_output_backend = 'jack'

        d = config.to_dict()
        # Should have nested structure: {strummer: {...}, midi: {...}, server: {...}}
        assert 'strummer' in d
        assert 'midi' in d
        assert 'server' in d
        assert 'noteDuration' in d['strummer']
        assert 'strumming' in d['strummer']
        assert d['strummer']['strumming']['chord'] == 'G'
        assert d['midi']['midiOutputBackend'] == 'jack'


class TestMidiStrummerConfigBackwardCompatibility:
    """Test backward compatibility properties."""
    
    def test_strummer_properties(self):
        """Test strummer-related properties."""
        config = MidiStrummerConfig()
        config.strummer.strumming.pressure_threshold = 0.25
        config.strummer.strumming.pluck_velocity_scale = 3.0
        config.strummer.strumming.initial_notes = ['A3', 'C4', 'E4']
        config.strummer.strumming.chord = 'Am'
        config.strummer.strumming.lower_note_spread = 2
        config.strummer.strumming.upper_note_spread = 4
        config.strummer.strumming.midi_channel = 10
        
        assert config.pressure_threshold == 0.25
        assert config.velocity_scale == 3.0
        assert config.notes == ['A3', 'C4', 'E4']
        assert config.chord == 'Am'
        assert config.lower_spread == 2
        assert config.upper_spread == 4
        assert config.channel == 10
    
    def test_midi_properties(self):
        """Test MIDI-related properties."""
        config = MidiStrummerConfig()
        config.midi.midi_output_backend = 'jack'
        config.midi.midi_output_id = 'my_port'
        config.midi.midi_input_id = 'input_port'
        config.midi.jack_client_name = 'test_client'
        config.midi.jack_auto_connect = 'chain1'
        config.midi.note_duration = 2.0
        
        assert config.midi_output_backend == 'jack'
        assert config.midi_output_id == 'my_port'
        assert config.midi_input_id == 'input_port'
        assert config.jack_client_name == 'test_client'
        assert config.jack_auto_connect == 'chain1'
        assert config.note_duration == 2.0


class TestMidiStrummerConfigFileIO:
    """Test file I/O operations."""
    
    def test_from_json_file_new_format(self):
        """Test loading from JSON file (new format)."""
        data = {
            'strumming': {'chord': 'Bm'},
            'midi': {'midi_output_backend': 'jack'}
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(data, f)
            temp_path = f.name
        
        try:
            config = MidiStrummerConfig.from_json_file(temp_path)
            assert config.strummer.strumming.chord == 'Bm'
            assert config.midi.midi_output_backend == 'jack'
        finally:
            os.unlink(temp_path)
    
    def test_to_json_file(self):
        """Test saving to JSON file (nested structure)."""
        config = MidiStrummerConfig()
        config.strummer.strumming.chord = 'D'
        config.midi.midi_output_backend = 'jack'

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name

        try:
            config.to_json_file(temp_path)
            with open(temp_path, 'r') as f:
                data = json.load(f)
            assert data['strummer']['strumming']['chord'] == 'D'
            assert data['midi']['midiOutputBackend'] == 'jack'
        finally:
            os.unlink(temp_path)


class TestMidiStrummerConfigRoundtrip:
    """Test roundtrip serialization."""
    
    def test_roundtrip_new_format(self):
        """Test dict -> config -> dict roundtrip (input snake_case, output camelCase)."""
        original = {
            'note_duration': {
                'min': 0.15,
                'max': 1.5,
                'multiplier': 1.0,
                'curve': 1.0,
                'spread': 'inverse',
                'control': 'tiltXY',
                'default': 1.0
            },
            'pitch_bend': {
                'min': -1.0,
                'max': 1.0,
                'multiplier': 1.0,
                'curve': 4.0,
                'spread': 'central',
                'control': 'yaxis',
                'default': 0.0
            },
            'note_velocity': {
                'min': 0,
                'max': 127,
                'multiplier': 1.0,
                'curve': 4.0,
                'spread': 'direct',
                'control': 'pressure',
                'default': 64
            },
            'strumming': {
                'pluck_velocity_scale': 4.0,
                'pressure_threshold': 0.1,
                'midi_channel': None,
                'initial_notes': ['C4', 'E4', 'G4'],
                'chord': 'Am',
                'upper_note_spread': 3,
                'lower_note_spread': 3
            },
            'note_repeater': {
                'active': False,
                'pressure_multiplier': 1.0,
                'frequency_multiplier': 1.0
            },
            'transpose': {
                'active': False,
                'semitones': 12
            },
            'stylus_buttons': {
                'active': True,
                'primary_button_action': 'toggle-transpose',
                'secondary_button_action': 'toggle-repeater'
            },
            'strum_release': {
                'active': False,
                'midi_note': 38,
                'midi_channel': None,
                'max_duration': 0.25,
                'velocity_multiplier': 1.0
            },
            'midi': {
                'midi_output_backend': 'rtmidi',
                'midi_output_id': None,
                'midi_input_id': None,
                'jack_client_name': 'sketchatone',
                'jack_auto_connect': 'chain0',
                'note_duration': 1.5
            }
        }

        config = MidiStrummerConfig.from_dict(original)
        result = config.to_dict()

        # Output has nested structure: {strummer: {...}, midi: {...}, server: {...}}
        # Check key sections match (using camelCase keys in output)
        assert result['strummer']['strumming']['chord'] == original['strumming']['chord']
        assert result['strummer']['noteDuration']['control'] == original['note_duration']['control']
        assert result['midi']['midiOutputBackend'] == original['midi']['midi_output_backend']