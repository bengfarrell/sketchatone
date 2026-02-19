#!/usr/bin/env python3
"""
Strummer Server CLI

A CLI tool that creates WebSocket and HTTP servers for tablet and strum events.
Mirrors the TypeScript server.ts implementation.

Usage:
    python -m sketchatone.cli.server
    python -m sketchatone.cli.server --poll 2000
    python -m sketchatone.cli.server --ws-port 8081 --http-port 3000 --throttle 100
"""

import argparse
import asyncio
import json
import signal
import socket
import sys
import os
import time
import threading
import mimetypes
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Set, Callable, Union
from urllib.parse import unquote


def get_local_ip() -> Optional[str]:
    """Get the local network IP address (for LAN access)."""
    try:
        # Create a socket to determine the local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone import __version__ as SKETCHATONE_VERSION
from sketchatone.strummer.strummer import Strummer
from sketchatone.strummer.actions import Actions
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
from sketchatone.models.note import Note, NoteObject
from sketchatone.midi.bridge import MidiStrummerBridge
from sketchatone.midi.protocol import MidiBackendProtocol
from sketchatone.midi.rtmidi_input import RtMidiInput, MidiInputNoteEvent
from sketchatone.midi.jack_input import JackMidiInput

# Import blankslate's TabletReaderBase
try:
    from blankslate.cli.tablet_reader_base import TabletReaderBase, Colors, colored
    from blankslate.utils.finddevice import find_config_for_device
except ImportError:
    print("Error: blankslate package not found.")
    print("Make sure blankslate is installed: pip install -e ../blankslate/python")
    sys.exit(1)

# Import websockets
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:
    print("Error: websockets package not found.")
    print("Make sure websockets is installed: pip install websockets")
    sys.exit(1)

# Default config directory for device configs
# Check environment variable first (for packaged apps), then fall back to relative path
DEFAULT_CONFIG_DIR = os.environ.get('SKETCHATONE_CONFIG_DIR') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '..', 'public', 'configs', 'devices'
)

# MIME types for HTTP server
MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
}


@dataclass
class TabletEventData:
    """Tablet event data structure"""
    x: float = 0.0
    y: float = 0.0
    pressure: float = 0.0
    state: str = 'unknown'
    tiltX: float = 0.0
    tiltY: float = 0.0
    tiltXY: float = 0.0
    primaryButtonPressed: bool = False
    secondaryButtonPressed: bool = False
    # Tablet hardware buttons (dynamic - stored in dict for flexibility)
    tabletButtons: int = 0
    # Dynamic button states - keys are 'button1', 'button2', etc.
    buttons: Dict[str, bool] = field(default_factory=dict)


@dataclass
class StrumNoteEventData:
    """Individual strum note data"""
    note: int
    velocity: int
    name: str
    octave: int
    duration: float


@dataclass
class StrumEventData:
    """Strum event data structure"""
    type: str  # 'strum', 'mute', etc.
    notes: List[StrumNoteEventData] = field(default_factory=list)
    velocity: int = 0
    x: float = 0.0
    pressure: float = 0.0


@dataclass
class CombinedEventData:
    """Combined tablet + strum event data"""
    tablet: Optional[TabletEventData] = None
    strum: Optional[StrumEventData] = None


class StrummerEventBus:
    """
    Throttled event emitter for strummer events.

    Uses a buffer-based approach where:
    - Tablet data overwrites previous data (latest wins)
    - Strum data is preserved until the buffer is sent
    - Buffer is flushed at regular intervals (throttleMs)
    - Only sends if new data has arrived since last flush

    Thread-safe: emit methods can be called from any thread,
    flush is called from the asyncio event loop.
    """

    def __init__(self, throttle_ms: int = 150):
        import threading
        self.throttle_ms = throttle_ms
        self._buffer: CombinedEventData = CombinedEventData()
        self._listeners: List[Callable[[CombinedEventData], None]] = []
        self._interval_task: Optional[asyncio.Task] = None
        self._paused = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._has_new_data = False  # Track if new data has arrived since last flush
        self._lock = threading.Lock()  # Thread safety for buffer access

    def set_throttle(self, throttle_ms: int) -> None:
        """Update the throttle interval"""
        self.throttle_ms = throttle_ms

    def emit_tablet_event(self, data: TabletEventData) -> None:
        """Add tablet event to buffer (overwrites previous)"""
        with self._lock:
            self._buffer.tablet = data
            self._has_new_data = True

    def emit_strum_event(self, data: StrumEventData) -> None:
        """Add strum event to buffer (preserved until flush)"""
        with self._lock:
            self._buffer.strum = data
            self._has_new_data = True

    def on_combined_event(self, callback: Callable[[CombinedEventData], None]) -> None:
        """Register a listener for combined events"""
        self._listeners.append(callback)

    def off_combined_event(self, callback: Callable[[CombinedEventData], None]) -> None:
        """Remove a listener"""
        if callback in self._listeners:
            self._listeners.remove(callback)

    def pause(self) -> None:
        """Pause event emission"""
        self._paused = True

    def resume(self) -> None:
        """Resume event emission"""
        self._paused = False

    def flush(self) -> Optional[CombinedEventData]:
        """
        Flush the buffer and return data for emission. Only returns if new data arrived.
        Returns the buffer copy, or None if no data to emit.
        """
        if self._paused:
            return None

        # Atomically check and get buffer data
        with self._lock:
            if not self._has_new_data:
                return None

            # Copy the buffer data for emission
            buffer_copy = CombinedEventData(
                tablet=self._buffer.tablet,
                strum=self._buffer.strum
            )
            # Clear strum data after flush (tablet data persists)
            self._buffer.strum = None
            # Reset the new data flag
            self._has_new_data = False

        return buffer_copy

    async def _flush_loop(self) -> None:
        """Background task that flushes buffer at regular intervals"""
        while True:
            await asyncio.sleep(self.throttle_ms / 1000.0)

            # Get buffer data
            buffer_copy = self.flush()
            if buffer_copy is None:
                continue

            # Emit to listeners - collect any async tasks
            if buffer_copy.tablet is not None or buffer_copy.strum is not None:
                for listener in self._listeners:
                    try:
                        result = listener(buffer_copy)
                        # If listener returns a coroutine, await it
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        print(colored(f'Error in event listener: {e}', Colors.RED))

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start the flush interval"""
        self._loop = loop
        if self._interval_task is None:
            self._interval_task = loop.create_task(self._flush_loop())

    def cleanup(self) -> None:
        """Stop the flush interval and clear listeners"""
        if self._interval_task is not None:
            self._interval_task.cancel()
            self._interval_task = None
        self._listeners.clear()


def _poll_for_device(search_dir: str, poll_ms: int) -> str:
    """
    Poll for a device connection indefinitely.

    Args:
        search_dir: Directory to search for config files
        poll_ms: Poll interval in milliseconds

    Returns:
        Config file path when device is found
    """
    print(colored(f'No tablet device found. Waiting for device to be connected...', Colors.YELLOW))
    print(colored(f'Poll interval: {poll_ms}ms', Colors.GRAY))
    print(colored('Press Ctrl+C to exit.', Colors.GRAY))

    while True:
        found_config = find_config_for_device(search_dir)
        if found_config:
            print(colored(f'Device connected! Using config: {found_config}', Colors.GREEN))
            return found_config
        time.sleep(poll_ms / 1000.0)


def _exit_no_device(search_dir: str) -> None:
    """Exit with error message when no device is found."""
    print(colored(f'Error: No matching tablet config found in: {search_dir}', Colors.RED))
    print(colored('Use --poll <ms> to wait for a device to be connected.', Colors.GRAY))
    sys.exit(1)


def resolve_device_config_path(
    device_path: str | None,
    base_dir: str | None = None,
    default_dir: str = DEFAULT_CONFIG_DIR,
    poll_ms: int | None = None
) -> tuple[str | None, str]:
    """
    Resolve device config path - if it's a directory or None, search for matching config.

    Supports:
    - Absolute paths (e.g., /opt/sketchatone/configs/devices)
    - Relative paths resolved from base_dir (e.g., "devices" relative to config file location)
    - Direct file paths (e.g., /opt/sketchatone/configs/devices/xp-pen.json)

    Args:
        device_path: Device config path (file, directory, or None)
        base_dir: Base directory for resolving relative paths (e.g., config file's directory)
        default_dir: Default directory to search if device_path is None and base_dir is None
        poll_ms: If set, return None for config path to indicate polling should happen later

    Returns:
        Tuple of (config_file_path or None, search_directory)
        If config_file_path is None, the server should poll for device in background

    Raises:
        SystemExit: If no matching config is found and poll_ms is not set
    """
    # Resolve the path
    if device_path is None:
        # No device path specified, use default directory
        search_dir = os.path.abspath(default_dir)
    elif os.path.isabs(device_path):
        # Absolute path - use as-is
        if device_path.endswith('.json'):
            # Direct file path
            if not os.path.exists(device_path):
                print(colored(f'Error: Device config file not found: {device_path}', Colors.RED))
                sys.exit(1)
            return device_path, os.path.dirname(device_path)
        else:
            # Directory path
            search_dir = device_path
    else:
        # Relative path - resolve from base_dir or current directory
        if base_dir:
            resolved_path = os.path.join(base_dir, device_path)
        else:
            resolved_path = device_path
        resolved_path = os.path.abspath(resolved_path)

        if resolved_path.endswith('.json'):
            # Direct file path
            if not os.path.exists(resolved_path):
                print(colored(f'Error: Device config file not found: {resolved_path}', Colors.RED))
                sys.exit(1)
            return resolved_path, os.path.dirname(resolved_path)
        else:
            # Directory path
            search_dir = resolved_path

    # Validate directory exists
    if not os.path.isdir(search_dir):
        print(colored(f'Error: Device config directory not found: {search_dir}', Colors.RED))
        sys.exit(1)

    # Search for matching device config
    found_config = find_config_for_device(search_dir)
    if found_config:
        return found_config, search_dir
    elif poll_ms is not None:
        # Return None to indicate polling should happen in background
        return None, search_dir
    else:
        _exit_no_device(search_dir)


class StrummerWebSocketServer(TabletReaderBase):
    """
    WebSocket server that broadcasts tablet and strum events.
    Extends TabletReaderBase for HID device access.
    """

    def __init__(
        self,
        tablet_config_path: Optional[str],
        strummer_config_path: Optional[str] = None,
        ws_port: int = 8081,
        http_port: Optional[int] = None,
        throttle_ms: int = 150,
        poll_ms: Optional[int] = None,
        search_dir: Optional[str] = None,
        # MIDI options
        use_jack: Optional[bool] = None,
        midi_channel: Optional[int] = None,
        midi_port: Optional[Union[str, int]] = None,
        note_duration: Optional[float] = None,
        jack_client_name: Optional[str] = None,
        jack_auto_connect: Optional[str] = None
    ):
        # Only call parent init if we have a config path
        # Otherwise we'll initialize later when device is found
        self._tablet_initialized = tablet_config_path is not None
        if tablet_config_path:
            super().__init__(tablet_config_path)

        self.ws_port = ws_port
        self.http_port = http_port
        self.poll_ms = poll_ms
        self.search_dir = search_dir or DEFAULT_CONFIG_DIR

        # Determine public directory for HTTP server
        # Check environment variable first (for packaged apps), then fall back to relative path
        # __file__ is python/sketchatone/cli/server.py
        # Go up 4 levels to project root, then into dist/public
        self.public_dir = os.environ.get('SKETCHATONE_PUBLIC_DIR') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'dist', 'public'
        )
        self.clients: Set[WebSocketServerProtocol] = set()
        self.server: Optional[websockets.WebSocketServer] = None
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None

        # Create event bus
        self.event_bus = StrummerEventBus(throttle_ms)

        # Store the config path for saving later
        self.strummer_config_path = strummer_config_path

        # Extract config directory and filename
        if strummer_config_path:
            self.strummer_config_dir = os.path.dirname(os.path.abspath(strummer_config_path))
            self.current_config_name = os.path.basename(strummer_config_path)
        else:
            # Set default config directory when no config file specified
            self.strummer_config_dir = os.path.join(self.public_dir, 'configs')
            # Try to load default.json if it exists
            default_config_path = os.path.join(self.strummer_config_dir, 'default.json')
            if os.path.exists(default_config_path):
                self.strummer_config_path = default_config_path
                self.current_config_name = 'default.json'
            else:
                self.current_config_name = None

        # Load config
        if self.strummer_config_path:
            self.config = MidiStrummerConfig.from_json_file(self.strummer_config_path)
        else:
            self.config = MidiStrummerConfig()

        # Apply CLI overrides for MIDI settings
        if use_jack is not None:
            self.config.midi.midi_output_backend = "jack" if use_jack else "rtmidi"
        if midi_channel is not None:
            self.config.strummer.strumming.midi_channel = midi_channel
        if midi_port is not None:
            self.config.midi.midi_output_id = midi_port
        if note_duration is not None:
            self.config.midi.note_duration = note_duration
        if jack_client_name is not None:
            self.config.midi.jack_client_name = jack_client_name
        if jack_auto_connect is not None:
            self.config.midi.jack_auto_connect = jack_auto_connect

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)

        # Set up notes
        self._setup_notes()

        # MIDI backend and bridge
        self.backend: Optional[MidiBackendProtocol] = None
        self.bridge: Optional[MidiStrummerBridge] = None
        self.notes_played = 0

        # MIDI input (for external keyboards)
        # Uses JackMidiInput when JACK backend is active, otherwise RtMidiInput
        self.midi_input: Optional[Union[RtMidiInput, JackMidiInput]] = None
        self._midi_input_debounce_timer: Optional[threading.Timer] = None

        # Running state - set to True when tablet reader starts
        self.is_running = False

        # Create Actions handler for stylus buttons
        # Pass the actual config object so Actions can access live values
        # (e.g., lower_spread/upper_spread that may be updated via UI)
        self.actions = Actions(
            config=self.config,
            strummer=self.strummer
        )

        # Configure action rules so button-to-action mapping works
        self.actions.set_action_rules_config(self.config.strummer.action_rules)

        # Listen for action events to broadcast to clients
        self.actions.on('action_executed', self._broadcast_action_event)

        # Execute any startup rules defined in the config
        self.actions.execute_startup_rules()

        # State tracking for stylus buttons
        self.button_state = {
            'primaryButtonPressed': False,
            'secondaryButtonPressed': False,
        }

        # State tracking for tablet hardware buttons (dynamically sized based on device capabilities)
        self.tablet_button_state: Dict[str, bool] = {}
        self.tablet_button_count: int = 8  # Default, updated when device connects



        # State tracking for note repeater
        self.repeater_state = {
            'notes': [],
            'last_repeat_time': 0.0,
            'is_holding': False,
        }

        # State tracking for strum release feature
        self.strum_start_time: float = 0.0

        # Register event bus listener
        self.event_bus.on_combined_event(self._broadcast_combined_event)
    
    def _setup_notes(self) -> None:
        """Set up notes from config"""
        base_notes = []

        # If chord is specified, parse it
        if self.config.chord:
            base_notes = Note.parse_chord(self.config.chord)
        else:
            # Parse individual note strings (e.g., "C4", "E4", "G4")
            for note_str in self.config.notes:
                base_notes.append(Note.parse_notation(note_str))

        # Apply spread to both chord and initial notes
        notes = Note.fill_note_spread(
            base_notes,
            self.config.lower_spread,
            self.config.upper_spread
        )

        self.strummer.notes = notes

    def _initialize_tablet_button_state(self) -> None:
        """Initialize tablet button state based on device capabilities"""
        capabilities = None
        if hasattr(self, 'config_data') and self.config_data:
            capabilities = self.config_data.get_capabilities()

        self.tablet_button_count = capabilities.buttonCount if capabilities else 8

        # Initialize button state for all buttons
        self.tablet_button_state = {}
        for i in range(1, self.tablet_button_count + 1):
            self.tablet_button_state[f'button{i}'] = False

        print(colored(f'  Tablet has {self.tablet_button_count} hardware buttons', Colors.GRAY))

    def _get_control_value(self, control: str, events: Dict[str, Any]) -> Optional[float]:
        """
        Get the control input value based on the control type.

        Args:
            control: Control source type ("pressure", "tiltX", "tiltY", "tiltXY", "xaxis", "yaxis", "velocity", "none")
            events: Dictionary of event values from the tablet

        Returns:
            Normalized control value (0.0 to 1.0), or None if control is "none"
        """
        if control == "none":
            return None
        elif control == "pressure":
            return float(events.get('pressure', 0))
        elif control == "tiltX":
            # tiltX from blankslate is -1 to 1, normalize to 0-1
            return (float(events.get('tiltX', 0)) + 1.0) / 2.0
        elif control == "tiltY":
            # tiltY from blankslate is -1 to 1, normalize to 0-1
            return (float(events.get('tiltY', 0)) + 1.0) / 2.0
        elif control == "tiltXY":
            # tiltXY from blankslate is -1 to 1, normalize to 0-1
            return (float(events.get('tiltXY', 0)) + 1.0) / 2.0
        elif control == "xaxis":
            return float(events.get('x', 0.5))
        elif control == "yaxis":
            return float(events.get('y', 0.5))
        elif control == "velocity":
            # Use pressure velocity if available
            return float(events.get('pressureVelocity', events.get('pressure', 0)))
        else:
            return None

    def _setup_midi(self) -> bool:
        """Initialize MIDI backend and bridge"""
        try:
            if self.config.midi_output_backend == "jack":
                from sketchatone.midi.jack_backend import JackMidiBackend
                self.backend = JackMidiBackend(
                    channel=self.config.channel,
                    client_name=self.config.jack_client_name,
                    auto_connect=self.config.jack_auto_connect
                )
            else:
                from sketchatone.midi.rtmidi_backend import RtMidiBackend
                self.backend = RtMidiBackend(channel=self.config.channel)

            # Connect backend
            port = self.config.midi_output_id
            if not self.backend.connect(port):
                print(colored('Failed to connect MIDI backend', Colors.RED))
                return False

            # Create bridge
            self.bridge = MidiStrummerBridge(
                self.strummer,
                self.backend,
                note_duration=self.config.note_duration,
                auto_connect=False  # We'll handle events manually
            )

            return True

        except ImportError as e:
            print(colored(f'MIDI backend not available: {e}', Colors.RED))
            return False

    def _print_midi_config(self) -> None:
        """Print MIDI configuration info"""
        print(colored('MIDI Config:', Colors.WHITE, bold=True))
        print(colored('  Backend: ', Colors.CYAN) +
              colored(self.config.midi_output_backend, Colors.WHITE))
        print(colored('  Channel: ', Colors.CYAN) +
              colored(str(self.config.channel), Colors.WHITE))
        if self.config.midi_output_id is not None:
            print(colored('  Output Port: ', Colors.CYAN) +
                  colored(str(self.config.midi_output_id), Colors.WHITE))
        print(colored('  Note Duration: ', Colors.CYAN) +
              colored(f'{self.config.note_duration}s', Colors.WHITE))
        if self.config.midi_output_backend == "jack":
            print(colored('  JACK Client: ', Colors.CYAN) +
                  colored(self.config.jack_client_name, Colors.WHITE))
            if self.config.jack_auto_connect:
                print(colored('  JACK Auto-connect: ', Colors.CYAN) +
                      colored(self.config.jack_auto_connect, Colors.WHITE))

    def _setup_midi_input(self) -> bool:
        """
        Initialize MIDI input for external keyboard.
        If midi_input_id is None, listens to ALL available MIDI inputs (discovery mode).
        If midi_input_id is specified, connects only to that port.

        Uses JackMidiInput when JACK backend is active, otherwise RtMidiInput.
        Excludes the MIDI output port to prevent feedback loops.
        """
        try:
            # Use JACK MIDI input when JACK backend is active
            if self.config.midi_output_backend == "jack":
                self.midi_input = JackMidiInput()
                print(colored('[MIDI Input] Using JACK MIDI input', Colors.GRAY))
            else:
                self.midi_input = RtMidiInput()
                print(colored('[MIDI Input] Using RtMidi (ALSA) input', Colors.GRAY))
            input_port = self.config.midi.midi_input_id

            connected = False
            if input_port is None or input_port == '':
                # Auto-connect to all MIDI sources, excluding ports that could cause feedback
                # Use exclusion list from config (which has sensible defaults)
                exclude_ports: List[str] = list(self.config.midi.midi_input_exclude)

                # Also exclude any RtMidi output if available
                if self.backend and hasattr(self.backend, 'current_output_name') and self.backend.current_output_name:
                    exclude_ports.append(self.backend.current_output_name)

                print(colored(f'[MIDI Input] Connecting to all ports, excluding: {", ".join(exclude_ports)}', Colors.GRAY))
                connected = self.midi_input.connect_all(exclude_ports=exclude_ports)
            else:
                # Specific port mode - restore from saved config
                print(colored(f'[MIDI Input] Restoring saved port: {input_port}', Colors.CYAN))
                connected = self.midi_input.connect(input_port)

            if not connected:
                print(colored('[MIDI Input] No MIDI input ports available', Colors.YELLOW))
                return False

            # Listen for note events with debounce logic
            def on_midi_note(event: MidiInputNoteEvent) -> None:
                # Broadcast MIDI input event to all clients (for UI display)
                self._broadcast_midi_input(event)

                # Clear any pending debounce timer
                if self._midi_input_debounce_timer:
                    self._midi_input_debounce_timer.cancel()
                    self._midi_input_debounce_timer = None

                if event.get('added'):
                    # Note was added - update immediately
                    self._update_notes_from_midi_input(event['notes'])
                elif event.get('removed'):
                    # Note was removed - debounce to handle rapid releases
                    def debounced_update():
                        self._midi_input_debounce_timer = None
                        # Only update if there are still notes held
                        # If all notes released, keep the last chord
                        if self.midi_input and len(self.midi_input.notes) > 0:
                            self._update_notes_from_midi_input(self.midi_input.notes)

                    self._midi_input_debounce_timer = threading.Timer(0.1, debounced_update)
                    self._midi_input_debounce_timer.daemon = True
                    self._midi_input_debounce_timer.start()

            self.midi_input.on_note(on_midi_note)
            return True

        except Exception as e:
            print(colored(f'MIDI input not available: {e}', Colors.RED))
            return False

    def _broadcast_midi_input(self, event: MidiInputNoteEvent) -> None:
        """Broadcast MIDI input event to all connected clients"""
        if not self.clients:
            return

        # Get ALL available ports (not just connected ones) for user selection
        available_ports = self.midi_input.get_available_ports() if self.midi_input else []

        # Get currently connected port name
        connected_port = None
        if self.midi_input and self.midi_input.connected_ports:
            connected_port = self.midi_input.connected_ports[0]['name']

        midi_input_message = {
            'type': 'midi-input',
            'notes': event.get('notes', []),
            'added': event.get('added'),
            'removed': event.get('removed'),
            'portName': event.get('port_name'),
            'availablePorts': [
                {'id': p['id'], 'name': p['name']}
                for p in available_ports
            ],
            'connectedPort': connected_port,
        }

        self._broadcast(json.dumps(midi_input_message))

    async def _send_midi_input_status(self, websocket: WebSocketServerProtocol) -> None:
        """Send MIDI input status to a specific client"""
        if not self.midi_input:
            return

        # Get ALL available ports (not just connected ones) for user selection
        available_ports = self.midi_input.get_available_ports()

        # Get currently connected port name
        connected_port = None
        if self.midi_input.connected_ports:
            connected_port = self.midi_input.connected_ports[0]['name']

        midi_input_message = {
            'type': 'midi-input-status',
            'connected': self.midi_input.is_connected,
            'availablePorts': [
                {'id': p['id'], 'name': p['name']}
                for p in available_ports
            ],
            'connectedPort': connected_port,
            'currentNotes': self.midi_input.notes,
        }

        await websocket.send(json.dumps(midi_input_message))

    def _update_notes_from_midi_input(self, note_strings: List[str]) -> None:
        """Update strummer notes from MIDI input"""
        if not note_strings:
            return

        # Update the config's initial_notes
        self.config.strummer.strumming.initial_notes = note_strings

        # Reconfigure strummer with new notes
        self._setup_notes()

        # Broadcast config change to all connected clients
        self.broadcast_config()

        print(colored(f'[MIDI Input] Notes: {", ".join(note_strings)}', Colors.CYAN))

    async def start(self) -> None:
        """Start the reader - required by TabletReaderBase abstract method"""
        # This is called by the parent class's start_sync method
        # We just need to call the parent's initialize_reader
        await self.initialize_reader()

    async def _handle_http_request(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming HTTP request for static file serving"""
        try:
            # Read request line
            request_line = await reader.readline()
            if not request_line:
                return

            request_text = request_line.decode('utf-8', errors='ignore')
            parts = request_text.strip().split(' ')
            if len(parts) < 2:
                return

            method, path = parts[0], parts[1]

            # Read headers (we don't need them but must consume them)
            while True:
                line = await reader.readline()
                if line == b'\r\n' or line == b'\n' or not line:
                    break

            # Only handle GET requests
            if method != 'GET':
                response = b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
                return

            # Parse path
            url_path = path.split('?')[0]  # Remove query string
            if url_path == '/':
                url_path = '/index.html'

            # Security: prevent directory traversal
            if '..' in url_path:
                response = b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
                return

            # Build file path
            file_path = os.path.join(self.public_dir, url_path.lstrip('/'))

            if os.path.isfile(file_path):
                # Get MIME type
                ext = os.path.splitext(file_path)[1].lower()
                content_type = MIME_TYPES.get(ext, 'application/octet-stream')

                # Read and serve file
                with open(file_path, 'rb') as f:
                    content = f.read()

                response_headers = f'HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {len(content)}\r\n\r\n'
                writer.write(response_headers.encode('utf-8'))
                writer.write(content)
            else:
                # 404 Not Found
                body = b'Not Found'
                response = f'HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n'
                writer.write(response.encode('utf-8'))
                writer.write(body)

            await writer.drain()
        except Exception as e:
            try:
                response = b'HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
            except:
                pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass

    async def _broadcast_combined_event(self, data: CombinedEventData) -> None:
        """Broadcast combined event to all connected clients"""
        if not self.clients:
            return

        # Build message - format matches Node.js server
        # Tablet data is spread at top level, strum is optional nested object
        message: Dict[str, Any] = {
            'type': 'tablet-data',
            'timestamp': int(time.time() * 1000)
        }

        if data.tablet:
            message['x'] = data.tablet.x
            message['y'] = data.tablet.y
            message['pressure'] = data.tablet.pressure
            message['state'] = data.tablet.state
            message['tiltX'] = data.tablet.tiltX
            message['tiltY'] = data.tablet.tiltY
            message['tiltXY'] = data.tablet.tiltXY
            message['primaryButtonPressed'] = data.tablet.primaryButtonPressed
            message['secondaryButtonPressed'] = data.tablet.secondaryButtonPressed
            # Tablet hardware buttons (dynamic)
            message['tabletButtons'] = data.tablet.tabletButtons
            # Add all button states dynamically
            for button_key, button_value in data.tablet.buttons.items():
                message[button_key] = button_value

        if data.strum:
            message['strum'] = {
                'type': data.strum.type,
                'notes': [
                    {
                        'note': {
                            'notation': n.name,
                            'octave': n.octave,
                            'midiNote': n.note
                        },
                        'velocity': n.velocity
                    }
                    for n in data.strum.notes
                ],
                'velocity': data.strum.velocity,
                'timestamp': int(time.time() * 1000)
            }

        # Broadcast to all clients - await to provide backpressure
        await self._broadcast_to_all_clients(json.dumps(message))
    
    def _broadcast(self, message: str) -> None:
        """Broadcast message to all connected clients"""
        if not self.clients or self._main_loop is None:
            return

        # Check if we're already in the event loop
        try:
            running_loop = asyncio.get_running_loop()
            in_event_loop = running_loop is self._main_loop
        except RuntimeError:
            in_event_loop = False

        if in_event_loop:
            # Already in the event loop, create a single task for all clients
            asyncio.create_task(self._broadcast_to_all_clients(message))
        else:
            # Called from another thread, use run_coroutine_threadsafe
            asyncio.run_coroutine_threadsafe(
                self._broadcast_to_all_clients(message),
                self._main_loop
            )

    async def _broadcast_to_all_clients(self, message: str) -> None:
        """Broadcast message to all clients with proper error handling"""
        if not self.clients:
            return

        # Send to all clients concurrently but wait for completion
        # This provides backpressure - we won't schedule more broadcasts
        # until the current one completes
        clients_to_remove = []

        async def send_with_timeout(client: WebSocketServerProtocol) -> None:
            try:
                await asyncio.wait_for(client.send(message), timeout=1.0)
            except asyncio.TimeoutError:
                clients_to_remove.append(client)
            except websockets.exceptions.ConnectionClosed:
                clients_to_remove.append(client)
            except Exception:
                clients_to_remove.append(client)

        # Send to all clients concurrently
        await asyncio.gather(
            *[send_with_timeout(client) for client in list(self.clients)],
            return_exceptions=True
        )

        # Remove failed clients
        for client in clients_to_remove:
            self.clients.discard(client)

    def broadcast_status(self, connected: bool, device_name: Optional[str] = None) -> None:
        """Broadcast device status to all clients"""
        import time
        status_str = 'connected' if connected else 'disconnected'
        message_text = f'Tablet {"connected" if connected else "disconnected"}'
        if device_name:
            message_text = f'{device_name} {status_str}'

        message = {
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }
        self._broadcast(json.dumps(message))
    
    def _list_configs(self) -> List[str]:
        """
        List all available config files in the config directory.
        Only returns .json files that are not in subdirectories.
        """
        if not self.strummer_config_dir:
            return []

        try:
            files = os.listdir(self.strummer_config_dir)
            return [
                f for f in files
                if f.endswith('.json') and os.path.isfile(os.path.join(self.strummer_config_dir, f))
            ]
        except Exception as e:
            print(colored(f'[List Configs] Failed to list configs: {e}', Colors.RED))
            return []

    def _get_config_data(self, is_saved_state: bool = True) -> Dict[str, Any]:
        """Get config data in the format expected by the webapp"""
        # Get device capabilities if available
        device_capabilities = None
        if hasattr(self, 'config_data') and self.config_data:
            caps = self.config_data.get_capabilities()
            if caps:
                device_capabilities = {
                    'hasButtons': caps.hasButtons,
                    'buttonCount': caps.buttonCount,
                    'hasPressure': caps.hasPressure,
                    'pressureLevels': caps.pressureLevels,
                    'hasTilt': caps.hasTilt,
                    'resolution': {
                        'x': caps.resolution.x,
                        'y': caps.resolution.y,
                    },
                }

        return {
            'throttleMs': self.event_bus.throttle_ms,
            'notes': [
                {'notation': n.notation, 'octave': n.octave}
                for n in self.strummer.notes
            ],
            'config': self.config.to_dict(),
            'serverVersion': SKETCHATONE_VERSION,
            'deviceCapabilities': device_capabilities,
            'currentConfigName': self.current_config_name,
            'availableConfigs': self._list_configs(),
            'isSavedState': is_saved_state,
        }

    def broadcast_config(self, is_saved_state: bool = False) -> None:
        """
        Broadcast current config to all clients.

        Args:
            is_saved_state: True when config represents the saved state (after load/save),
                           False for updates (default)
        """
        message = {
            'type': 'config',
            'data': self._get_config_data(is_saved_state)
        }
        self._broadcast(json.dumps(message))

    def _broadcast_action_event(self, event: Dict[str, Any]) -> None:
        """
        Broadcast action executed event to all connected clients.
        Used for UI feedback (e.g., status dots on action rules).

        Args:
            event: Action event data containing action, params, button, trigger,
                   timestamp, rule_id, and is_startup
        """
        # Convert Python snake_case to JavaScript camelCase for the WebSocket message
        message = {
            'type': 'action-event',
            'action': event.get('action'),
            'params': event.get('params', []),
            'button': event.get('button'),
            'trigger': event.get('trigger'),
            'timestamp': event.get('timestamp'),
            'ruleId': event.get('rule_id'),
            'isStartup': event.get('is_startup', False),
        }
        self._broadcast(json.dumps(message))

    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a WebSocket client connection"""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(colored(f'Client connected: {client_addr}', Colors.GREEN))
        
        # Resume event bus when first client connects
        if len(self.clients) == 1:
            self.event_bus.resume()
        
        # Send initial config (is_saved_state=True since this is the saved state on connection)
        await websocket.send(json.dumps({
            'type': 'config',
            'data': self._get_config_data(is_saved_state=True)
        }))
        
        # Send initial status (matching Node.js format)
        import time
        device_name = self.device_name if hasattr(self, 'device_name') else None
        connected = self.is_running
        status_str = 'connected' if connected else 'disconnected'
        message_text = 'Tablet connected' if connected else 'Waiting for tablet...'
        if device_name and connected:
            message_text = f'{device_name} connected'

        await websocket.send(json.dumps({
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }))

        # Send MIDI input status to new client
        await self._send_midi_input_status(websocket)

        try:
            async for message in websocket:
                await self._handle_client_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(colored(f'Client disconnected: {client_addr}', Colors.YELLOW))
            
            # Pause event bus when no clients connected
            if len(self.clients) == 0:
                self.event_bus.pause()
    
    async def _handle_client_message(self, websocket: WebSocketServerProtocol, message: str) -> None:
        """Handle incoming client message"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'set-throttle':
                # Support both 'throttleMs' (webapp format) and 'throttle' (legacy)
                throttle = data.get('throttleMs', data.get('throttle', 150))
                self.event_bus.set_throttle(throttle)
                print(colored(f'Throttle updated to {throttle}ms', Colors.CYAN))
            
            elif msg_type == 'update-config':
                # Handle path-based config updates (like Node.js server)
                path = data.get('path')
                value = data.get('value')
                if path is not None:
                    self._handle_config_update(path, value)
                else:
                    # Legacy: full config object update
                    config_data = data.get('config', {})
                    self._update_config(config_data)
                # Broadcast updated config to all clients
                self.broadcast_config()

            elif msg_type == 'save-config':
                # Save the current configuration to the config file
                self._handle_save_config()

            elif msg_type == 'load-config':
                # Load a different config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_load_config(config_name)

            elif msg_type == 'create-config':
                # Create a new config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_create_config(config_name)

            elif msg_type == 'rename-config':
                # Rename a config file
                old_name = data.get('oldName')
                new_name = data.get('newName')
                if old_name and new_name:
                    self._handle_rename_config(old_name, new_name)

            elif msg_type == 'upload-config':
                # Upload/import a config file
                config_name = data.get('configName')
                config_data = data.get('configData')
                if config_name and config_data:
                    self._handle_upload_config(config_name, config_data)

            elif msg_type == 'delete-config':
                # Delete a config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_delete_config(config_name)

            else:
                print(colored(f'Unknown message type: {msg_type}', Colors.YELLOW))
        
        except json.JSONDecodeError:
            print(colored(f'Invalid JSON message received', Colors.RED))
    
    def _update_config(self, config_data: Dict[str, Any]) -> None:
        """Update configuration from client data"""
        # Update basic settings
        if 'velocityScale' in config_data:
            self.config.velocity_scale = config_data['velocityScale']
        if 'pressureThreshold' in config_data:
            self.config.pressure_threshold = config_data['pressureThreshold']
        if 'defaultVelocity' in config_data:
            self.config.default_velocity = config_data['defaultVelocity']
        if 'noteDuration' in config_data:
            self.config.note_duration = config_data['noteDuration']
        
        # Update notes if provided
        if 'notes' in config_data:
            self.config.notes = []
            for note_data in config_data['notes']:
                from sketchatone.models.midi_strummer_config import NoteConfig
                note_config = NoteConfig(
                    name=note_data.get('name', 'C'),
                    octave=note_data.get('octave', 4),
                    velocity=note_data.get('velocity'),
                    duration=note_data.get('duration')
                )
                self.config.notes.append(note_config)
        
        # Reconfigure strummer
        self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)
        self._setup_notes()

        print(colored('Config updated from client', Colors.GREEN))

    def _handle_config_update(self, path: str, value: Any) -> None:
        """
        Handle a path-based config update from a client.
        Updates the config and re-applies settings as needed.

        Args:
            path: Dot-notation path to the config property (e.g., 'strummer.strumming.upperNoteSpread')
            value: The new value for the property
        """
        try:
            # Set the config value using the path
            self._set_config_value(path, value)

            # Re-apply strummer settings if relevant
            if path.startswith('strummer.strumming.'):
                self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)

            # Re-setup notes if chord or note spread changed
            if 'chord' in path.lower() or 'spread' in path.lower() or 'initialNotes' in path:
                self._setup_notes()

            # Update MIDI channel on the backend if it changed
            # Frontend sends 1-16 (1-based), backend expects 1-16 (1-based)
            if 'midiChannel' in path and self.backend is not None:
                self.backend.set_channel(value)

            # Re-apply action rules if they changed
            if 'actionRules' in path or 'action_rules' in path:
                self.actions.set_action_rules_config(self.config.strummer.action_rules)
                # Re-execute startup rules to apply new chord progression
                self.actions.execute_startup_rules()

            print(colored(f'Config updated: {path} = {value}', Colors.YELLOW))
        except Exception as e:
            print(colored(f'Failed to update config: {path} - {e}', Colors.RED))

    def _handle_save_config(self) -> None:
        """
        Save the current configuration to the config file.
        Preserves original file ownership even when running as root (sudo).
        """
        if not self.strummer_config_path:
            print(colored('[Save Config] No config file path - config was not loaded from a file', Colors.RED))
            return

        try:
            # Get original file ownership before writing (to preserve when running as sudo)
            original_uid = None
            original_gid = None
            if os.path.exists(self.strummer_config_path):
                stat_info = os.stat(self.strummer_config_path)
                original_uid = stat_info.st_uid
                original_gid = stat_info.st_gid

            config_dict = self.config.to_dict()
            with open(self.strummer_config_path, 'w', encoding='utf-8') as f:
                json.dump(config_dict, f, indent=2)

            # Restore original ownership if we had it and we're running as root
            if original_uid is not None and os.geteuid() == 0:
                os.chown(self.strummer_config_path, original_uid, original_gid)

            print(colored(f'[Save Config] Configuration saved to {self.strummer_config_path}', Colors.GREEN))

            # Broadcast with is_saved_state=True so clients know config matches file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Save Config] Failed to save configuration: {e}', Colors.RED))

    def _handle_load_config(self, config_name: str) -> None:
        """Load a config file by name."""
        if not self.strummer_config_dir:
            print(colored('[Load Config] No config directory set', Colors.RED))
            return

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Load Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(config_path):
            print(colored(f'[Load Config] Config file not found: {config_name}', Colors.RED))
            return

        try:
            self.config = MidiStrummerConfig.from_json_file(config_path)
            self.strummer_config_path = config_path
            self.current_config_name = config_name

            # Re-apply strummer settings
            self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)
            self._setup_notes()
            self.actions.set_action_rules_config(self.config.strummer.action_rules)
            self.actions.execute_startup_rules()

            print(colored(f'[Load Config] Loaded config: {config_name}', Colors.GREEN))

            # Broadcast with is_saved_state=True since we just loaded from file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Load Config] Failed to load config: {e}', Colors.RED))

    def _handle_create_config(self, config_name: str) -> None:
        """Create a new config file with default values."""
        if not self.strummer_config_dir:
            print(colored('[Create Config] No config directory set', Colors.RED))
            return

        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Create Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if os.path.exists(config_path):
            print(colored(f'[Create Config] Config file already exists: {config_name}', Colors.RED))
            return

        try:
            new_config = MidiStrummerConfig()
            config_dict = new_config.to_dict()
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_dict, f, indent=2)

            # Set permissions to 0o666 to allow editing when created as root
            if os.geteuid() == 0:
                os.chmod(config_path, 0o666)

            print(colored(f'[Create Config] Created new config: {config_name}', Colors.GREEN))

            # Switch to the newly created config
            self.strummer_config_path = config_path
            self.current_config_name = config_name
            self.config = new_config

            # Broadcast with is_saved_state=True since we just created/saved the file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Create Config] Failed to create config: {e}', Colors.RED))

    def _handle_rename_config(self, old_name: str, new_name: str) -> None:
        """Rename a config file."""
        if not self.strummer_config_dir:
            print(colored('[Rename Config] No config directory set', Colors.RED))
            return

        # Ensure names end with .json
        if not old_name.endswith('.json'):
            old_name = old_name + '.json'
        if not new_name.endswith('.json'):
            new_name = new_name + '.json'

        old_path = os.path.join(self.strummer_config_dir, old_name)
        new_path = os.path.join(self.strummer_config_dir, new_name)

        # Security check: ensure paths are within the config directory
        resolved_old_path = os.path.abspath(old_path)
        resolved_new_path = os.path.abspath(new_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_old_path.startswith(resolved_dir) or not resolved_new_path.startswith(resolved_dir):
            print(colored('[Rename Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(old_path):
            print(colored(f'[Rename Config] Config file not found: {old_name}', Colors.RED))
            return

        if os.path.exists(new_path):
            print(colored(f'[Rename Config] Config file already exists: {new_name}', Colors.RED))
            return

        try:
            os.rename(old_path, new_path)

            # Update current config path if we renamed the current config
            if self.current_config_name == old_name:
                self.strummer_config_path = new_path
                self.current_config_name = new_name

            print(colored(f'[Rename Config] Renamed {old_name} to {new_name}', Colors.GREEN))

            # Broadcast updated config list to all clients
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Rename Config] Failed to rename config: {e}', Colors.RED))

    def _handle_upload_config(self, config_name: str, config_data: Any) -> None:
        """Upload a config file (save uploaded data as a new config) and switch to it."""
        if not self.strummer_config_dir:
            print(colored('[Upload Config] No config directory set', Colors.RED))
            return

        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Upload Config] Invalid config path - path traversal detected', Colors.RED))
            return

        try:
            # Parse and validate the config data
            parsed_config = MidiStrummerConfig.from_dict(config_data)

            # Write the config file
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2)

            # Set permissions to 0o666 to allow editing when created as root
            if os.geteuid() == 0:
                os.chmod(config_path, 0o666)

            print(colored(f'[Upload Config] Uploaded config: {config_name}', Colors.GREEN))

            # Switch to the uploaded config
            self.strummer_config_path = config_path
            self.current_config_name = config_name
            self.config = parsed_config

            # Re-apply settings from the new config
            self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)
            self._setup_notes()
            self.actions.set_action_rules_config(self.config.strummer.action_rules)
            self.actions.execute_startup_rules()

            # Broadcast with is_saved_state=True since we just saved the file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Upload Config] Failed to upload config: {e}', Colors.RED))

    def _handle_delete_config(self, config_name: str) -> None:
        """Delete a config file."""
        if not self.strummer_config_dir:
            print(colored('[Delete Config] No config directory set', Colors.RED))
            return

        # Don't allow deleting the currently loaded config
        if self.current_config_name == config_name:
            print(colored('[Delete Config] Cannot delete the currently loaded config', Colors.RED))
            return

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Delete Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(config_path):
            print(colored(f'[Delete Config] Config file not found: {config_name}', Colors.RED))
            return

        try:
            os.remove(config_path)
            print(colored(f'[Delete Config] Deleted config: {config_name}', Colors.GREEN))

            # Broadcast updated config list to all clients
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Delete Config] Failed to delete config: {e}', Colors.RED))

    def _set_config_value(self, path: str, value: Any) -> None:
        """
        Set a config value using dot-notation path.

        Args:
            path: Dot-notation path (e.g., 'strummer.strumming.upperNoteSpread')
            value: The value to set
        """
        parts = path.split('.')

        # Navigate to the parent object
        current: Any = self.config
        for i, part in enumerate(parts[:-1]):
            # Convert camelCase to snake_case for Python attribute access
            snake_part = self._camel_to_snake(part)
            if hasattr(current, snake_part):
                current = getattr(current, snake_part)
            elif hasattr(current, part):
                current = getattr(current, part)
            elif isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, dict) and snake_part in current:
                current = current[snake_part]
            else:
                raise ValueError(f"Invalid path: {path} (failed at '{part}')")

        # Set the value on the final attribute
        last_part = parts[-1]
        snake_last = self._camel_to_snake(last_part)

        # Convert dict values to proper config objects for known complex types
        if isinstance(value, dict):
            value = self._convert_dict_to_config(snake_last, value)

        if hasattr(current, snake_last):
            setattr(current, snake_last, value)
        elif hasattr(current, last_part):
            setattr(current, last_part, value)
        elif isinstance(current, dict):
            # Try snake_case first, then camelCase
            if snake_last in current:
                current[snake_last] = value
            else:
                current[last_part] = value
        else:
            raise ValueError(f"Cannot set value at path: {path}")

    def _camel_to_snake(self, name: str) -> str:
        """Convert camelCase to snake_case"""
        import re
        # Insert underscore before uppercase letters and convert to lowercase
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def _convert_dict_to_config(self, attr_name: str, value: Dict[str, Any]) -> Any:
        """
        Convert a dict value to the appropriate config object based on attribute name.

        Args:
            attr_name: The snake_case attribute name being set
            value: The dict value to convert

        Returns:
            The converted config object, or the original dict if no conversion needed
        """
        from ..models.action_rules import ActionRulesConfig
        from ..models.strummer_features import StrumReleaseConfig
        from ..models.strummer_config import StrummingConfig
        from ..models.parameter_mapping import ParameterMapping

        converters = {
            'action_rules': ActionRulesConfig.from_dict,
            'strum_release': StrumReleaseConfig.from_dict,
            'strumming': StrummingConfig.from_dict,
            'note_duration': ParameterMapping.from_dict,
            'pitch_bend': ParameterMapping.from_dict,
            'note_velocity': ParameterMapping.from_dict,
        }

        converter = converters.get(attr_name)
        if converter:
            return converter(value)
        return value

    def handle_packet(self, data: bytes) -> None:
        """Handle incoming HID packet"""
        try:
            # Process the data using the config
            events = self.process_packet(data)

            # Extract normalized values
            x = float(events.get('x', 0))
            y = float(events.get('y', 0))
            pressure = float(events.get('pressure', 0))
            state = str(events.get('state', 'unknown'))
            tilt_x = float(events.get('tiltX', 0))
            tilt_y = float(events.get('tiltY', 0))
            # Calculate combined tilt
            tilt_xy = (tilt_x + tilt_y) / 2.0 if (tilt_x != 0 or tilt_y != 0) else 0.0
            tilt_xy = max(-1.0, min(1.0, tilt_xy))
            primary_button = bool(events.get('primaryButton') or events.get('primaryButtonPressed'))
            secondary_button = bool(events.get('secondaryButton') or events.get('secondaryButtonPressed'))

            # Handle stylus button presses via action rules
            # Detect button down events (transition from not pressed to pressed)
            if primary_button and not self.button_state['primaryButtonPressed']:
                # Primary button just pressed
                self.actions.handle_button_event('button:primary', 'press')
            if not primary_button and self.button_state['primaryButtonPressed']:
                # Primary button just released
                self.actions.handle_button_event('button:primary', 'release')

            if secondary_button and not self.button_state['secondaryButtonPressed']:
                # Secondary button just pressed
                self.actions.handle_button_event('button:secondary', 'press')
            if not secondary_button and self.button_state['secondaryButtonPressed']:
                # Secondary button just released
                self.actions.handle_button_event('button:secondary', 'release')

            # Update stylus button states
            self.button_state['primaryButtonPressed'] = primary_button
            self.button_state['secondaryButtonPressed'] = secondary_button

            # Handle tablet hardware button presses via action rules (dynamic button count)
            for i in range(1, self.tablet_button_count + 1):
                button_key = f'button{i}'
                button_pressed = bool(events.get(button_key, False))
                was_pressed = self.tablet_button_state.get(button_key, False)

                # Detect button down event (transition from not pressed to pressed)
                if button_pressed and not was_pressed:
                    # Button just pressed - execute 'press' action via action rules system
                    self.actions.handle_button_event(f'button:{i}', 'press')

                # Detect button up event (transition from pressed to not pressed)
                if not button_pressed and was_pressed:
                    # Button just released - execute 'release' action via action rules system
                    self.actions.handle_button_event(f'button:{i}', 'release')

                # Update tablet button state
                self.tablet_button_state[button_key] = button_pressed

            # Apply pitch bend based on configuration (throttled to avoid MIDI flooding)
            pitch_bend_cfg = self.config.strummer.pitch_bend
            if pitch_bend_cfg and self.backend:
                # Get the control input value based on the control setting
                control_value = self._get_control_value(pitch_bend_cfg.control, events)
                if control_value is not None:
                    # Map the control value to pitch bend range
                    bend_value = pitch_bend_cfg.map_value(control_value)

                    # Throttle pitch bend to max 50 messages per second (20ms interval)
                    # to avoid overwhelming the MIDI output
                    current_time = time.time()
                    if not hasattr(self, '_last_pitch_bend_time'):
                        self._last_pitch_bend_time = 0
                        self._last_pitch_bend_value = None

                    # Only send if enough time has passed OR value changed significantly
                    time_since_last = current_time - self._last_pitch_bend_time
                    value_changed = (self._last_pitch_bend_value is None or
                                   abs(bend_value - self._last_pitch_bend_value) > 0.01)

                    if time_since_last >= 0.02 or (value_changed and time_since_last >= 0.005):
                        self.backend.send_pitch_bend(bend_value)
                        self._last_pitch_bend_time = current_time
                        self._last_pitch_bend_value = bend_value

            # Calculate dynamic note duration based on configuration
            note_duration_cfg = self.config.strummer.note_duration
            if note_duration_cfg:
                control_value = self._get_control_value(note_duration_cfg.control, events)
                if control_value is not None:
                    current_note_duration = note_duration_cfg.map_value(control_value)
                else:
                    current_note_duration = note_duration_cfg.default
            else:
                current_note_duration = self.config.note_duration

            # Get note velocity configuration for applying curve
            note_velocity_cfg = self.config.strummer.note_velocity

            # Extract tablet hardware buttons (dynamic based on device capabilities)
            tablet_buttons = int(events.get('tabletButtons', 0))
            buttons_dict: Dict[str, bool] = {}
            for i in range(1, self.tablet_button_count + 1):
                button_key = f'button{i}'
                buttons_dict[button_key] = bool(events.get(button_key, False))

            # Create tablet event data
            tablet_data = TabletEventData(
                x=x, y=y, pressure=pressure, state=state,
                tiltX=tilt_x, tiltY=tilt_y, tiltXY=tilt_xy,
                primaryButtonPressed=primary_button,
                secondaryButtonPressed=secondary_button,
                tabletButtons=tablet_buttons,
                buttons=buttons_dict
            )
            self.event_bus.emit_tablet_event(tablet_data)

            # Update strummer bounds (use normalized 0-1 range)
            self.strummer.update_bounds(1.0, 1.0)

            # Apply X inversion for left-handed use if configured
            strum_x = 1.0 - x if self.config.strummer.strumming.invert_x else x

            # Process strum
            event = self.strummer.strum(strum_x, pressure)

            # Get note repeater state from actions
            repeater_config = self.actions.get_repeater_config()
            note_repeater_enabled = repeater_config['active']
            pressure_multiplier = repeater_config['pressure_multiplier']
            frequency_multiplier = repeater_config['frequency_multiplier']

            # Get transpose state from actions
            transpose_enabled = self.actions.is_transpose_active()
            transpose_semitones = self.actions.get_transpose_semitones()

            if event:
                # Create strum event data
                # event is a dict: {'type': 'strum'|'release', 'notes': [{'note': NoteObject, 'velocity': int}], ...}
                event_type = event.get('type')
                strum_notes = []
                event_notes = event.get('notes', [])

                if event_type == 'strum' and event_notes:
                    # Track strum start time for strum release feature
                    # Only set on FIRST strum event (not subsequent strums across strings)
                    if self.strum_start_time == 0.0:
                        self.strum_start_time = time.time()

                    # Store notes for repeater and mark as holding
                    self.repeater_state['notes'] = event_notes
                    self.repeater_state['is_holding'] = True
                    self.repeater_state['last_repeat_time'] = time.time()

                    for note_data in event_notes:
                        note_obj = note_data['note']  # This is a NoteObject
                        raw_velocity = note_data['velocity']

                        # Apply velocity curve from note_velocity config
                        if note_velocity_cfg and raw_velocity > 0:
                            # Normalize velocity to 0-1 range
                            normalized_vel = raw_velocity / 127.0
                            # Apply the parameter mapping (includes curve)
                            velocity = int(note_velocity_cfg.map_value(normalized_vel))
                            # Clamp to MIDI range
                            velocity = max(1, min(127, velocity))
                        else:
                            velocity = raw_velocity

                        # Send MIDI note
                        if self.backend and velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note_obj
                            if transpose_enabled:
                                note_to_play = note_obj.transpose(transpose_semitones)
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=velocity,
                                duration=current_note_duration
                            )
                            self.notes_played += 1

                        strum_notes.append(StrumNoteEventData(
                            note=note_obj.to_midi(),
                            velocity=velocity,
                            name=note_obj.notation,
                            octave=note_obj.octave,
                            duration=current_note_duration
                        ))

                elif event_type == 'release':
                    # Stop holding - no more repeats
                    self.repeater_state['is_holding'] = False
                    self.repeater_state['notes'] = []

                    # Handle strum release - send configured MIDI note on quick releases
                    strum_release_cfg = self.config.strummer.strum_release
                    if strum_release_cfg and strum_release_cfg.active and self.backend and self.strum_start_time > 0:
                        strum_duration = time.time() - self.strum_start_time
                        max_duration = strum_release_cfg.max_duration if strum_release_cfg.max_duration else 0.25

                        # Only trigger release note if duration is within the max duration threshold
                        if strum_duration <= max_duration:
                            release_note = strum_release_cfg.midi_note
                            # Default to channel 9 (0-based, MIDI channel 10/drums) if not specified
                            release_channel = strum_release_cfg.midi_channel if strum_release_cfg.midi_channel is not None else 9
                            velocity_multiplier = strum_release_cfg.velocity_multiplier if strum_release_cfg.velocity_multiplier else 1.0

                            # Use the velocity from the strum and apply multiplier
                            base_velocity = event.get('velocity', 64)
                            release_velocity = int(base_velocity * velocity_multiplier)
                            # Clamp to MIDI range 1-127
                            release_velocity = max(1, min(127, release_velocity))

                            # Display channel as 1-based for user-friendliness
                            print(colored(f'[Strum Release] note={release_note} vel={release_velocity} ch={release_channel + 1} dur={strum_duration:.3f}s', Colors.CYAN))

                            # Send the raw MIDI note using the backend's send_raw_note method
                            if hasattr(self.backend, 'send_raw_note'):
                                self.backend.send_raw_note(
                                    midi_note=release_note,
                                    velocity=release_velocity,
                                    duration=strum_duration,
                                    channel=release_channel
                                )

                    # Reset strum start time
                    self.strum_start_time = 0.0

                strum_data = StrumEventData(
                    type=event.get('type', 'strum'),
                    notes=strum_notes,
                    velocity=event.get('velocity', strum_notes[0].velocity if strum_notes else 0),
                    x=x,
                    pressure=pressure
                )
                self.event_bus.emit_strum_event(strum_data)

            # Handle note repeater - fire repeatedly while holding
            # Only process if note repeater is explicitly enabled
            if note_repeater_enabled and self.repeater_state['is_holding'] and self.repeater_state['notes']:
                current_time = time.time()
                time_since_last_repeat = current_time - self.repeater_state['last_repeat_time']

                # Apply frequency multiplier to duration (higher = faster repeats)
                repeat_interval = current_note_duration / frequency_multiplier if frequency_multiplier > 0 else current_note_duration

                # Check if it's time for another repeat
                if time_since_last_repeat >= repeat_interval:
                    for note_data in self.repeater_state['notes']:
                        note_obj = note_data['note']
                        # Use the original note's velocity with pressure multiplier applied
                        original_velocity = note_data.get('velocity', 100)
                        raw_repeat_velocity = int(original_velocity * pressure_multiplier)
                        raw_repeat_velocity = max(1, min(127, raw_repeat_velocity))

                        # Apply velocity curve from note_velocity config
                        if note_velocity_cfg and raw_repeat_velocity > 0:
                            normalized_vel = raw_repeat_velocity / 127.0
                            repeat_velocity = int(note_velocity_cfg.map_value(normalized_vel))
                            repeat_velocity = max(1, min(127, repeat_velocity))
                        else:
                            repeat_velocity = raw_repeat_velocity

                        if self.backend and repeat_velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note_obj
                            if transpose_enabled:
                                note_to_play = note_obj.transpose(transpose_semitones)
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=repeat_velocity,
                                duration=current_note_duration
                            )

                    self.repeater_state['last_repeat_time'] = current_time

        except Exception as e:
            import traceback
            print(colored(f'Error processing packet: {e}', Colors.RED))
            traceback.print_exc()
    
    def handle_device_disconnect(self) -> None:
        """Handle device disconnection"""
        super().handle_device_disconnect()
        self.broadcast_status(False)
        print(colored('Device disconnected', Colors.YELLOW))
        
        # If poll_ms is set, attempt to reconnect
        if self.poll_ms is not None:
            self._attempt_reconnect()
    
    def _attempt_reconnect(self) -> None:
        """Attempt to reconnect to device"""
        if self.poll_ms is None:
            return
        
        print(colored(f'Attempting to reconnect (polling every {self.poll_ms}ms)...', Colors.YELLOW))
        
        while not self.is_running:
            time.sleep(self.poll_ms / 1000.0)
            try:
                # Try to find and connect to device
                search_dir = os.path.dirname(self.config_path) if hasattr(self, 'config_path') else DEFAULT_CONFIG_DIR
                found_config = find_config_for_device(search_dir)
                if found_config:
                    self.reconnect()
                    if self.is_running:
                        print(colored('Device reconnected!', Colors.GREEN))
                        self._initialize_tablet_button_state()
                        self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
                        break
            except Exception as e:
                pass  # Continue polling
    
    async def run_server(self) -> None:
        """Run the WebSocket and HTTP servers"""
        self._main_loop = asyncio.get_event_loop()
        http_server = None

        # Initialize MIDI output
        print(colored('Initializing MIDI output...', Colors.GRAY))
        if self._setup_midi():
            print(colored('✓ MIDI output initialized', Colors.GREEN))
            self._print_midi_config()
        else:
            print(colored('⚠ MIDI not available - running without MIDI output', Colors.YELLOW))

        # Initialize MIDI input (for external keyboard)
        # If midi_input_id is None, listens to ALL ports (discovery mode)
        # If midi_input_id is specified, connects only to that port
        print(colored('Initializing MIDI input...', Colors.GRAY))
        if self._setup_midi_input():
            input_port = self.config.midi.midi_input_id
            if input_port is None:
                port_info = f"listening to all ports ({len(self.midi_input.connected_ports) if self.midi_input else 0} found)"
            else:
                port_info = self.midi_input.current_input_name if self.midi_input else str(input_port)
            print(colored(f'✓ MIDI input: {port_info}', Colors.GREEN))
        else:
            print(colored('⚠ No MIDI input ports available', Colors.YELLOW))

        # Start event bus
        self.event_bus.start(self._main_loop)

        # Pause event bus initially (no clients)
        self.event_bus.pause()

        # Get local IP for LAN access URLs
        local_ip = get_local_ip()

        # Start HTTP server if port is configured
        if self.http_port:
            http_server = await asyncio.start_server(
                self._handle_http_request,
                "0.0.0.0",
                self.http_port
            )
            print(colored(f'✓ HTTP server listening on port {self.http_port}', Colors.GREEN))
            print(colored(f'  Serving: {self.public_dir}', Colors.CYAN))
            # Use ANSI underline (\033[4m) to make URLs visually clickable
            UNDERLINE = '\033[4m'
            RESET = '\033[0m'
            print(colored(f'  Local:   ', Colors.WHITE) + f'{UNDERLINE}{Colors.BLUE}http://localhost:{self.http_port}{RESET}')
            if local_ip:
                print(colored(f'  Network: ', Colors.WHITE) + f'{UNDERLINE}{Colors.BLUE}http://{local_ip}:{self.http_port}{RESET}')

        # Start WebSocket server
        self.server = await websockets.serve(
            self._handle_client,
            "0.0.0.0",
            self.ws_port
        )

        print(colored(f'✓ WebSocket server listening on port {self.ws_port}', Colors.GREEN))
        print(colored(f'  Throttle: {self.event_bus.throttle_ms}ms', Colors.CYAN))
        print(colored(f'  Local:   ', Colors.WHITE) + f'{UNDERLINE}{Colors.MAGENTA}ws://localhost:{self.ws_port}{RESET}')
        if local_ip:
            print(colored(f'  Network: ', Colors.WHITE) + f'{UNDERLINE}{Colors.MAGENTA}ws://{local_ip}:{self.ws_port}{RESET}')
        print(colored('Press Ctrl+C to stop', Colors.GRAY))

        # Start reading tablet data in a separate thread
        import threading
        tablet_thread = threading.Thread(target=self._run_tablet_reader, daemon=True)
        tablet_thread.start()

        # Keep server running
        try:
            await asyncio.Future()  # Run forever
        except asyncio.CancelledError:
            pass
        finally:
            self.event_bus.cleanup()
            if http_server:
                http_server.close()
                await http_server.wait_closed()
            if self.server:
                self.server.close()
                await self.server.wait_closed()

    def _run_tablet_reader(self) -> None:
        """Run tablet reader in a separate thread"""
        # If tablet wasn't initialized (no device found at startup), poll for it first
        if not self._tablet_initialized:
            print(colored('Tablet not initialized at startup, starting poll...', Colors.YELLOW))
            self._poll_and_initialize_tablet()
            if not self._tablet_initialized:
                print(colored('Failed to initialize tablet after polling', Colors.RED))
                return  # Still no device, give up

        print(colored('Starting tablet reader...', Colors.CYAN))
        try:
            # Initialize the HID reader
            self.initialize_reader_sync()

            if not self.reader:
                raise RuntimeError('Reader not initialized')

            # Initialize button state based on device capabilities
            self._initialize_tablet_button_state()

            # Start reading data
            if hasattr(self.reader, 'start_reading'):
                self.reader.start_reading(lambda data: self.handle_packet(data))

            self.is_running = True
            self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
            print(colored('✓ Tablet reader started', Colors.GREEN))

            # Keep thread alive while running
            while self.is_running:
                time.sleep(0.1)

        except Exception as e:
            print(colored(f'Tablet reader error: {e}', Colors.RED))
            import traceback
            traceback.print_exc()
            if self.poll_ms is not None:
                self._attempt_reconnect()

    def _poll_and_initialize_tablet(self) -> None:
        """Poll for device and initialize tablet reader when found"""
        if self.poll_ms is None:
            return

        print(colored('Waiting for tablet device to be connected...', Colors.YELLOW))
        print(colored(f'Poll interval: {self.poll_ms}ms', Colors.GRAY))

        while True:
            found_config = find_config_for_device(self.search_dir)
            if found_config:
                print(colored(f'Device connected! Using config: {found_config}', Colors.GREEN))
                try:
                    # Initialize the tablet reader with the found config
                    TabletReaderBase.__init__(self, found_config)
                    self._tablet_initialized = True
                    self._initialize_tablet_button_state()
                    self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
                    print(colored('Tablet reader initialized successfully', Colors.GREEN))
                    return
                except Exception as e:
                    print(colored(f'Failed to initialize tablet reader: {e}', Colors.RED))
                    # Continue polling
            time.sleep(self.poll_ms / 1000.0)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Strummer WebSocket Server - broadcasts tablet and strum events via WebSocket',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '-c', '--config',
        dest='config',
        metavar='PATH',
        help='Combined config file path (strummer, MIDI, and server settings). Device path is specified in server.device field.'
    )
    
    parser.add_argument(
        '--ws-port',
        type=int,
        default=8081,
        help='WebSocket server port (default: 8081)'
    )

    parser.add_argument(
        '--http-port',
        type=int,
        help='HTTP server port for serving webapps (optional)'
    )
    
    parser.add_argument(
        '-t', '--throttle',
        type=int,
        default=150,
        metavar='MS',
        help='Event throttle interval in milliseconds (default: 150)'
    )
    
    parser.add_argument(
        '--poll',
        type=int,
        metavar='MS',
        help='Poll interval in milliseconds for waiting for device. If not set, quit if no device found.'
    )

    # MIDI options
    parser.add_argument(
        '-j', '--jack',
        action='store_true',
        help='Use JACK MIDI backend instead of rtmidi'
    )

    parser.add_argument(
        '--channel',
        type=int,
        metavar='N',
        help='MIDI channel (0-15)'
    )

    parser.add_argument(
        '-p', '--port',
        dest='midi_port',
        metavar='PORT',
        help='MIDI output port (name or index)'
    )

    parser.add_argument(
        '-d', '--duration',
        type=float,
        dest='note_duration',
        metavar='SECONDS',
        help='Note duration in seconds'
    )

    parser.add_argument(
        '--jack-client-name',
        dest='jack_client_name',
        metavar='NAME',
        help='JACK client name'
    )

    parser.add_argument(
        '--jack-auto-connect',
        dest='jack_auto_connect',
        metavar='TARGET',
        help='JACK auto-connect target'
    )

    # Debug/test options
    parser.add_argument(
        '--dump-config',
        action='store_true',
        dest='dump_config',
        help='Load config, print as JSON, and exit (for testing)'
    )

    args = parser.parse_args()

    # Load config early to get server settings (CLI args take precedence)
    config = None
    config_path = None
    config_dir = None
    if args.config:
        config_path = os.path.abspath(args.config)
        config_dir = os.path.dirname(config_path)
        config = MidiStrummerConfig.from_json_file(config_path)

    # Handle --dump-config: print config as JSON and exit
    if args.dump_config:
        if config is None:
            config = MidiStrummerConfig()
        print(json.dumps(config.to_dict(), indent=2))
        sys.exit(0)

    # Resolve effective server settings (CLI args take precedence over config file)
    effective_ws_port = args.ws_port if args.ws_port != 8081 else (
        config.ws_port if config and config.ws_port else 8081
    )
    effective_http_port = args.http_port or (
        config.http_port if config else None
    )
    effective_throttle = args.throttle if args.throttle != 150 else (
        config.ws_message_throttle if config else 150
    )
    effective_poll = args.poll or (
        config.device_finding_poll_interval if config else None
    )

    # Get device path from config (defaults to "devices" folder relative to config)
    device_path = config.server.device if config else None

    # Resolve device config path (returns tuple: config_path or None, search_dir)
    # Use config file's directory as base for resolving relative device paths
    device_config_path, search_dir = resolve_device_config_path(
        device_path,
        base_dir=config_dir,
        poll_ms=effective_poll
    )

    print(colored(f'=== Strummer WebSocket Server v{SKETCHATONE_VERSION} ===', Colors.CYAN))
    if config_path:
        print(colored(f'Config: {config_path}', Colors.GRAY))
    if device_config_path:
        print(colored(f'Device config: {device_config_path}', Colors.GRAY))
    else:
        print(colored(f'Device config: (waiting for device)', Colors.YELLOW))
        print(colored(f'Search directory: {search_dir}', Colors.GRAY))
    print(colored(f'WebSocket port: {effective_ws_port}', Colors.GRAY))
    if effective_http_port:
        print(colored(f'HTTP port: {effective_http_port}', Colors.GRAY))
    print(colored(f'Throttle: {effective_throttle}ms', Colors.GRAY))
    if effective_poll:
        print(colored(f'Poll interval: {effective_poll}ms', Colors.GRAY))
    print()

    # Parse MIDI port (could be int or string)
    midi_port = args.midi_port
    if midi_port is not None:
        try:
            midi_port = int(midi_port)
        except ValueError:
            pass  # Keep as string (port name)

    # Create and run server
    server = StrummerWebSocketServer(
        tablet_config_path=device_config_path,
        strummer_config_path=config_path,
        ws_port=effective_ws_port,
        http_port=effective_http_port,
        throttle_ms=effective_throttle,
        poll_ms=effective_poll,
        search_dir=search_dir,
        # MIDI options
        use_jack=args.jack if args.jack else None,
        midi_channel=args.channel,
        midi_port=midi_port,
        note_duration=args.note_duration,
        jack_client_name=args.jack_client_name,
        jack_auto_connect=args.jack_auto_connect
    )

    # Flag to track shutdown
    shutdown_requested = False

    def shutdown_handler(signum, frame):
        """Handle shutdown signals"""
        nonlocal shutdown_requested
        if shutdown_requested:
            # Force exit on second signal
            print(colored('\nForce shutdown...', Colors.RED))
            if server._tablet_initialized:
                server.stop_sync()
            sys.exit(1)
        shutdown_requested = True
        print(colored('\nShutting down...', Colors.YELLOW))
        # Stop the server
        server.is_running = False
        if server._tablet_initialized:
            server.stop_sync()
        # Cancel the main asyncio task to trigger clean shutdown
        if server._main_loop and server._main_loop.is_running():
            # Schedule cancellation of all tasks
            for task in asyncio.all_tasks(server._main_loop):
                server._main_loop.call_soon_threadsafe(task.cancel)

    # Register signal handlers
    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        pass  # Handled by signal handler
    except SystemExit:
        pass  # Expected from signal handler


if __name__ == '__main__':
    main()
