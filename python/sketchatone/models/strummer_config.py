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
from .strummer_features import StrumReleaseConfig
from .action_rules import ActionRulesConfig


@dataclass
class StrummingConfig:
    """
    Core strumming configuration.

    Attributes:
        pluck_velocity_scale: Scale factor for pluck velocity calculation
        pressure_threshold: Minimum pressure to trigger a strum (0-1)
        midi_channel: MIDI channel (stored internally as 0-15, but 1-16 in config files and CLI, None for omni)
        initial_notes: List of note strings for the strum (e.g., ["C4", "E4", "G4"])
        chord: Optional chord notation (e.g., "Am", "Gmaj7")
        upper_note_spread: Number of notes to add above the chord
        lower_note_spread: Number of notes to add below the chord
        invert_x: Invert X axis for left-handed use (flips which notes are on which side)
    """
    pluck_velocity_scale: float = 4.0
    pressure_threshold: float = 0.1
    midi_channel: Optional[int] = None
    initial_notes: List[str] = field(default_factory=lambda: ["C4", "E4", "G4"])
    chord: Optional[str] = None
    upper_note_spread: int = 3
    lower_note_spread: int = 3
    invert_x: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrummingConfig':
        """Create from dictionary (supports both snake_case and camelCase)

        Note: Converts MIDI channel from 1-16 (user-facing in config files) to 0-15 (internal).
        """
        # Get channel from config (1-16) and convert to internal (0-15)
        channel_from_config = data.get('midi_channel', data.get('midiChannel'))
        midi_channel = None
        if channel_from_config is not None:
            midi_channel = channel_from_config - 1  # Convert 1-16 to 0-15

        return cls(
            pluck_velocity_scale=data.get('pluck_velocity_scale', data.get('pluckVelocityScale', 4.0)),
            pressure_threshold=data.get('pressure_threshold', data.get('pressureThreshold', 0.1)),
            midi_channel=midi_channel,
            initial_notes=data.get('initial_notes', data.get('initialNotes', ["C4", "E4", "G4"])),
            chord=data.get('chord'),
            upper_note_spread=data.get('upper_note_spread', data.get('upperNoteSpread', 3)),
            lower_note_spread=data.get('lower_note_spread', data.get('lowerNoteSpread', 3)),
            invert_x=data.get('invert_x', data.get('invertX', False))
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)

        Note: Converts MIDI channel from 0-15 (internal) to 1-16 (user-facing in config files).
        """
        # Convert channel from internal (0-15) to config file format (1-16)
        midi_channel_for_config = None
        if self.midi_channel is not None:
            midi_channel_for_config = self.midi_channel + 1  # Convert 0-15 to 1-16

        return {
            'pluckVelocityScale': self.pluck_velocity_scale,
            'pressureThreshold': self.pressure_threshold,
            'midiChannel': midi_channel_for_config,
            'initialNotes': self.initial_notes,
            'chord': self.chord,
            'upperNoteSpread': self.upper_note_spread,
            'lowerNoteSpread': self.lower_note_spread,
            'invertX': self.invert_x
        }


@dataclass
class StrummerConfig:
    """
    Full configuration for the strummer.

    This follows the midi-strummer configuration format with:
    - Parameter mappings for note duration, pitch bend, and velocity
    - Core strumming settings
    - Optional features (strum release)
    - Action rules for button-to-action mapping

    Note: Repeater and transpose state is now managed by the Actions class,
    not by config. Use action rules to configure these features.

    Attributes:
        note_duration: Parameter mapping for note duration
        pitch_bend: Parameter mapping for pitch bend
        note_velocity: Parameter mapping for note velocity
        strumming: Core strumming configuration
        strum_release: Strum release feature configuration
        action_rules: Action rules for button-to-action mapping
    """
    note_duration: ParameterMapping = field(default_factory=default_note_duration)
    pitch_bend: ParameterMapping = field(default_factory=default_pitch_bend)
    note_velocity: ParameterMapping = field(default_factory=default_note_velocity)
    strumming: StrummingConfig = field(default_factory=StrummingConfig)
    strum_release: StrumReleaseConfig = field(default_factory=StrumReleaseConfig)
    action_rules: ActionRulesConfig = field(default_factory=ActionRulesConfig)

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
        Note: note_repeater and transpose fields are ignored as they are now managed by Actions.
        """
        note_duration_data = data.get('note_duration', data.get('noteDuration', {}))
        pitch_bend_data = data.get('pitch_bend', data.get('pitchBend', {}))
        note_velocity_data = data.get('note_velocity', data.get('noteVelocity', {}))
        strumming_data = data.get('strumming', {})
        strum_release_data = data.get('strum_release', data.get('strumRelease', {}))
        action_rules_data = data.get('action_rules', data.get('actionRules', {}))

        return cls(
            note_duration=ParameterMapping.from_dict(note_duration_data) if note_duration_data else default_note_duration(),
            pitch_bend=ParameterMapping.from_dict(pitch_bend_data) if pitch_bend_data else default_pitch_bend(),
            note_velocity=ParameterMapping.from_dict(note_velocity_data) if note_velocity_data else default_note_velocity(),
            strumming=StrummingConfig.from_dict(strumming_data) if strumming_data else StrummingConfig(),
            strum_release=StrumReleaseConfig.from_dict(strum_release_data) if strum_release_data else StrumReleaseConfig(),
            action_rules=ActionRulesConfig.from_dict(action_rules_data) if action_rules_data else ActionRulesConfig()
        )

    @classmethod
    def from_json_file(cls, path: str) -> 'StrummerConfig':
        """Load a StrummerConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp compatibility)"""
        return {
            'noteDuration': self.note_duration.to_dict(),
            'pitchBend': self.pitch_bend.to_dict(),
            'noteVelocity': self.note_velocity.to_dict(),
            'strumming': self.strumming.to_dict(),
            'strumRelease': self.strum_release.to_dict(),
            'actionRules': self.action_rules.to_dict()
        }

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)