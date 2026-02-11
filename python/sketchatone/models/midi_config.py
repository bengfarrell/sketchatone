"""
MIDI Config Model

Configuration model for MIDI backend settings.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Union, Literal, List
import json


# Default exclusions for MIDI input to prevent feedback loops
# These are patterns that will be matched (case-insensitive substring match)
DEFAULT_MIDI_INPUT_EXCLUDE: List[str] = [
    'sketchatone',      # Our own output port
    'ZynMidiRouter',    # Zynthian's internal MIDI router
    'zynseq',           # Zynthian sequencer
    'zynsmf',           # Zynthian SMF player
    'ttymidi',          # Serial MIDI (often internal)
    'Midi Through',     # ALSA Midi Through (loopback)
    # Synth plugin MIDI outputs can cause feedback loops (e.g., TAL_U-No-LX-V2-01:out)
    ':out',             # Generic output port suffix used by LV2 synth plugins
]


@dataclass
class MidiConfig:
    """
    Configuration for MIDI backend.

    Attributes:
        midi_output_backend: Which MIDI system to use ("rtmidi" or "jack")
        midi_output_id: MIDI output port - can be index (0, 1, 2) or name string, None = port 0
        midi_input_id: MIDI input port selection - can be index or name string, None = auto-connect all
        midi_input_exclude: List of port name patterns to exclude from auto-connect (case-insensitive substring match)
        jack_client_name: Name for JACK client (default: "sketchatone")
        jack_auto_connect: JACK auto-connect mode (default: "chain0")
        note_duration: Duration of notes in seconds (default: 1.5)
    """
    midi_output_backend: Literal["rtmidi", "jack"] = "rtmidi"
    midi_output_id: Optional[Union[int, str]] = None
    midi_input_id: Optional[Union[int, str]] = None
    midi_input_exclude: List[str] = field(default_factory=lambda: DEFAULT_MIDI_INPUT_EXCLUDE.copy())
    jack_client_name: str = "sketchatone"
    jack_auto_connect: Optional[str] = "chain0"
    note_duration: float = 1.5
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MidiConfig':
        """Create a MidiConfig from a dictionary"""
        # Handle both snake_case and camelCase keys
        # For midi_input_exclude, use config value if provided, otherwise use defaults
        exclude_list = data.get('midi_input_exclude', data.get('midiInputExclude'))
        if exclude_list is None:
            exclude_list = DEFAULT_MIDI_INPUT_EXCLUDE.copy()

        return cls(
            midi_output_backend=data.get('midi_output_backend', data.get('midiOutputBackend', 'rtmidi')),
            midi_output_id=data.get('midi_output_id', data.get('midiOutputId')),
            midi_input_id=data.get('midi_input_id', data.get('midiInputId')),
            midi_input_exclude=exclude_list,
            jack_client_name=data.get('jack_client_name', data.get('jackClientName', 'sketchatone')),
            jack_auto_connect=data.get('jack_auto_connect', data.get('jackAutoConnect', 'chain0')),
            note_duration=data.get('note_duration', data.get('noteDuration', 1.5))
        )
    
    @classmethod
    def from_json_file(cls, path: str) -> 'MidiConfig':
        """Load a MidiConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'midiOutputBackend': self.midi_output_backend,
            'midiOutputId': self.midi_output_id,
            'midiInputId': self.midi_input_id,
            'midiInputExclude': self.midi_input_exclude,
            'jackClientName': self.jack_client_name,
            'jackAutoConnect': self.jack_auto_connect,
            'noteDuration': self.note_duration
        }
    
    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
