"""
Strummer Feature Config Models

Configuration models for optional strummer features.
Based on midi-strummer's feature configuration system.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Literal, List


# Stylus button actions (string-only for type hints)
StylusButtonAction = Literal[
    "toggle-transpose",
    "toggle-repeater",
    "momentary-transpose",
    "momentary-repeater",
    "octave-up",
    "octave-down",
    "none"
]

# General button action - can be a string, list with params, or None
# Examples: "toggle-repeater", ["transpose", 12], ["set-strum-chord", "C", 4]
from typing import Union
ButtonAction = Union[str, List[Any], None]


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
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'active': self.active,
            'pressureMultiplier': self.pressure_multiplier,
            'frequencyMultiplier': self.frequency_multiplier
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
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'active': self.active,
            'primaryButtonAction': self.primary_button_action,
            'secondaryButtonAction': self.secondary_button_action
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
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'active': self.active,
            'midiNote': self.midi_note,
            'midiChannel': self.midi_channel,
            'maxDuration': self.max_duration,
            'velocityMultiplier': self.velocity_multiplier
        }



# Chord progression presets for tablet buttons
# Based on midi-strummer's chord_progressions.json
CHORD_PROGRESSION_PRESETS: Dict[str, List[str]] = {
    # Major key progressions
    'c-major-basic': ['C', 'F', 'G', 'Am'],
    'c-major-pop': ['C', 'G', 'Am', 'F'],           # I-V-vi-IV
    'c-major-jazz': ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7'],
    'c-major-50s': ['C', 'Am', 'F', 'G'],           # I-vi-IV-V
    'g-major-basic': ['G', 'C', 'D', 'Em'],
    'g-major-pop': ['G', 'D', 'Em', 'C'],           # I-V-vi-IV in G
    'g-major-jazz': ['Gmaj7', 'Am7', 'Bm7', 'Cmaj7', 'D7', 'Em7', 'F#m7'],
    'd-major-basic': ['D', 'G', 'A', 'Bm'],
    'd-major-pop': ['D', 'A', 'Bm', 'G'],           # I-V-vi-IV in D
    'd-major-jazz': ['Dmaj7', 'Em7', 'F#m7', 'Gmaj7', 'A7', 'Bm7', 'C#m7'],
    'a-major-basic': ['A', 'D', 'E', 'F#m'],
    'a-major-pop': ['A', 'E', 'F#m', 'D'],          # I-V-vi-IV in A
    'e-major-basic': ['E', 'A', 'B', 'C#m'],
    'e-major-pop': ['E', 'B', 'C#m', 'A'],          # I-V-vi-IV in E
    'f-major-basic': ['F', 'Bb', 'C', 'Dm'],
    'f-major-pop': ['F', 'C', 'Dm', 'Bb'],          # I-V-vi-IV in F

    # Minor key progressions
    'a-minor-basic': ['Am', 'Dm', 'Em', 'F', 'E'],
    'a-minor-pop': ['Am', 'F', 'C', 'G', 'E'],      # i-VI-III-VII
    'a-minor-sad': ['Am', 'Em', 'F', 'C', 'G', 'Dm', 'E'],
    'e-minor-basic': ['Em', 'Am', 'Bm', 'C', 'B'],
    'e-minor-pop': ['Em', 'C', 'G', 'D', 'B'],      # i-VI-III-VII in Em
    'd-minor-basic': ['Dm', 'Gm', 'Am', 'Bb', 'A'],
    'd-minor-pop': ['Dm', 'Bb', 'F', 'C', 'A'],     # i-VI-III-VII in Dm

    # Blues progressions
    'blues-e': ['E7', 'A7', 'B7'],
    'blues-a': ['A7', 'D7', 'E7'],
    'blues-g': ['G7', 'C7', 'D7'],

    # Rock progressions
    'rock-classic': ['E', 'A', 'D', 'B'],
    'rock-power': ['E5', 'G5', 'A5', 'C5', 'D5'],

    # Jazz progressions
    'jazz-251-c': ['Dm7', 'G7', 'Cmaj7', 'Em7', 'A7'],
    'jazz-251-f': ['Gm7', 'C7', 'Fmaj7', 'Am7', 'D7'],

    # Gospel progressions
    'gospel-c': ['C', 'Am7', 'Dm7', 'G7', 'F'],
    'gospel-g': ['G', 'Em7', 'Am7', 'D7', 'C'],
}


def get_chord_progression_preset_names() -> List[str]:
    """Get list of available chord progression preset names"""
    return list(CHORD_PROGRESSION_PRESETS.keys())
