"""
Strummer Feature Config Models

Configuration models for optional strummer features.
Based on midi-strummer's feature configuration system.
"""

from dataclasses import dataclass
from typing import Optional, Dict, Any, Literal


# Stylus button actions
ButtonAction = Literal[
    "toggle-transpose",
    "toggle-repeater",
    "momentary-transpose",
    "momentary-repeater",
    "octave-up",
    "octave-down",
    "none"
]


@dataclass
class NoteRepeaterConfig:
    """
    Configuration for the note repeater feature.
    
    When active, notes are repeated at a frequency controlled by pressure.
    
    Attributes:
        active: Whether the repeater is enabled
        pressure_multiplier: Scale factor for pressure-to-frequency mapping
        frequency_multiplier: Base frequency multiplier
    """
    active: bool = False
    pressure_multiplier: float = 1.0
    frequency_multiplier: float = 1.0
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'NoteRepeaterConfig':
        """Create from dictionary (supports both snake_case and camelCase)"""
        return cls(
            active=data.get('active', False),
            pressure_multiplier=data.get('pressure_multiplier', data.get('pressureMultiplier', 1.0)),
            frequency_multiplier=data.get('frequency_multiplier', data.get('frequencyMultiplier', 1.0))
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'active': self.active,
            'pressure_multiplier': self.pressure_multiplier,
            'frequency_multiplier': self.frequency_multiplier
        }


@dataclass
class TransposeConfig:
    """
    Configuration for the transpose feature.
    
    When active, all notes are transposed by the specified number of semitones.
    
    Attributes:
        active: Whether transpose is enabled
        semitones: Number of semitones to transpose (positive=up, negative=down)
    """
    active: bool = False
    semitones: int = 12
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TransposeConfig':
        """Create from dictionary"""
        return cls(
            active=data.get('active', False),
            semitones=data.get('semitones', 12)
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'active': self.active,
            'semitones': self.semitones
        }


@dataclass
class StylusButtonsConfig:
    """
    Configuration for stylus button actions.
    
    Maps the primary and secondary stylus buttons to actions.
    
    Attributes:
        active: Whether stylus button handling is enabled
        primary_button_action: Action for primary button
        secondary_button_action: Action for secondary button
    """
    active: bool = True
    primary_button_action: ButtonAction = "toggle-transpose"
    secondary_button_action: ButtonAction = "toggle-repeater"
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StylusButtonsConfig':
        """Create from dictionary (supports both snake_case and camelCase)"""
        return cls(
            active=data.get('active', True),
            primary_button_action=data.get('primary_button_action', data.get('primaryButtonAction', 'toggle-transpose')),
            secondary_button_action=data.get('secondary_button_action', data.get('secondaryButtonAction', 'toggle-repeater'))
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'active': self.active,
            'primary_button_action': self.primary_button_action,
            'secondary_button_action': self.secondary_button_action
        }


@dataclass
class StrumReleaseConfig:
    """
    Configuration for the strum release feature.
    
    When active, a release event triggers a specific MIDI note (e.g., for drum sounds).
    
    Attributes:
        active: Whether strum release is enabled
        midi_note: MIDI note number to send on release (e.g., 38 for snare)
        midi_channel: MIDI channel for release note (None = same as strummer)
        max_duration: Maximum duration of the release note in seconds
        velocity_multiplier: Scale factor for release velocity
    """
    active: bool = False
    midi_note: int = 38
    midi_channel: Optional[int] = None
    max_duration: float = 0.25
    velocity_multiplier: float = 1.0
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrumReleaseConfig':
        """Create from dictionary (supports both snake_case and camelCase)"""
        return cls(
            active=data.get('active', False),
            midi_note=data.get('midi_note', data.get('midiNote', 38)),
            midi_channel=data.get('midi_channel', data.get('midiChannel')),
            max_duration=data.get('max_duration', data.get('maxDuration', 0.25)),
            velocity_multiplier=data.get('velocity_multiplier', data.get('velocityMultiplier', 1.0))
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'active': self.active,
            'midi_note': self.midi_note,
            'midi_channel': self.midi_channel,
            'max_duration': self.max_duration,
            'velocity_multiplier': self.velocity_multiplier
        }
