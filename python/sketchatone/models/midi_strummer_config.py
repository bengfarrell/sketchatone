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
from .keyboard_config import KeyboardConfig
from .server_config import ServerConfig
from .device_buttons_config import DeviceButtonsConfig


@dataclass
class MidiStrummerConfig:
    """
    Combined configuration for MIDI strummer.

    Contains both the full strummer configuration (with all features),
    MIDI backend settings, keyboard input configuration, and server configuration.

    Can be loaded from a single JSON file that contains strummer
    settings, a 'midi' section for MIDI backend configuration,
    a 'keyboard' section for keyboard input configuration,
    and a 'server' section for HTTP/WebSocket server settings.
    """
    # Full strummer config (includes parameter mappings and features)
    strummer: StrummerConfig = field(default_factory=StrummerConfig)

    # MIDI backend settings
    midi: MidiConfig = field(default_factory=MidiConfig)

    # Keyboard input settings
    keyboard: KeyboardConfig = field(default_factory=KeyboardConfig)

    # Server settings
    server: ServerConfig = field(default_factory=ServerConfig)

    # Persisted device buttons (with auto-discovery toggle)
    device_buttons: DeviceButtonsConfig = field(default_factory=DeviceButtonsConfig)

    # Convenience properties for backward compatibility
    @property
    def pressure_threshold(self) -> float:
        return self.strummer.pressure_threshold

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
    def note_repeater(self):
        """Access note_repeater config for Actions class compatibility"""
        return self.strummer.note_repeater

    @property
    def transpose(self):
        """Access transpose config for Actions class compatibility"""
        return self.strummer.transpose

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
        """Backward compatibility property - use midi.default_note_duration instead"""
        return self.midi.default_note_duration

    # Server config convenience properties
    @property
    def http_port(self) -> Optional[int]:
        return self.server.http_port

    @property
    def https_port(self) -> Optional[int]:
        return self.server.https_port

    @property
    def ws_port(self) -> Optional[int]:
        return self.server.ws_port

    @property
    def wss_port(self) -> Optional[int]:
        return self.server.wss_port

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
        - Nested format: { strummer: {...}, midi: {...}, keyboard: {...}, server: {...} }
        - Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, keyboard: {...}, server: {...} }
        """
        # Check if this is nested format (has 'strummer' key) or flat format
        has_strummer_key = 'strummer' in data and isinstance(data.get('strummer'), dict)

        device_buttons_data = data.get('device_buttons', data.get('deviceButtons', {})) or {}

        if has_strummer_key:
            # Nested format: { strummer: {...}, midi: {...}, keyboard: {...}, server: {...}, deviceButtons: {...} }
            strummer_data = data.get('strummer', {})
            midi_data = data.get('midi', {})
            keyboard_data = data.get('keyboard', {})
            server_data = data.get('server', {})
        else:
            # Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, keyboard: {...}, server: {...} }
            # Extract midi, keyboard, server, deviceButtons; pass everything else to StrummerConfig
            midi_data = data.get('midi', {})
            keyboard_data = data.get('keyboard', {})
            server_data = data.get('server', {})
            strummer_data = {
                k: v for k, v in data.items()
                if k not in ('midi', 'keyboard', 'server', 'device_buttons', 'deviceButtons')
            }

        # Load strummer config
        strummer = StrummerConfig.from_dict(strummer_data) if strummer_data else StrummerConfig()

        # Load MIDI config
        midi = MidiConfig.from_dict(midi_data) if midi_data else MidiConfig()

        # Load keyboard config
        keyboard = KeyboardConfig.from_dict(keyboard_data) if keyboard_data else KeyboardConfig()

        # Load server config
        server = ServerConfig.from_dict(server_data) if server_data else ServerConfig()

        # Load device buttons config
        device_buttons = (
            DeviceButtonsConfig.from_dict(device_buttons_data)
            if device_buttons_data else DeviceButtonsConfig()
        )

        return cls(
            strummer=strummer, midi=midi, keyboard=keyboard,
            server=server, device_buttons=device_buttons,
        )

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
        result = {
            'strummer': self.strummer.to_dict(),
            'midi': self.midi.to_dict(),
            'server': self.server.to_dict(),
            'deviceButtons': self.device_buttons.to_dict(),
        }

        result['keyboard'] = self.keyboard.to_dict()

        return result

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)