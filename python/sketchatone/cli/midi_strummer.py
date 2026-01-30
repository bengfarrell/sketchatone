#!/usr/bin/env python3
"""
MIDI Strummer CLI

A CLI tool that reads tablet events via HID and outputs MIDI notes.
Combines the Strummer with MIDI backends (rtmidi or JACK).

Usage:
    # Using combined config file (strummer, MIDI, and server settings)
    python -m sketchatone.cli.midi_strummer -c config.json

    # Auto-detect device from default config directory
    python -m sketchatone.cli.midi_strummer

    # Override specific settings via CLI
    python -m sketchatone.cli.midi_strummer -c config.json --jack --channel 1
"""

import argparse
import sys
import os
import time
from typing import Optional, Dict, Any, List, Union

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone.strummer.strummer import Strummer
from sketchatone.strummer.actions import Actions
from sketchatone.models.strummer_config import StrummerConfig
from sketchatone.models.midi_config import MidiConfig
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
from sketchatone.models.note import Note, NoteObject
from sketchatone.midi.bridge import MidiStrummerBridge
from sketchatone.midi.protocol import MidiBackendProtocol

# Import blankslate's TabletReaderBase
try:
    from blankslate.cli.tablet_reader_base import TabletReaderBase, Colors, colored
    from blankslate.utils.finddevice import find_config_for_device
except ImportError:
    print("Error: blankslate package not found.")
    print("Make sure blankslate is installed: pip install -e ../blankslate/python")
    sys.exit(1)

# Default config directory (relative to python/ directory)
DEFAULT_CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '..', 'public', 'configs')


def resolve_device_config_path(
    device_path: str | None,
    base_dir: str | None = None,
    default_dir: str = DEFAULT_CONFIG_DIR
) -> str:
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

    Returns:
        Resolved config file path

    Raises:
        SystemExit: If no matching config is found
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
            return device_path
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
            return resolved_path
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
        return found_config
    else:
        print(colored(f'Error: No matching device config found in: {search_dir}', Colors.RED))
        sys.exit(1)


def create_bar(value: float, max_val: float, width: int) -> str:
    """Create a progress bar"""
    filled = int((value / max_val) * width) if max_val > 0 else 0
    filled = min(filled, width)
    empty = width - filled
    bar = colored('█' * filled, Colors.GREEN) + colored('░' * empty, Colors.GRAY)
    return f'[{bar}]'


def strip_ansi(text: str) -> str:
    """Strip ANSI escape codes from text"""
    import re
    return re.sub(r'\033\[[0-9;]*m', '', text)


def pad_line(content: str, target_len: int) -> str:
    """Pad line content accounting for ANSI codes"""
    visible_len = len(strip_ansi(content))
    padding = max(0, target_len - visible_len)
    return content + ' ' * padding


class MidiStrummer(TabletReaderBase):
    """
    MIDI Strummer that reads tablet input and outputs MIDI notes.
    """

    def __init__(
        self,
        tablet_config_path: str,
        strummer_config_path: Optional[str] = None,
        live_mode: bool = False,
        # CLI overrides (take precedence over config file)
        use_jack: Optional[bool] = None,
        midi_channel: Optional[int] = None,
        midi_port: Optional[Union[int, str]] = None,
        note_duration: Optional[float] = None,
        jack_client_name: Optional[str] = None,
        jack_auto_connect: Optional[str] = None
    ):
        super().__init__(tablet_config_path, exit_on_stop=True)
        self.live_mode = live_mode
        self.last_event: Optional[Dict[str, Any]] = None
        self.last_live_update = 0
        self.notes_played = 0

        # Load combined config from file or use defaults
        if strummer_config_path:
            self.config = MidiStrummerConfig.from_json_file(strummer_config_path)
        else:
            self.config = MidiStrummerConfig()

        # Apply CLI overrides
        if use_jack is not None:
            self.config.midi_output_backend = "jack" if use_jack else "rtmidi"
        if midi_channel is not None:
            self.config.channel = midi_channel
        if midi_port is not None:
            self.config.midi_output_id = midi_port
        if note_duration is not None:
            self.config.note_duration = note_duration
        if jack_client_name is not None:
            self.config.jack_client_name = jack_client_name
        if jack_auto_connect is not None:
            self.config.jack_auto_connect = jack_auto_connect

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(
            pluck_velocity_scale=self.config.velocity_scale,
            pressure_threshold=self.config.pressure_threshold
        )

        # Set up notes
        self._setup_notes()

        # MIDI backend and bridge (initialized in start())
        self.backend: Optional[MidiBackendProtocol] = None
        self.bridge: Optional[MidiStrummerBridge] = None

        # Create Actions handler for stylus buttons
        # Pass a dict with properly nested config references since MidiStrummerConfig
        # has note_repeater/transpose at strummer.note_repeater, not directly
        self.actions = Actions(
            config={
                'note_repeater': self.config.strummer.note_repeater,
                'transpose': self.config.strummer.transpose,
                'lower_spread': self.config.lower_spread,
                'upper_spread': self.config.upper_spread,
            },
            strummer=self.strummer
        )

        # State tracking for stylus buttons
        self.button_state = {
            'primaryButtonPressed': False,
            'secondaryButtonPressed': False
        }

        # State tracking for tablet hardware buttons (1-8)
        self.tablet_button_state = {f'button{i}': False for i in range(1, 9)}

        # State tracking for note repeater
        self.repeater_state = {
            'notes': [],
            'last_repeat_time': 0.0,
            'is_holding': False
        }

    def _setup_notes(self):
        """Set up the strummer notes from config"""
        notes: List[NoteObject] = []

        if self.config.chord:
            chord_notes = Note.parse_chord(self.config.chord)
            notes = Note.fill_note_spread(
                chord_notes,
                self.config.lower_spread,
                self.config.upper_spread
            )
        else:
            for note_str in self.config.notes:
                notes.append(Note.parse_notation(note_str))

        self.strummer.notes = notes

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

    def print_config_info(self):
        """Print configuration info"""
        print(colored('─' * 50, Colors.CYAN))
        print(colored('Strummer Config:', Colors.WHITE, bold=True))
        print(colored('  Pressure Threshold: ', Colors.CYAN) +
              colored(str(self.config.pressure_threshold), Colors.WHITE))
        print(colored('  Notes: ', Colors.CYAN) +
              colored(', '.join(self.config.notes), Colors.WHITE))
        if self.config.chord:
            print(colored('  Chord: ', Colors.CYAN) +
                  colored(self.config.chord, Colors.WHITE))
        print()
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
        print(colored('─' * 50, Colors.CYAN))
        print()

    def start(self):
        """Start the MIDI strummer"""
        self.print_header('MIDI Strummer')
        self.print_config_info()

        # Initialize MIDI
        print(colored('Initializing MIDI...', Colors.GRAY))
        if not self._setup_midi():
            sys.exit(1)
        print(colored('✓ MIDI initialized', Colors.GREEN))

        # Initialize tablet reader
        print(colored('Initializing tablet reader...', Colors.GRAY))
        self.initialize_reader_sync()

        if not self.reader:
            raise RuntimeError('Reader not initialized')

        # Start reading
        if hasattr(self.reader, 'start_reading'):
            self.reader.start_reading(lambda data: self.handle_packet(data))

        print(colored('✓ Started reading tablet data', Colors.GREEN))
        print(colored('Press Ctrl+C to stop\n', Colors.GRAY))

        self.is_running = True

        if self.live_mode:
            # Clear screen for live mode
            sys.stdout.write('\033[2J\033[H')
            sys.stdout.flush()

        # Keep process alive
        try:
            while self.is_running:
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_sync()

    def stop_sync(self):
        """Stop and clean up"""
        # Clean up MIDI
        if self.bridge:
            self.bridge.release_all()
            self.bridge.disconnect()
        if self.backend:
            self.backend.disconnect()

        super().stop_sync()

    def handle_packet(self, data: bytes):
        """Handle incoming HID packet"""
        try:
            self.packet_count += 1

            # Process the data using the config
            events = self.process_packet(data)

            # Extract normalized values
            x = float(events.get('x', 0))
            y = float(events.get('y', 0))
            pressure = float(events.get('pressure', 0))
            state = str(events.get('state', 'unknown'))

            # Handle stylus button presses
            primary_pressed = bool(events.get('primaryButtonPressed', False))
            secondary_pressed = bool(events.get('secondaryButtonPressed', False))

            # Get stylus button configuration
            stylus_buttons_cfg = self.config.strummer.stylus_buttons

            # Detect button down events (transition from not pressed to pressed)
            if stylus_buttons_cfg and stylus_buttons_cfg.active:
                if primary_pressed and not self.button_state['primaryButtonPressed']:
                    # Primary button just pressed
                    action = stylus_buttons_cfg.primary_button_action
                    self.actions.execute(action, context={'button': 'Primary'})

                if secondary_pressed and not self.button_state['secondaryButtonPressed']:
                    # Secondary button just pressed
                    action = stylus_buttons_cfg.secondary_button_action
                    self.actions.execute(action, context={'button': 'Secondary'})

            # Update stylus button states
            self.button_state['primaryButtonPressed'] = primary_pressed
            self.button_state['secondaryButtonPressed'] = secondary_pressed

            # Handle tablet hardware button presses (buttons 1-8)
            tablet_buttons_cfg = self.config.strummer.tablet_buttons
            for i in range(1, 9):
                button_key = f'button{i}'
                button_pressed = bool(events.get(button_key, False))

                # Detect button down event (transition from not pressed to pressed)
                if button_pressed and not self.tablet_button_state[button_key]:
                    # Button just pressed - execute configured action
                    action = tablet_buttons_cfg.get_button_action(i) if tablet_buttons_cfg else None
                    if action:
                        self.actions.execute(action, context={'button': f'Tablet{i}'})

                # Update tablet button state
                self.tablet_button_state[button_key] = button_pressed

            # Apply pitch bend based on configuration
            pitch_bend_cfg = self.config.strummer.pitch_bend
            if pitch_bend_cfg and self.backend:
                # Get the control input value based on the control setting
                control_value = self._get_control_value(pitch_bend_cfg.control, events)
                if control_value is not None:
                    # Map the control value to pitch bend range
                    bend_value = pitch_bend_cfg.map_value(control_value)
                    self.backend.send_pitch_bend(bend_value)

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

            # Update strummer bounds
            self.strummer.update_bounds(1.0, 1.0)

            # Process strum
            event = self.strummer.strum(x, pressure)

            # Get note repeater configuration
            note_repeater_cfg = self.config.strummer.note_repeater
            note_repeater_enabled = note_repeater_cfg.active if note_repeater_cfg else False
            pressure_multiplier = note_repeater_cfg.pressure_multiplier if note_repeater_cfg else 1.0
            frequency_multiplier = note_repeater_cfg.frequency_multiplier if note_repeater_cfg else 1.0

            # Get transpose state from actions
            transpose_enabled = self.actions.is_transpose_active()
            transpose_semitones = self.actions.get_transpose_semitones()

            if event:
                self.last_event = event
                event_type = event.get('type')

                if event_type == 'strum':
                    # Store notes for repeater and mark as holding
                    self.repeater_state['notes'] = event.get('notes', [])
                    self.repeater_state['is_holding'] = True
                    self.repeater_state['last_repeat_time'] = time.time()

                    # Send MIDI notes
                    notes_data = event.get('notes', [])
                    for note_data in notes_data:
                        note = note_data.get('note')
                        raw_velocity = note_data.get('velocity', 100)

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

                        if note and self.backend and velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note
                            if transpose_enabled:
                                note_to_play = note.transpose(transpose_semitones)
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=velocity,
                                duration=current_note_duration
                            )
                            self.notes_played += 1

                    if not self.live_mode:
                        self._print_strum_event(event, x, y, pressure)

                elif event_type == 'release':
                    # Stop holding - no more repeats
                    self.repeater_state['is_holding'] = False
                    self.repeater_state['notes'] = []

                    if not self.live_mode:
                        self._print_release_event(event, x, y, pressure)

            # Handle note repeater - fire repeatedly while holding
            if note_repeater_enabled and self.repeater_state['is_holding'] and self.repeater_state['notes']:
                current_time = time.time()
                time_since_last_repeat = current_time - self.repeater_state['last_repeat_time']

                # Apply frequency multiplier to duration (higher = faster repeats)
                repeat_interval = current_note_duration / frequency_multiplier if frequency_multiplier > 0 else current_note_duration

                # Check if it's time for another repeat
                if time_since_last_repeat >= repeat_interval:
                    for note_data in self.repeater_state['notes']:
                        note = note_data.get('note')
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

                        if note and self.backend and repeat_velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note
                            if transpose_enabled:
                                note_to_play = note.transpose(transpose_semitones)
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=repeat_velocity,
                                duration=current_note_duration
                            )

                    self.repeater_state['last_repeat_time'] = current_time

            # Update live display
            if self.live_mode:
                now = time.time()
                if now - self.last_live_update >= 0.05:  # 20 FPS
                    self.last_live_update = now
                    self._print_live_dashboard(x, y, pressure, state)

        except Exception as e:
            if not self.live_mode:
                print(colored(f'Error processing packet: {e}', Colors.RED))

    def _print_strum_event(self, event: Dict[str, Any], x: float, y: float, pressure: float):
        """Print a strum event"""
        notes = event.get('notes', [])
        note_strs = []
        for n in notes:
            note = n.get('note')
            vel = n.get('velocity', 0)
            if note:
                note_strs.append(f"{note.notation}{note.octave}(v{vel})")

        coords = colored(f'X: {x:.4f} Y: {y:.4f} P: {pressure:.4f}', Colors.GRAY)
        print(colored('♪ STRUM ', Colors.GREEN, bold=True) +
              colored(' '.join(note_strs), Colors.WHITE) +
              colored(' → MIDI ', Colors.CYAN) +
              coords)

    def _print_release_event(self, event: Dict[str, Any], x: float, y: float, pressure: float):
        """Print a release event"""
        vel = event.get('velocity', 0)
        coords = colored(f'X: {x:.4f} Y: {y:.4f} P: {pressure:.4f}', Colors.GRAY)
        print(colored('↑ RELEASE ', Colors.YELLOW) +
              colored(f'(velocity: {vel}) ', Colors.GRAY) +
              coords)

    def _print_live_dashboard(self, x: float, y: float, pressure: float, state: str):
        """Print live dashboard"""
        HIDE_CURSOR = '\033[?25l'
        MOVE_HOME = '\033[H'
        CLEAR_LINE = '\033[2K'

        lines = []
        border = colored('│', Colors.CYAN, bold=True)
        box_width = 63

        # Header
        lines.append(colored('┌' + '─' * box_width + '┐', Colors.CYAN, bold=True))
        lines.append(border + colored('                        MIDI STRUMMER                           ', Colors.WHITE, bold=True) + border)
        lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))

        # Status line
        backend_name = self.config.midi_output_backend
        status = f"Backend: {backend_name}  Notes played: {self.notes_played}"
        state_color = Colors.GREEN if state == 'contact' else Colors.YELLOW if state == 'hover' else Colors.GRAY
        state_str = colored(state, state_color, bold=True)
        lines.append(border + ' ' + pad_line(f"{status}  State: {state_str}", box_width - 1) + border)

        # Pressure bar
        p_pct = f"{pressure * 100:.0f}%".rjust(4)
        pressure_bar = create_bar(pressure, 1.0, 20)
        threshold = self.strummer.pressure_threshold
        is_pressed = pressure >= threshold
        pressure_label = colored('PRESSED', Colors.GREEN, bold=True) if is_pressed else '       '
        lines.append(border + ' ' + pad_line(f"Pressure: {p_pct} {pressure_bar} {pressure_label}", box_width - 1) + border)

        lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))

        # String visualization
        num_strings = len(self.strummer.notes)
        if num_strings > 0:
            string_width = 1.0 / num_strings
            current_string = min(int(x / string_width), num_strings - 1) if string_width > 0 else 0
            string_spacing = (box_width - 4) // num_strings
            total_width = string_spacing * num_strings
            left_pad = (box_width - total_width) // 2

            # String rows
            for row in range(5):
                row_content = ' ' * left_pad
                for i in range(num_strings):
                    is_current = i == current_string
                    is_strummed = is_current and is_pressed

                    if is_strummed:
                        char = colored('╋' if row == 2 else '║', Colors.GREEN, bold=True)
                    elif is_current:
                        char = colored('┃', Colors.YELLOW)
                    else:
                        char = colored('│', Colors.GRAY)

                    col_pad = (string_spacing - 1) // 2
                    row_content += ' ' * col_pad + char + ' ' * (string_spacing - col_pad - 1)
                lines.append(border + pad_line(row_content, box_width - 1) + border)

            # Note labels
            note_row = ' ' * left_pad
            for i in range(num_strings):
                note = self.strummer.notes[i]
                label = f"{note.notation}{note.octave}"
                is_current = i == current_string

                if is_current and is_pressed:
                    colored_label = colored(label, Colors.GREEN, bold=True)
                elif is_current:
                    colored_label = colored(label, Colors.YELLOW)
                else:
                    colored_label = colored(label, Colors.GRAY)

                col_pad = (string_spacing - len(label)) // 2
                note_row += ' ' * col_pad + colored_label + ' ' * (string_spacing - col_pad - len(label))
            lines.append(border + pad_line(note_row, box_width - 1) + border)

        # Last event
        lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))
        if self.last_event:
            event_type = self.last_event.get('type')
            if event_type == 'strum':
                notes = self.last_event.get('notes', [])
                note_names = [f"{n['note'].notation}{n['note'].octave}" for n in notes if 'note' in n]
                event_line = f"{colored('♪ MIDI', Colors.GREEN, bold=True)} {' '.join(note_names)}"
                lines.append(border + ' ' + pad_line(event_line, box_width - 1) + border)
            elif event_type == 'release':
                lines.append(border + ' ' + pad_line(colored('↑ RELEASE', Colors.YELLOW), box_width - 1) + border)
        else:
            lines.append(border + ' ' + pad_line(colored('Waiting for strum...', Colors.GRAY), box_width - 1) + border)

        lines.append(colored('└' + '─' * box_width + '┘', Colors.CYAN, bold=True))
        lines.append(colored('Press Ctrl+C to stop', Colors.GRAY))

        content = '\n'.join(f"{CLEAR_LINE}{line}" for line in lines) + '\n'
        sys.stdout.write(HIDE_CURSOR + MOVE_HOME + content)
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(
        description='MIDI Strummer - tablet input to MIDI output',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Auto-detect tablet from default config directory
    python -m sketchatone.cli.midi_strummer

    # With combined config file (strummer, MIDI, and server settings)
    python -m sketchatone.cli.midi_strummer -c config.json

    # Override backend via CLI (use JACK instead of rtmidi)
    python -m sketchatone.cli.midi_strummer -c config.json --jack

    # Override MIDI channel
    python -m sketchatone.cli.midi_strummer -c config.json --channel 1

    # Live dashboard mode
    python -m sketchatone.cli.midi_strummer -c config.json --live
"""
    )

    parser.add_argument(
        '-c', '--config',
        dest='config',
        metavar='PATH',
        help='Combined config file path (strummer, MIDI, and server settings). Device path is specified in server.device field.'
    )

    # CLI overrides for MIDI settings
    parser.add_argument(
        '-j', '--jack',
        action='store_true',
        help='Use JACK MIDI backend instead of rtmidi (overrides config)'
    )

    parser.add_argument(
        '--channel',
        type=int,
        choices=range(0, 16),
        metavar='0-15',
        help='MIDI channel (0-15, overrides config)'
    )

    parser.add_argument(
        '-p', '--port',
        help='MIDI output port name or index (overrides config)'
    )

    parser.add_argument(
        '-d', '--duration',
        type=float,
        help='Note duration in seconds (overrides config)'
    )

    parser.add_argument(
        '--jack-client-name',
        help='JACK client name (overrides config)'
    )

    parser.add_argument(
        '--jack-auto-connect',
        help='JACK auto-connect target (overrides config)'
    )

    # General options
    parser.add_argument(
        '-l', '--live',
        action='store_true',
        help='Live dashboard mode (updates in place)'
    )

    args = parser.parse_args()

    # Load config early to get device path
    config = None
    config_path = None
    config_dir = None
    if args.config:
        config_path = os.path.abspath(args.config)
        config_dir = os.path.dirname(config_path)
        if not os.path.exists(config_path):
            print(colored(f'Error: Config file not found: {config_path}', Colors.RED))
            sys.exit(1)
        config = MidiStrummerConfig.from_json_file(config_path)

    # Get device path from config (defaults to "devices" folder relative to config)
    device_path = config.server.device if config else None

    # Resolve device config path
    # Use config file's directory as base for resolving relative device paths
    device_config_path = resolve_device_config_path(
        device_path,
        base_dir=config_dir
    )

    print(colored('=== MIDI Strummer ===', Colors.CYAN))
    if config_path:
        print(colored(f'Config: {config_path}', Colors.GRAY))
    print(colored(f'Device config: {device_config_path}', Colors.GRAY))
    print()

    strummer = None
    try:
        strummer = MidiStrummer(
            tablet_config_path=device_config_path,
            strummer_config_path=config_path,
            live_mode=args.live,
            # CLI overrides
            use_jack=args.jack if args.jack else None,
            midi_channel=args.channel,
            midi_port=args.port,
            note_duration=args.duration,
            jack_client_name=args.jack_client_name,
            jack_auto_connect=args.jack_auto_connect
        )

        strummer.start()
    except KeyboardInterrupt:
        print(colored('\n\nShutdown signal received...', Colors.YELLOW))
        if strummer:
            strummer.stop_sync()
        sys.stdout.write('\033[?25h')
        sys.stdout.flush()
        print(colored('\n✓ Exited cleanly', Colors.GREEN))
        sys.exit(0)
    except Exception as error:
        print(colored('Error: ', Colors.RED) + str(error))
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()