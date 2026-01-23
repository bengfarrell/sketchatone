"""
Strummer Config Model

Configuration model for strummer-specific settings.
Based on midi-strummer's configuration format.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import json
import os

from .parameter_mapping import ParameterMapping, default_note_duration, default_pitch_bend, default_note_velocity
from .strummer_features import (
    NoteRepeaterConfig,
    TransposeConfig,
    StylusButtonsConfig,
    StrumReleaseConfig
)


@dataclass
class StrummingConfig:
    """
    Core strumming configuration.

    Attributes:
        pluck_velocity_scale: Scale factor for pluck velocity calculation
        pressure_threshold: Minimum pressure to trigger a strum (0-1)
        midi_channel: MIDI channel (0-15, None for omni)
        initial_notes: List of note strings for the strum (e.g., ["C4", "E4", "G4"])
        chord: Optional chord notation (e.g., "Am", "Gmaj7")
        upper_note_spread: Number of notes to add above the chord
        lower_note_spread: Number of notes to add below the chord
    """
    pluck_velocity_scale: float = 4.0
    pressure_threshold: float = 0.1
    midi_channel: Optional[int] = None
    initial_notes: List[str] = field(default_factory=lambda: ["C4", "E4", "G4"])
    chord: Optional[str] = None
    upper_note_spread: int = 3
    lower_note_spread: int = 3

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrummingConfig':
        """Create from dictionary (supports both snake_case and camelCase)"""
        return cls(
            pluck_velocity_scale=data.get('pluck_velocity_scale', data.get('pluckVelocityScale', 4.0)),
            pressure_threshold=data.get('pressure_threshold', data.get('pressureThreshold', 0.1)),
            midi_channel=data.get('midi_channel', data.get('midiChannel')),
            initial_notes=data.get('initial_notes', data.get('initialNotes', ["C4", "E4", "G4"])),
            chord=data.get('chord'),
            upper_note_spread=data.get('upper_note_spread', data.get('upperNoteSpread', 3)),
            lower_note_spread=data.get('lower_note_spread', data.get('lowerNoteSpread', 3))
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'pluck_velocity_scale': self.pluck_velocity_scale,
            'pressure_threshold': self.pressure_threshold,
            'midi_channel': self.midi_channel,
            'initial_notes': self.initial_notes,
            'chord': self.chord,
            'upper_note_spread': self.upper_note_spread,
            'lower_note_spread': self.lower_note_spread
        }


@dataclass
class StrummerConfig:
    """
    Full configuration for the strummer.

    This follows the midi-strummer configuration format with:
    - Parameter mappings for note duration, pitch bend, and velocity
    - Core strumming settings
    - Optional features (repeater, transpose, stylus buttons, strum release)

    Attributes:
        note_duration: Parameter mapping for note duration
        pitch_bend: Parameter mapping for pitch bend
        note_velocity: Parameter mapping for note velocity
        strumming: Core strumming configuration
        note_repeater: Note repeater feature configuration
        transpose: Transpose feature configuration
        stylus_buttons: Stylus button configuration
        strum_release: Strum release feature configuration
    """
    note_duration: ParameterMapping = field(default_factory=default_note_duration)
    pitch_bend: ParameterMapping = field(default_factory=default_pitch_bend)
    note_velocity: ParameterMapping = field(default_factory=default_note_velocity)
    strumming: StrummingConfig = field(default_factory=StrummingConfig)
    note_repeater: NoteRepeaterConfig = field(default_factory=NoteRepeaterConfig)
    transpose: TransposeConfig = field(default_factory=TransposeConfig)
    stylus_buttons: StylusButtonsConfig = field(default_factory=StylusButtonsConfig)
    strum_release: StrumReleaseConfig = field(default_factory=StrumReleaseConfig)

    # Convenience properties for backward compatibility
    @property
    def pressure_threshold(self) -> float:
        return self.strumming.pressure_threshold

    @property
    def velocity_scale(self) -> float:
        return self.strumming.pluck_velocity_scale

    @property
    def notes(self) -> List[str]:
        return self.strumming.initial_notes

    @property
    def chord(self) -> Optional[str]:
        return self.strumming.chord

    @property
    def lower_spread(self) -> int:
        return self.strumming.lower_note_spread

    @property
    def upper_spread(self) -> int:
        return self.strumming.upper_note_spread

    @property
    def channel(self) -> Optional[int]:
        return self.strumming.midi_channel

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrummerConfig':
        """
        Create a StrummerConfig from a dictionary.
        """
        note_duration_data = data.get('note_duration', data.get('noteDuration', {}))
        pitch_bend_data = data.get('pitch_bend', data.get('pitchBend', {}))
        note_velocity_data = data.get('note_velocity', data.get('noteVelocity', {}))
        strumming_data = data.get('strumming', {})
        note_repeater_data = data.get('note_repeater', data.get('noteRepeater', {}))
        transpose_data = data.get('transpose', {})
        stylus_buttons_data = data.get('stylus_buttons', data.get('stylusButtons', {}))
        strum_release_data = data.get('strum_release', data.get('strumRelease', {}))

        return cls(
            note_duration=ParameterMapping.from_dict(note_duration_data) if note_duration_data else default_note_duration(),
            pitch_bend=ParameterMapping.from_dict(pitch_bend_data) if pitch_bend_data else default_pitch_bend(),
            note_velocity=ParameterMapping.from_dict(note_velocity_data) if note_velocity_data else default_note_velocity(),
            strumming=StrummingConfig.from_dict(strumming_data) if strumming_data else StrummingConfig(),
            note_repeater=NoteRepeaterConfig.from_dict(note_repeater_data) if note_repeater_data else NoteRepeaterConfig(),
            transpose=TransposeConfig.from_dict(transpose_data) if transpose_data else TransposeConfig(),
            stylus_buttons=StylusButtonsConfig.from_dict(stylus_buttons_data) if stylus_buttons_data else StylusButtonsConfig(),
            strum_release=StrumReleaseConfig.from_dict(strum_release_data) if strum_release_data else StrumReleaseConfig()
        )

    @classmethod
    def from_json_file(cls, path: str) -> 'StrummerConfig':
        """Load a StrummerConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (new format)"""
        return {
            'note_duration': self.note_duration.to_dict(),
            'pitch_bend': self.pitch_bend.to_dict(),
            'note_velocity': self.note_velocity.to_dict(),
            'strumming': self.strumming.to_dict(),
            'note_repeater': self.note_repeater.to_dict(),
            'transpose': self.transpose.to_dict(),
            'stylus_buttons': self.stylus_buttons.to_dict(),
            'strum_release': self.strum_release.to_dict()
        }

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)