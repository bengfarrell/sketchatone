#!/usr/bin/env python3
"""
MIDI Strummer CLI

A CLI tool that reads tablet events via HID and outputs MIDI notes.
Combines the Strummer with MIDI backends (rtmidi or JACK).

Usage:
    # Auto-detect device
    python -m sketchatone.cli.midi_strummer

    # Using combined config file (strummer, MIDI, and server settings)
    python -m sketchatone.cli.midi_strummer -c config.json

    # Override specific settings via CLI
    python -m sketchatone.cli.midi_strummer -c config.json --jack --channel 1
"""

from __future__ import annotations

import argparse
import sys
import os
import time
from typing import Optional, Dict, Any, List, Set, Union

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
from sketchatone.tablet.tablet_client import TabletClient, wait_for_device
from sketchatone.tablet.server.event_adapter import TabletEvent
from sketchatone.cli._ansi import Colors, colored


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


class MidiStrummer:
    """
    MIDI Strummer that reads tablet input and outputs MIDI notes.
    """

    def __init__(
        self,
        strummer_config_path: Optional[str] = None,
        live_mode: bool = False,
        device_poll_interval: Optional[int] = None,
        # CLI overrides (take precedence over config file)
        use_jack: Optional[bool] = None,
        midi_channel: Optional[int] = None,
        midi_port: Optional[Union[int, str]] = None,
        note_duration: Optional[float] = None,
        jack_client_name: Optional[str] = None,
        jack_auto_connect: Optional[str] = None
    ):
        self.live_mode = live_mode
        self.device_poll_interval = device_poll_interval
        self.last_event: Optional[Dict[str, Any]] = None
        self.last_live_update = 0.0
        self.notes_played = 0
        self.packet_count = 0
        self.is_running = False
        self.tablet_client: Optional[TabletClient] = None

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
            self.config.midi.default_note_duration = note_duration
        if jack_client_name is not None:
            self.config.jack_client_name = jack_client_name
        if jack_auto_connect is not None:
            self.config.jack_auto_connect = jack_auto_connect

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(
            pressure_threshold=self.config.pressure_threshold,
            pressure_buffer_size=self.config.strummer.strumming.pressure_buffer_size
        )

        # Set up notes
        self._setup_notes()

        # MIDI backend and bridge (initialized in start())
        self.backend: Optional[MidiBackendProtocol] = None
        self.bridge: Optional[MidiStrummerBridge] = None

        # Create Actions handler for stylus buttons
        # Pass the actual config object so Actions can access live values
        # (e.g., lower_spread/upper_spread that may be updated via UI)
        self.actions = Actions(
            config=self.config,
            strummer=self.strummer,
            chord_progressions=self.config.strummer.chord_progressions
        )

        # Configure action rules so button-to-action mapping works
        self.actions.set_action_rules_config(self.config.strummer.action_rules)

        # Execute any startup rules defined in the config
        self.actions.execute_startup_rules()

        # State tracking for stylus buttons
        self.button_state = {
            'primaryButtonPressed': False,
            'secondaryButtonPressed': False
        }

        # State tracking for auxiliary hardware buttons - previous HID scan codes
        self.prev_aux_codes: Set[int] = set()

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
            # tiltX from the tablet reader is -1 to 1, normalize to 0-1
            return (float(events.get('tiltX', 0)) + 1.0) / 2.0
        elif control == "tiltY":
            # tiltY from the tablet reader is -1 to 1, normalize to 0-1
            return (float(events.get('tiltY', 0)) + 1.0) / 2.0
        elif control == "tiltXY":
            # tiltXY from the tablet reader is -1 to 1, normalize to 0-1
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
            # Get inter-message delay with backward compatibility
            delay = getattr(self.config.midi, 'midi_inter_message_delay', None)
            if delay is None:
                # Backward compatibility: check old name
                delay = getattr(self.config.midi, 'rtmidi_inter_message_delay', 0.0)
            delay = delay or 0.0

            if self.config.midi_output_backend == "jack":
                from sketchatone.midi.jack_backend import JackMidiBackend
                self.backend = JackMidiBackend(
                    channel=self.config.channel,
                    client_name=self.config.jack_client_name,
                    auto_connect=self.config.jack_auto_connect,
                    inter_message_delay=delay
                )
            else:
                from sketchatone.midi.rtmidi_backend import RtMidiBackend
                self.backend = RtMidiBackend(
                    channel=self.config.channel,
                    inter_message_delay=delay,
                )

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
        # Display channel as 1-16 for users (internally stored as 0-15)
        channel_display = str(self.config.channel + 1) if self.config.channel is not None else '1 (default)'
        print(colored('  Channel: ', Colors.CYAN) +
              colored(channel_display, Colors.WHITE))
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

    def _print_header(self, title: str) -> None:
        print(colored('\n╔' + '═' * 60 + '╗', Colors.CYAN, bold=True))
        print(colored('║', Colors.CYAN, bold=True) +
              colored(f'  {title}'.ljust(60), Colors.WHITE, bold=True) +
              colored('║', Colors.CYAN, bold=True))
        print(colored('╚' + '═' * 60 + '╝\n', Colors.CYAN, bold=True))

    def start(self):
        """Start the MIDI strummer"""
        self._print_header('MIDI Strummer')
        self.print_config_info()

        # Initialize MIDI
        print(colored('Initializing MIDI...', Colors.GRAY))
        if not self._setup_midi():
            sys.exit(1)
        print(colored('✓ MIDI initialized', Colors.GREEN))

        # Discover and attach tablet
        print(colored('Discovering tablet...', Colors.GRAY))
        if self.device_poll_interval is not None:
            client = wait_for_device(
                interval_ms=self.device_poll_interval,
                on_waiting=lambda: print(colored('⚠ No tablet detected - waiting...', Colors.YELLOW)),
            )
        else:
            client = TabletClient.discover()
            if client is None:
                raise RuntimeError('No tablet device found. Use --poll <ms> to wait for one.')

        self.tablet_client = client
        client.start(
            on_event=self.handle_tablet_event,
            on_disconnect=lambda: print(colored('\n[Tablet] Device disconnected', Colors.YELLOW)),
        )

        caps = client.capabilities
        print(colored(f'✓ Tablet connected: {caps.manufacturer} {caps.model}', Colors.GREEN))
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
        self.is_running = False

        # Clean up MIDI
        if self.bridge:
            self.bridge.release_all()
            self.bridge.disconnect()
        if self.backend:
            self.backend.disconnect()

        if self.tablet_client is not None:
            try:
                self.tablet_client.stop()
            except Exception:  # pragma: no cover - defensive shutdown
                pass
            self.tablet_client = None

    def handle_tablet_event(self, tablet_event: TabletEvent):
        """Handle incoming tablet event from TabletClient"""
        try:
            self.packet_count += 1

            # Extract normalized values
            x = tablet_event.x
            y = tablet_event.y
            pressure = tablet_event.pressure
            state = 'out-of-range' if tablet_event.state == 'none' else tablet_event.state

            # Build an events dict for _get_control_value compatibility
            events: Dict[str, Any] = {
                'x': x,
                'y': y,
                'pressure': pressure,
                'tiltX': tablet_event.tiltX,
                'tiltY': tablet_event.tiltY,
                'tiltXY': tablet_event.tiltXY,
            }

            # Handle stylus button presses
            primary_pressed = tablet_event.primaryButtonPressed
            secondary_pressed = tablet_event.secondaryButtonPressed

            # Handle stylus button presses via action rules
            # Detect button down events (transition from not pressed to pressed)
            if primary_pressed and not self.button_state['primaryButtonPressed']:
                self.actions.handle_button_event('button:primary', 'press')
            if not primary_pressed and self.button_state['primaryButtonPressed']:
                self.actions.handle_button_event('button:primary', 'release')

            if secondary_pressed and not self.button_state['secondaryButtonPressed']:
                self.actions.handle_button_event('button:secondary', 'press')
            if not secondary_pressed and self.button_state['secondaryButtonPressed']:
                self.actions.handle_button_event('button:secondary', 'release')

            # Update stylus button states
            self.button_state['primaryButtonPressed'] = primary_pressed
            self.button_state['secondaryButtonPressed'] = secondary_pressed

            # Handle auxiliary hardware buttons via action rules using HID scan codes
            current_aux_codes: Set[int] = set(tablet_event.auxCodes)
            for code in current_aux_codes:
                if code not in self.prev_aux_codes:
                    self.actions.handle_button_event(f'code:{code}', 'press')
            for code in self.prev_aux_codes:
                if code not in current_aux_codes:
                    self.actions.handle_button_event(f'code:{code}', 'release')
            self.prev_aux_codes = current_aux_codes

            # Apply pitch bend based on configuration (throttled to avoid MIDI flooding)
            # Skip out-of-range events (state="none"): those produce Y=0 which maps to PB=-1.0
            pitch_bend_cfg = self.config.strummer.pitch_bend
            if pitch_bend_cfg and self.backend and tablet_event.state != "none":
                # Get the control input value based on the control setting
                control_value = self._get_control_value(pitch_bend_cfg.control, events)
                if control_value is not None:
                    # Map the control value to pitch bend range
                    bend_value = pitch_bend_cfg.map_value(control_value)

                    # Initialize tracking variables
                    current_time = time.time()
                    if not hasattr(self, '_last_pitch_bend_time'):
                        self._last_pitch_bend_time = 0
                        self._last_pitch_bend_value = None

                    # Apply deadzone around center (±0.02) to avoid sending tiny changes near zero
                    # This prevents MIDI flooding when there's no actual pitch bend
                    if abs(bend_value) < 0.02:
                        bend_value = 0.0

                    # Only send if value changed significantly
                    # Don't send repeated messages with the same value
                    value_changed = (self._last_pitch_bend_value is None or
                                   abs(bend_value - self._last_pitch_bend_value) > 0.01)

                    if value_changed:
                        self.backend.send_pitch_bend(bend_value)
                        self._last_pitch_bend_time = current_time
                        self._last_pitch_bend_value = bend_value
                        if not self.live_mode:
                            print(colored(f'⤢ PB {bend_value:+.3f}', Colors.CYAN))

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

                    # Reset pitch bend to center so sustaining notes aren't bent
                    # by Y-axis drift as the pen lifts off the tablet surface.
                    pitch_bend_cfg = self.config.strummer.pitch_bend
                    last_bend = getattr(self, '_last_pitch_bend_value', None)
                    if pitch_bend_cfg and self.backend and last_bend not in (None, 0.0):
                        self.backend.send_pitch_bend(0.0)
                        self._last_pitch_bend_value = 0.0
                        if not self.live_mode:
                            print(colored(f'⤢ PB  0.000 (reset on release)', Colors.CYAN))

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
        choices=range(1, 17),
        metavar='1-16',
        help='MIDI channel (1-16, overrides config)'
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

    parser.add_argument(
        '--poll',
        type=int,
        default=None,
        metavar='MS',
        help='Poll interval in milliseconds for waiting for device. If not set, quit if no device found.'
    )

    args = parser.parse_args()

    # Validate config file if provided
    config_path = None
    if args.config:
        config_path = os.path.abspath(args.config)
        if not os.path.exists(config_path):
            print(colored(f'Error: Config file not found: {config_path}', Colors.RED))
            sys.exit(1)

    print(colored('=== MIDI Strummer ===', Colors.CYAN))
    if config_path:
        print(colored(f'Config: {config_path}', Colors.GRAY))
    print()

    strummer = None
    try:
        strummer = MidiStrummer(
            strummer_config_path=config_path,
            live_mode=args.live,
            device_poll_interval=args.poll,
            # CLI overrides
            use_jack=args.jack if args.jack else None,
            midi_channel=args.channel - 1 if args.channel is not None else None,  # Convert 1-16 to 0-15
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