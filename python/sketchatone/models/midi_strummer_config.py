"""
MIDI Strummer Config Model

Combined configuration model for strummer and MIDI settings.
Now uses the full StrummerConfig with all features.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Union, Literal
import json

from .strummer_config import StrummerConfig
from .midi_config import MidiConfig


@dataclass
class MidiStrummerConfig:
    """
    Combined configuration for MIDI strummer.

    Contains both the full strummer configuration (with all features)
    and MIDI backend settings.

    Can be loaded from a single JSON file that contains both strummer
    settings and a 'midi' section for MIDI backend configuration.
    """
    # Full strummer config (includes parameter mappings and features)
    strummer: StrummerConfig = field(default_factory=StrummerConfig)

    # MIDI backend settings
    midi: MidiConfig = field(default_factory=MidiConfig)

    # Convenience properties for backward compatibility
    @property
    def pressure_threshold(self) -> float:
        return self.strummer.pressure_threshold

    @property
    def velocity_scale(self) -> float:
        return self.strummer.velocity_scale

    @property
    def notes(self):
        return self.strummer.notes

    @property
    def chord(self):
        return self.strummer.chord

    @property
    def lower_spread(self) -> int:
        return self.strummer.lower_spread

    @property
    def upper_spread(self) -> int:
        return self.strummer.upper_spread

    @property
    def channel(self):
        return self.strummer.channel

    @property
    def midi_output_backend(self) -> str:
        return self.midi.midi_output_backend

    @property
    def midi_output_id(self):
        return self.midi.midi_output_id

    @property
    def midi_input_id(self):
        return self.midi.midi_input_id

    @property
    def jack_client_name(self) -> str:
        return self.midi.jack_client_name

    @property
    def jack_auto_connect(self):
        return self.midi.jack_auto_connect

    @property
    def note_duration(self) -> float:
        return self.midi.note_duration

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MidiStrummerConfig':
        """
        Create a MidiStrummerConfig from a dictionary.
        """
        # Extract MIDI section if present
        midi_data = data.get('midi', {})

        # Load strummer config
        strummer = StrummerConfig.from_dict(data)

        # Load MIDI config
        midi = MidiConfig.from_dict(midi_data) if midi_data else MidiConfig()

        return cls(strummer=strummer, midi=midi)

    @classmethod
    def from_json_file(cls, path: str) -> 'MidiStrummerConfig':
        """Load a MidiStrummerConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)

    @classmethod
    def from_separate_configs(
        cls,
        strummer_config: Optional[StrummerConfig] = None,
        midi_config: Optional[MidiConfig] = None
    ) -> 'MidiStrummerConfig':
        """Create from separate StrummerConfig and MidiConfig objects"""
        return cls(
            strummer=strummer_config or StrummerConfig(),
            midi=midi_config or MidiConfig()
        )

    def to_strummer_config(self) -> StrummerConfig:
        """Get the strummer configuration"""
        return self.strummer

    def to_midi_config(self) -> MidiConfig:
        """Get the MIDI configuration"""
        return self.midi

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        result = self.strummer.to_dict()
        result['midi'] = self.midi.to_dict()
        return result

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)