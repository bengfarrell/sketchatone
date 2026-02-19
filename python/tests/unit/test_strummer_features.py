"""
Tests for strummer feature config models.

Note: NoteRepeaterConfig and TransposeConfig have been removed.
Repeater and transpose state is now managed by the Actions class.
"""

import pytest
from sketchatone.models.strummer_features import StrumReleaseConfig


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
