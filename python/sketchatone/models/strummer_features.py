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
CHORD_PROGRESSION_PRESETS: Dict[str, List[str]] = {
    'c-major-pop': ['C', 'G', 'Am', 'F'],           # I-V-vi-IV
    'c-major-50s': ['C', 'Am', 'F', 'G'],           # I-vi-IV-V
    'c-major-axis': ['Am', 'F', 'C', 'G'],          # vi-IV-I-V
    'c-major-royal': ['F', 'C', 'G', 'Am'],         # IV-I-V-vi
    'a-minor-pop': ['Am', 'F', 'C', 'G'],           # i-VI-III-VII
    'a-minor-andalusian': ['Am', 'G', 'F', 'E'],    # i-VII-VI-V
    'g-major-country': ['G', 'C', 'D', 'G'],        # I-IV-V-I
    'd-major-folk': ['D', 'G', 'A', 'D'],           # I-IV-V-I
    'e-minor-rock': ['Em', 'C', 'G', 'D'],          # i-VI-III-VII
    'blues-12bar': ['C7', 'C7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'G7'],
}


def get_chord_progression_preset_names() -> List[str]:
    """Get list of available chord progression preset names"""
    return list(CHORD_PROGRESSION_PRESETS.keys())


@dataclass
class TabletButtonsConfig:
    """
    Configuration for tablet buttons.
    Supports two modes:
    1. Chord progression mode - buttons map to chords in a progression
    2. Individual button mode - each button has its own action
    """
    mode: Literal['progression', 'individual'] = 'progression'
    preset: str = 'c-major-pop'
    chords: List[str] = field(default_factory=lambda: ['C', 'G', 'Am', 'F'])
    current_index: int = 0
    octave: int = 4
    button_actions: Dict[str, ButtonAction] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Any) -> 'TabletButtonsConfig':
        """
        Create from dictionary, preset string, or individual button actions.
        Supports multiple formats:
        - String: "c-major-pop" (preset name for progression mode)
        - Object with preset/chords: { preset: "c-major-pop", chords: [...] }
        - Object with button actions: { "1": "toggle-repeater", "2": ["transpose", 12] }
        """
        if data is None:
            return cls()

        # Support string preset format (e.g., "c-major-pop")
        if isinstance(data, str):
            preset = data
            chords = CHORD_PROGRESSION_PRESETS.get(preset, ['C', 'G', 'Am', 'F'])
            return cls(mode='progression', preset=preset, chords=list(chords), current_index=0)

        # Check if this is individual button actions format (has keys "1" through "8")
        button_keys = ['1', '2', '3', '4', '5', '6', '7', '8']
        has_button_keys = any(key in data for key in button_keys)
        has_preset_or_chords = 'preset' in data or 'chords' in data or 'mode' in data

        if has_button_keys and not has_preset_or_chords:
            # Individual button actions format
            button_actions = {}
            for key in button_keys:
                if key in data:
                    button_actions[key] = data[key]
            return cls(mode='individual', button_actions=button_actions)

        # Full object format with preset/chords
        mode = data.get('mode', 'progression')
        preset = data.get('preset', 'c-major-pop')
        chords = data.get('chords')
        if chords is None:
            chords = CHORD_PROGRESSION_PRESETS.get(preset, ['C', 'G', 'Am', 'F'])

        return cls(
            mode=mode,
            preset=preset,
            chords=list(chords),
            current_index=data.get('current_index', data.get('currentIndex', 0)),
            octave=data.get('octave', 4),
            button_actions=data.get('button_actions', data.get('buttonActions', {}))
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'mode': self.mode,
            'preset': self.preset,
            'chords': self.chords,
            'currentIndex': self.current_index,
            'octave': self.octave,
            'buttonActions': self.button_actions
        }

    def get_button_action(self, button_number: int) -> ButtonAction:
        """
        Get the action for a specific button (1-8).
        In progression mode, returns set-strum-chord action for the corresponding chord.
        In individual mode, returns the configured action.
        """
        if button_number < 1 or button_number > 8:
            return None

        if self.mode == 'individual':
            return self.button_actions.get(str(button_number))

        # Progression mode - map button to chord
        chord_index = (button_number - 1) % len(self.chords) if self.chords else 0
        if self.chords and chord_index < len(self.chords):
            chord = self.chords[chord_index]
            return ['set-strum-chord', chord, self.octave]
        return None

    def get_current_chord(self) -> str:
        """Get the current chord in the progression"""
        if not self.chords:
            return 'C'
        return self.chords[self.current_index % len(self.chords)]

    def next_chord(self) -> str:
        """Move to next chord and return it"""
        if self.chords:
            self.current_index = (self.current_index + 1) % len(self.chords)
        return self.get_current_chord()

    def prev_chord(self) -> str:
        """Move to previous chord and return it"""
        if self.chords:
            self.current_index = (self.current_index - 1) % len(self.chords)
        return self.get_current_chord()

    def set_chord_by_button(self, button_number: int) -> str:
        """Set chord by button number (1-indexed) and return it"""
        if self.chords and button_number > 0:
            self.current_index = (button_number - 1) % len(self.chords)
        return self.get_current_chord()
