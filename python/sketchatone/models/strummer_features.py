"""
Strummer Feature Config Models

Configuration models for optional strummer features.
Based on midi-strummer's feature configuration system.

Note: NoteRepeaterConfig and TransposeConfig have been removed.
Repeater and transpose state is now managed by the Actions class.
Use action rules to configure these features.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Union


# General button action - can be a string, list with params, or None
# Examples: "toggle-repeater", ["transpose", 12], ["set-strum-chord", "C", 4]
ButtonAction = Union[str, List[Any], None]


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


VALID_PRESSURE_MODULATION_TYPES = ('none', 'aftertouch', 'cc')
DEFAULT_PRESSURE_MODULATION_TYPE = 'aftertouch'


@dataclass
class PressureModulationConfig:
    """
    Configuration for routing held-note pressure in slide mode.

    When the pen is held and pressure changes, the slider can emit either
    channel aftertouch or a Control Change message so the synth can
    modulate timbre/volume in real time.

    Attributes:
        type: 'none' (disabled), 'aftertouch' (channel pressure), or 'cc'
        cc_number: CC number to send when type == 'cc' (default 11 = Expression)
        min_value: MIDI value at pressure == pressure_threshold (0-127)
        max_value: MIDI value at pressure == 1.0 (0-127)
    """
    type: str = DEFAULT_PRESSURE_MODULATION_TYPE
    cc_number: int = 11
    min_value: int = 0
    max_value: int = 127

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'PressureModulationConfig':
        raw_type = data.get('type', DEFAULT_PRESSURE_MODULATION_TYPE)
        mod_type = raw_type if raw_type in VALID_PRESSURE_MODULATION_TYPES else DEFAULT_PRESSURE_MODULATION_TYPE
        return cls(
            type=mod_type,
            cc_number=int(data.get('cc_number', data.get('ccNumber', 11))),
            min_value=int(data.get('min_value', data.get('minValue', 0))),
            max_value=int(data.get('max_value', data.get('maxValue', 127)))
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            'type': self.type,
            'ccNumber': self.cc_number,
            'minValue': self.min_value,
            'maxValue': self.max_value
        }


@dataclass
class SliderConfig:
    """
    Configuration for the slider (trombone-style) mode.

    Tuning parameters specific to the Slider; the note layout (initial_notes,
    chord, spreads, midi_channel, invert_x) is shared with StrummingConfig.

    Attributes:
        pressure_threshold: Minimum pressure to register pen-down (0-1)
        max_bend_semitones: Maximum signed pitch bend in semitones. Should
            match the synth's configured pitch-bend range so the interpolation
            between adjacent strings reaches exactly the neighbor's pitch.
        pressure_modulation: How held-note pressure is routed to MIDI.
    """
    pressure_threshold: float = 0.1
    max_bend_semitones: float = 24.0
    pressure_modulation: PressureModulationConfig = field(default_factory=PressureModulationConfig)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SliderConfig':
        """Create from dictionary (supports both snake_case and camelCase)"""
        mod_data = data.get('pressure_modulation', data.get('pressureModulation'))
        modulation = (PressureModulationConfig.from_dict(mod_data)
                      if isinstance(mod_data, dict) else PressureModulationConfig())
        return cls(
            pressure_threshold=data.get('pressure_threshold', data.get('pressureThreshold', 0.1)),
            max_bend_semitones=data.get('max_bend_semitones', data.get('maxBendSemitones', 24.0)),
            pressure_modulation=modulation
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'pressureThreshold': self.pressure_threshold,
            'maxBendSemitones': self.max_bend_semitones,
            'pressureModulation': self.pressure_modulation.to_dict()
        }



def get_all_chord_progression_names(chord_progressions: Optional[Dict[str, List[str]]] = None) -> List[str]:
    """
    Get all chord progression names from config.
    If no progressions provided, returns empty list.

    Args:
        chord_progressions: Chord progressions from config

    Returns:
        List of all progression names
    """
    return list((chord_progressions or {}).keys())
