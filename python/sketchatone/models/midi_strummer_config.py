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
from .server_config import ServerConfig


@dataclass
class MidiStrummerConfig:
    """
    Combined configuration for MIDI strummer.

    Contains both the full strummer configuration (with all features),
    MIDI backend settings, and server configuration.

    Can be loaded from a single JSON file that contains strummer
    settings, a 'midi' section for MIDI backend configuration,
    and a 'server' section for HTTP/WebSocket server settings.
    """
    # Full strummer config (includes parameter mappings and features)
    strummer: StrummerConfig = field(default_factory=StrummerConfig)

    # MIDI backend settings
    midi: MidiConfig = field(default_factory=MidiConfig)

    # Server settings
    server: ServerConfig = field(default_factory=ServerConfig)

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

    # Server config convenience properties
    @property
    def http_port(self) -> Optional[int]:
        return self.server.http_port

    @property
    def ws_port(self) -> Optional[int]:
        return self.server.ws_port

    @property
    def ws_message_throttle(self) -> int:
        return self.server.ws_message_throttle

    @property
    def device_finding_poll_interval(self) -> Optional[int]:
        return self.server.device_finding_poll_interval

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MidiStrummerConfig':
        """
        Create a MidiStrummerConfig from a dictionary.

        Supports both nested format (with 'strummer' key) and flat format (for backward compatibility).
        - Nested format: { strummer: {...}, midi: {...}, server: {...} }
        - Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, server: {...} }
        """
        # Check if this is nested format (has 'strummer' key) or flat format
        has_strummer_key = 'strummer' in data and isinstance(data.get('strummer'), dict)

        if has_strummer_key:
            # Nested format: { strummer: {...}, midi: {...}, server: {...} }
            strummer_data = data.get('strummer', {})
            midi_data = data.get('midi', {})
            server_data = data.get('server', {})
        else:
            # Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, server: {...} }
            # Extract midi and server, pass everything else to StrummerConfig
            midi_data = data.get('midi', {})
            server_data = data.get('server', {})
            strummer_data = {k: v for k, v in data.items() if k not in ('midi', 'server')}

        # Load strummer config
        strummer = StrummerConfig.from_dict(strummer_data) if strummer_data else StrummerConfig()

        # Load MIDI config
        midi = MidiConfig.from_dict(midi_data) if midi_data else MidiConfig()

        # Load server config
        server = ServerConfig.from_dict(server_data) if server_data else ServerConfig()

        return cls(strummer=strummer, midi=midi, server=server)

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
        midi_config: Optional[MidiConfig] = None,
        server_config: Optional[ServerConfig] = None
    ) -> 'MidiStrummerConfig':
        """Create from separate StrummerConfig, MidiConfig, and ServerConfig objects"""
        return cls(
            strummer=strummer_config or StrummerConfig(),
            midi=midi_config or MidiConfig(),
            server=server_config or ServerConfig()
        )

    def to_strummer_config(self) -> StrummerConfig:
        """Get the strummer configuration"""
        return self.strummer

    def to_midi_config(self) -> MidiConfig:
        """Get the MIDI configuration"""
        return self.midi

    def to_server_config(self) -> ServerConfig:
        """Get the server configuration"""
        return self.server

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (matching Node.js structure)"""
        return {
            'strummer': self.strummer.to_dict(),
            'midi': self.midi.to_dict(),
            'server': self.server.to_dict()
        }

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)