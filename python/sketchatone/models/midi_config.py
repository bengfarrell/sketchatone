"""
MIDI Config Model

Configuration model for MIDI backend settings.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Union, Literal, List, TypedDict
import json


# Default exclusions for MIDI input
# These are system/internal ports that are typically not useful for user input
# Note: Users can now use the same device for input and output if desired
DEFAULT_MIDI_INPUT_EXCLUDE: List[str] = [
    'sketchatone',      # Our own output port
    'ZynMidiRouter',    # Zynthian's internal MIDI router
    'zynseq',           # Zynthian sequencer
    'zynsmf',           # Zynthian SMF player
    'ttymidi',          # Serial MIDI (often internal)
    'Midi Through',     # ALSA Midi Through (loopback)
]


class MidiPassthroughConnection(TypedDict):
    """A MIDI passthrough connection from input port to output port"""
    inputPort: Union[int, str]   # Input port ID or name
    outputPort: Union[int, str]  # Output port ID or name


@dataclass
class MidiConfig:
    """
    Configuration for MIDI backend.

    Attributes:
        midi_output_backend: Which MIDI system to use ("rtmidi" or "jack")
        midi_output_id: MIDI output port - can be index (0, 1, 2) or name string, None = port 0
        midi_input_id: MIDI input port selection - can be index or name string, None = auto-connect all
        midi_input_exclude: List of port name patterns to exclude from auto-connect (case-insensitive substring match)
        midi_passthrough: List of MIDI passthrough connections (input port -> output port)
        jack_client_name: Name for JACK client (default: "sketchatone")
        jack_auto_connect: JACK auto-connect mode (default: "chain0")
        default_note_duration: Default duration of notes in seconds (default: 1.5)
        midi_inter_message_delay: Delay in seconds after each MIDI message (default: 0).
            Use e.g. 0.002 (2 ms) on Raspberry Pi when notes stick with direct USB devices (e.g. Juno DS).
            Works with both rtmidi and JACK backends.
    """
    midi_output_backend: Literal["rtmidi", "jack"] = "rtmidi"
    midi_output_id: Optional[Union[int, str]] = None
    midi_input_id: Optional[Union[int, str]] = None
    midi_input_exclude: List[str] = field(default_factory=lambda: DEFAULT_MIDI_INPUT_EXCLUDE.copy())
    midi_passthrough: List[MidiPassthroughConnection] = field(default_factory=list)
    jack_client_name: str = "sketchatone"
    jack_auto_connect: Optional[str] = "chain0"
    default_note_duration: float = 1.5
    midi_inter_message_delay: float = 0.0
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MidiConfig':
        """Create a MidiConfig from a dictionary"""
        # Handle both snake_case and camelCase keys
        # For midi_input_exclude, use config value if provided, otherwise use defaults
        exclude_list = data.get('midi_input_exclude', data.get('midiInputExclude'))
        if exclude_list is None:
            exclude_list = DEFAULT_MIDI_INPUT_EXCLUDE.copy()

        # Get inter-message delay
        delay = data.get('midi_inter_message_delay', data.get('midiInterMessageDelay', 0))

        # Get passthrough connections
        passthrough = data.get('midi_passthrough', data.get('midiPassthrough', []))

        return cls(
            midi_output_backend=data.get('midi_output_backend', data.get('midiOutputBackend', 'rtmidi')),
            midi_output_id=data.get('midi_output_id', data.get('midiOutputId')),
            midi_input_id=data.get('midi_input_id', data.get('midiInputId')),
            midi_input_exclude=exclude_list,
            midi_passthrough=passthrough,
            jack_client_name=data.get('jack_client_name', data.get('jackClientName', 'sketchatone')),
            jack_auto_connect=data.get('jack_auto_connect', data.get('jackAutoConnect', 'chain0')),
            default_note_duration=data.get('default_note_duration', data.get('defaultNoteDuration', data.get('note_duration', data.get('noteDuration', 1.5)))),
            midi_inter_message_delay=float(delay or 0),
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
            'midiPassthrough': self.midi_passthrough,
            'jackClientName': self.jack_client_name,
            'jackAutoConnect': self.jack_auto_connect,
            'defaultNoteDuration': self.default_note_duration,
            'midiInterMessageDelay': self.midi_inter_message_delay,
        }
    
    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
