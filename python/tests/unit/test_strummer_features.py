"""
Tests for strummer feature config models.
"""

import pytest
from sketchatone.models.strummer_features import (
    NoteRepeaterConfig,
    TransposeConfig,
    StylusButtonsConfig,
    StrumReleaseConfig
)


class TestNoteRepeaterConfig:
    """Test NoteRepeaterConfig model."""
    
    def test_default_values(self):
        """Test default values."""
        config = NoteRepeaterConfig()
        assert config.active is False
        assert config.pressure_multiplier == 1.0
        assert config.frequency_multiplier == 1.0
    
    def test_from_dict_snake_case(self):
        """Test creating from snake_case dictionary."""
        data = {
            'active': True,
            'pressure_multiplier': 2.0,
            'frequency_multiplier': 0.5
        }
        config = NoteRepeaterConfig.from_dict(data)
        assert config.active is True
        assert config.pressure_multiplier == 2.0
        assert config.frequency_multiplier == 0.5
    
    def test_from_dict_camel_case(self):
        """Test creating from camelCase dictionary."""
        data = {
            'active': True,
            'pressureMultiplier': 2.0,
            'frequencyMultiplier': 0.5
        }
        config = NoteRepeaterConfig.from_dict(data)
        assert config.active is True
        assert config.pressure_multiplier == 2.0
        assert config.frequency_multiplier == 0.5
    
    def test_to_dict(self):
        """Test converting to dictionary (camelCase for webapp)."""
        config = NoteRepeaterConfig(
            active=True,
            pressure_multiplier=1.5,
            frequency_multiplier=2.0
        )
        d = config.to_dict()
        assert d['active'] is True
        assert d['pressureMultiplier'] == 1.5
        assert d['frequencyMultiplier'] == 2.0

    def test_roundtrip(self):
        """Test dict -> config -> dict roundtrip (input snake_case, output camelCase)."""
        original = {
            'active': True,
            'pressure_multiplier': 1.5,
            'frequency_multiplier': 2.0
        }
        config = NoteRepeaterConfig.from_dict(original)
        result = config.to_dict()
        # Output is camelCase for webapp compatibility
        assert result == {
            'active': True,
            'pressureMultiplier': 1.5,
            'frequencyMultiplier': 2.0
        }


class TestTransposeConfig:
    """Test TransposeConfig model."""
    
    def test_default_values(self):
        """Test default values."""
        config = TransposeConfig()
        assert config.active is False
        assert config.semitones == 12
    
    def test_from_dict(self):
        """Test creating from dictionary."""
        data = {
            'active': True,
            'semitones': -7
        }
        config = TransposeConfig.from_dict(data)
        assert config.active is True
        assert config.semitones == -7
    
    def test_to_dict(self):
        """Test converting to dictionary."""
        config = TransposeConfig(active=True, semitones=5)
        d = config.to_dict()
        assert d['active'] is True
        assert d['semitones'] == 5
    
    def test_roundtrip(self):
        """Test dict -> config -> dict roundtrip."""
        original = {'active': True, 'semitones': -12}
        config = TransposeConfig.from_dict(original)
        result = config.to_dict()
        assert result == original


class TestStylusButtonsConfig:
    """Test StylusButtonsConfig model."""
    
    def test_default_values(self):
        """Test default values."""
        config = StylusButtonsConfig()
        assert config.active is True
        assert config.primary_button_action == "toggle-transpose"
        assert config.secondary_button_action == "toggle-repeater"
    
    def test_from_dict_snake_case(self):
        """Test creating from snake_case dictionary."""
        data = {
            'active': False,
            'primary_button_action': 'octave-up',
            'secondary_button_action': 'octave-down'
        }
        config = StylusButtonsConfig.from_dict(data)
        assert config.active is False
        assert config.primary_button_action == 'octave-up'
        assert config.secondary_button_action == 'octave-down'
    
    def test_from_dict_camel_case(self):
        """Test creating from camelCase dictionary."""
        data = {
            'active': True,
            'primaryButtonAction': 'momentary-transpose',
            'secondaryButtonAction': 'momentary-repeater'
        }
        config = StylusButtonsConfig.from_dict(data)
        assert config.active is True
        assert config.primary_button_action == 'momentary-transpose'
        assert config.secondary_button_action == 'momentary-repeater'
    
    def test_to_dict(self):
        """Test converting to dictionary (camelCase for webapp)."""
        config = StylusButtonsConfig(
            active=True,
            primary_button_action='none',
            secondary_button_action='toggle-transpose'
        )
        d = config.to_dict()
        assert d['active'] is True
        assert d['primaryButtonAction'] == 'none'
        assert d['secondaryButtonAction'] == 'toggle-transpose'

    def test_roundtrip(self):
        """Test dict -> config -> dict roundtrip (input snake_case, output camelCase)."""
        original = {
            'active': False,
            'primary_button_action': 'octave-up',
            'secondary_button_action': 'none'
        }
        config = StylusButtonsConfig.from_dict(original)
        result = config.to_dict()
        # Output is camelCase for webapp compatibility
        assert result == {
            'active': False,
            'primaryButtonAction': 'octave-up',
            'secondaryButtonAction': 'none'
        }


class TestStrumReleaseConfig:
    """Test StrumReleaseConfig model."""
    
    def test_default_values(self):
        """Test default values."""
        config = StrumReleaseConfig()
        assert config.active is False
        assert config.midi_note == 38
        assert config.midi_channel is None
        assert config.max_duration == 0.25
        assert config.velocity_multiplier == 1.0
    
    def test_from_dict_snake_case(self):
        """Test creating from snake_case dictionary."""
        data = {
            'active': True,
            'midi_note': 42,
            'midi_channel': 9,
            'max_duration': 0.5,
            'velocity_multiplier': 0.8
        }
        config = StrumReleaseConfig.from_dict(data)
        assert config.active is True
        assert config.midi_note == 42
        assert config.midi_channel == 9
        assert config.max_duration == 0.5
        assert config.velocity_multiplier == 0.8
    
    def test_from_dict_camel_case(self):
        """Test creating from camelCase dictionary."""
        data = {
            'active': True,
            'midiNote': 36,
            'midiChannel': 10,
            'maxDuration': 0.1,
            'velocityMultiplier': 1.2
        }
        config = StrumReleaseConfig.from_dict(data)
        assert config.active is True
        assert config.midi_note == 36
        assert config.midi_channel == 10
        assert config.max_duration == 0.1
        assert config.velocity_multiplier == 1.2
    
    def test_to_dict(self):
        """Test converting to dictionary (camelCase for webapp)."""
        config = StrumReleaseConfig(
            active=True,
            midi_note=40,
            midi_channel=5,
            max_duration=0.3,
            velocity_multiplier=0.9
        )
        d = config.to_dict()
        assert d['active'] is True
        assert d['midiNote'] == 40
        assert d['midiChannel'] == 5
        assert d['maxDuration'] == 0.3
        assert d['velocityMultiplier'] == 0.9

    def test_roundtrip(self):
        """Test dict -> config -> dict roundtrip (input snake_case, output camelCase)."""
        original = {
            'active': True,
            'midi_note': 38,
            'midi_channel': None,
            'max_duration': 0.25,
            'velocity_multiplier': 1.0
        }
        config = StrumReleaseConfig.from_dict(original)
        result = config.to_dict()
        # Output is camelCase for webapp compatibility
        assert result == {
            'active': True,
            'midiNote': 38,
            'midiChannel': None,
            'maxDuration': 0.25,
            'velocityMultiplier': 1.0
        }
