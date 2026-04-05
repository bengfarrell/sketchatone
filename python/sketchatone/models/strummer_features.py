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
