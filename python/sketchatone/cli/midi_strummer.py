#!/usr/bin/env python3
"""
MIDI Strummer CLI

A CLI tool that reads tablet events via HID and outputs MIDI notes.
Combines the Strummer with MIDI backends (rtmidi or JACK).

Usage:
    # Using combined config file (strummer + MIDI settings)
    python -m sketchatone.cli.midi_strummer --tablet-config tablet.json --strummer-config strummer.json

    # Using defaults with tablet config only
    python -m sketchatone.cli.midi_strummer --tablet-config tablet.json

    # Override specific settings via CLI
    python -m sketchatone.cli.midi_strummer --tablet-config tablet.json --jack --channel 1
"""

import argparse
import sys
import os
import time
from typing import Optional, Dict, Any, List, Union

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone.strummer.strummer import Strummer
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


def resolve_config_path(config_arg: str | None, default_dir: str = DEFAULT_CONFIG_DIR) -> str:
    """
    Resolve config path - if it's a directory or None, search for matching config.

    Args:
        config_arg: Config path argument (file, directory, or None)
        default_dir: Default directory to search if config_arg is None

    Returns:
        Resolved config file path

    Raises:
        SystemExit: If no matching config is found
    """
    # If no config provided, use default directory
    if config_arg is None:
        search_dir = os.path.abspath(default_dir)
        found_config = find_config_for_device(search_dir)
        if found_config:
            return found_config
        else:
            print(colored(f'Error: No matching tablet config found in: {search_dir}', Colors.RED))
            sys.exit(1)

    # If it's a file with .json extension, use it directly
    if config_arg.endswith('.json'):
        if not os.path.exists(config_arg):
            print(colored(f'Error: Config file not found: {config_arg}', Colors.RED))
            sys.exit(1)
        return config_arg

    config_path = os.path.abspath(config_arg)

    # If it's a directory, search for matching config
    if os.path.isdir(config_path):
        found_config = find_config_for_device(config_path)
        if found_config:
            return found_config
        else:
            print(colored(f'Error: No matching tablet config found in: {config_path}', Colors.RED))
            sys.exit(1)

    # If path doesn't exist and has no extension, try default directory
    if not os.path.exists(config_path) and not os.path.splitext(config_arg)[1]:
        search_dir = os.path.abspath(default_dir)
        found_config = find_config_for_device(search_dir)
        if found_config:
            return found_config
        else:
            print(colored(f'Error: No matching tablet config found in: {search_dir}', Colors.RED))
            sys.exit(1)

    # Otherwise treat as file path
    if not os.path.exists(config_arg):
        print(colored(f'Error: Config file not found: {config_arg}', Colors.RED))
        sys.exit(1)
    return config_arg


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

            # Update strummer bounds
            self.strummer.update_bounds(1.0, 1.0)

            # Process strum
            event = self.strummer.strum(x, pressure)

            if event:
                self.last_event = event
                event_type = event.get('type')

                if event_type == 'strum':
                    # Send MIDI notes
                    notes_data = event.get('notes', [])
                    for note_data in notes_data:
                        note = note_data.get('note')
                        velocity = note_data.get('velocity', 100)
                        if note and self.backend:
                            self.backend.send_note(
                                note=note,
                                velocity=velocity,
                                duration=self.config.note_duration
                            )
                            self.notes_played += 1

                    if not self.live_mode:
                        self._print_strum_event(event, x, y, pressure)

                elif event_type == 'release':
                    if not self.live_mode:
                        self._print_release_event(event, x, y, pressure)

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

    # Auto-detect tablet from specific directory
    python -m sketchatone.cli.midi_strummer -t ./configs/

    # Basic usage with specific config file
    python -m sketchatone.cli.midi_strummer -t tablet.json

    # With combined strummer+MIDI config file
    python -m sketchatone.cli.midi_strummer -t tablet.json -s strummer.json

    # Override backend via CLI (use JACK instead of rtmidi)
    python -m sketchatone.cli.midi_strummer -t tablet.json --jack

    # Override MIDI channel
    python -m sketchatone.cli.midi_strummer -t tablet.json --channel 1

    # Live dashboard mode
    python -m sketchatone.cli.midi_strummer -t tablet.json --live
"""
    )

    parser.add_argument(
        '-t', '--tablet-config',
        help='Path to tablet config JSON file or directory (auto-detects from ../public/configs if not provided)'
    )

    parser.add_argument(
        '-s', '--strummer-config',
        help='Path to strummer/MIDI config JSON file (can contain both strummer and MIDI settings)'
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

    # Resolve tablet config path (handles auto-detection from directory)
    tablet_config_path = resolve_config_path(args.tablet_config)

    if args.strummer_config and not os.path.exists(args.strummer_config):
        print(colored(f'Error: Strummer config file not found: {args.strummer_config}', Colors.RED))
        sys.exit(1)

    strummer = None
    try:
        strummer = MidiStrummer(
            tablet_config_path=tablet_config_path,
            strummer_config_path=args.strummer_config,
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