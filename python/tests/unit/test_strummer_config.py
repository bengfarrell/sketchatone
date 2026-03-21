"""
Tests for StrummerConfig and StrummingConfig models.
"""

import pytest
import json
import tempfile
import os
from sketchatone.models.strummer_config import StrummerConfig, StrummingConfig
from sketchatone.models.parameter_mapping import ParameterMapping


class TestStrummingConfig:
    """Test StrummingConfig model."""

    def test_default_values(self):
        """Test default values."""
        config = StrummingConfig()
        assert config.pressure_threshold == 0.1
        assert config.midi_channel is None
        assert config.initial_notes == ["C4", "E4", "G4"]
        assert config.chord is None
        assert config.upper_note_spread == 3
        assert config.lower_note_spread == 3

    def test_from_dict_snake_case(self):
        """Test creating from snake_case dictionary."""
        data = {
            'pressure_threshold': 0.2,
            'midi_channel': 5,  # Config file uses 1-16
            'initial_notes': ['A3', 'C4', 'E4'],
            'chord': 'Am',
            'upper_note_spread': 2,
            'lower_note_spread': 1
        }
        config = StrummingConfig.from_dict(data)
        assert config.pressure_threshold == 0.2
        assert config.midi_channel == 4  # Internally stored as 0-15 (5 - 1 = 4)
        assert config.initial_notes == ['A3', 'C4', 'E4']
        assert config.chord == 'Am'
        assert config.upper_note_spread == 2
        assert config.lower_note_spread == 1

    def test_from_dict_camel_case(self):
        """Test creating from camelCase dictionary."""
        data = {
            'pressureThreshold': 0.15,
            'midiChannel': 10,  # Config file uses 1-16
            'initialNotes': ['G3', 'B3', 'D4'],
            'chord': 'G',
            'upperNoteSpread': 4,
            'lowerNoteSpread': 2
        }
        config = StrummingConfig.from_dict(data)
        assert config.pressure_threshold == 0.15
        assert config.midi_channel == 9  # Internally stored as 0-15 (10 - 1 = 9)
        assert config.initial_notes == ['G3', 'B3', 'D4']
        assert config.chord == 'G'
        assert config.upper_note_spread == 4
        assert config.lower_note_spread == 2

    def test_to_dict(self):
        """Test converting to dictionary (camelCase for webapp)."""
        config = StrummingConfig(
            pressure_threshold=0.05,
            midi_channel=1,  # Internal value is 0-15
            initial_notes=['C3'],
            chord='C',
            upper_note_spread=5,
            lower_note_spread=5
        )
        d = config.to_dict()
        assert d['pressureThreshold'] == 0.05
        assert d['midiChannel'] == 2  # Exported as 1-16 (1 + 1 = 2)
        assert d['initialNotes'] == ['C3']
        assert d['chord'] == 'C'
        assert d['upperNoteSpread'] == 5
        assert d['lowerNoteSpread'] == 5


class TestStrummerConfigNewFormat:
    """Test StrummerConfig with new nested format."""

    def test_default_values(self):
        """Test default values."""
        config = StrummerConfig()
        # Check parameter mappings have defaults
        assert config.note_duration.control == 'tiltXY'
        assert config.pitch_bend.control == 'yaxis'
        assert config.note_velocity.control == 'pressure'
        # Check strumming defaults
        assert config.strumming.pressure_threshold == 0.1
        # Check feature defaults (note: note_repeater and transpose are now managed by Actions)
        assert config.strum_release.active is False

    def test_from_dict_new_format(self):
        """Test creating from new nested format."""
        data = {
            'note_duration': {
                'min': 0.1,
                'max': 2.0,
                'control': 'tiltXY'
            },
            'pitch_bend': {
                'min': -2.0,
                'max': 2.0,
                'control': 'yaxis'
            },
            'note_velocity': {
                'min': 10,
                'max': 120,
                'control': 'pressure'
            },
            'strumming': {
                'chord': 'Dm',
                'pressure_threshold': 0.15
            }
        }
        config = StrummerConfig.from_dict(data)
        assert config.note_duration.min == 0.1
        assert config.note_duration.max == 2.0
        assert config.pitch_bend.min == -2.0
        assert config.note_velocity.max == 120
        assert config.strumming.chord == 'Dm'
        assert config.strumming.pressure_threshold == 0.15

    def test_to_dict(self):
        """Test converting to dictionary (camelCase for webapp)."""
        config = StrummerConfig()
        d = config.to_dict()
        assert 'noteDuration' in d
        assert 'pitchBend' in d
        assert 'noteVelocity' in d
        assert 'strumming' in d
        # Note: noteRepeater and transpose are no longer in config
        assert 'strumRelease' in d
        assert 'actionRules' in d


class TestStrummerConfigBackwardCompatibility:
    """Test backward compatibility properties."""

    def test_pressure_threshold_property(self):
        """Test pressure_threshold property."""
        config = StrummerConfig()
        config.strumming.pressure_threshold = 0.25
        assert config.pressure_threshold == 0.25

    def test_notes_property(self):
        """Test notes property."""
        config = StrummerConfig()
        config.strumming.initial_notes = ['A3', 'C4', 'E4']
        assert config.notes == ['A3', 'C4', 'E4']

    def test_chord_property(self):
        """Test chord property."""
        config = StrummerConfig()
        config.strumming.chord = 'Gmaj7'
        assert config.chord == 'Gmaj7'

    def test_spread_properties(self):
        """Test lower_spread and upper_spread properties."""
        config = StrummerConfig()
        config.strumming.lower_note_spread = 4
        config.strumming.upper_note_spread = 5
        assert config.lower_spread == 4
        assert config.upper_spread == 5

    def test_channel_property(self):
        """Test channel property."""
        config = StrummerConfig()
        config.strumming.midi_channel = 10
        assert config.channel == 10


class TestStrummerConfigFileIO:
    """Test file I/O operations."""

    def test_from_json_file_new_format(self):
        """Test loading from JSON file (new format)."""
        data = {
            'note_duration': {'control': 'tiltXY'},
            'strumming': {'chord': 'Em'}
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(data, f)
            temp_path = f.name

        try:
            config = StrummerConfig.from_json_file(temp_path)
            assert config.strumming.chord == 'Em'
            assert config.note_duration.control == 'tiltXY'
        finally:
            os.unlink(temp_path)

    def test_to_json_file(self):
        """Test saving to JSON file."""
        config = StrummerConfig()
        config.strumming.chord = 'Bm'

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name

        try:
            config.to_json_file(temp_path)
            with open(temp_path, 'r') as f:
                data = json.load(f)
            assert data['strumming']['chord'] == 'Bm'
        finally:
            os.unlink(temp_path)
