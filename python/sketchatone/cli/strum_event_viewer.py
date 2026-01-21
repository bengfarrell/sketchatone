#!/usr/bin/env python3
"""
Strum Event Viewer CLI

A CLI tool that reads tablet events directly via HID and displays strum events.
Extends blankslate's TabletReaderBase for direct device access.

Usage:
    python -m sketchatone.cli.strum_event_viewer --config path/to/config.json
    python -m sketchatone.cli.strum_event_viewer --config path/to/config.json --strummer-config path/to/strummer.json
    python -m sketchatone.cli.strum_event_viewer --config path/to/config.json --mock
"""

import argparse
import sys
import os
import time
from typing import Optional, Dict, Any, List

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone.strummer.strummer import Strummer
from sketchatone.models.strummer_config import StrummerConfig
from sketchatone.models.note import Note, NoteObject

# Import blankslate's TabletReaderBase
try:
    from blankslate.cli.tablet_reader_base import TabletReaderBase, Colors, colored
except ImportError:
    print("Error: blankslate package not found.")
    print("Make sure blankslate is installed: pip install -e ../blankslate/python")
    sys.exit(1)


def print_strummer_info(strummer_config: StrummerConfig):
    """Print strummer-specific configuration info"""
    print(colored('Pressure Threshold: ', Colors.CYAN) +
          colored(str(strummer_config.pressure_threshold), Colors.WHITE))
    print(colored('Notes: ', Colors.CYAN) +
          colored(', '.join(strummer_config.notes), Colors.WHITE))
    if strummer_config.chord:
        print(colored('Chord: ', Colors.CYAN) +
              colored(strummer_config.chord, Colors.WHITE))
    print()


def create_bar(value: float, max_val: float, width: int) -> str:
    """Create a progress bar"""
    filled = int((value / max_val) * width) if max_val > 0 else 0
    filled = min(filled, width)
    empty = width - filled
    return colored('█' * filled, Colors.GREEN) + colored('░' * empty, Colors.GRAY)


def format_note(note: NoteObject) -> str:
    """Format a note for display"""
    secondary_marker = colored('*', Colors.GRAY) if note.secondary else ""
    return colored(f"{note.notation}{note.octave}", Colors.WHITE) + secondary_marker


def print_strum_event(event: Dict[str, Any], strummer: Strummer):
    """Print a strum event in a formatted way"""
    event_type = event.get('type', 'unknown')

    if event_type == 'strum':
        notes = event.get('notes', [])
        note_strs = []
        for note_data in notes:
            note = note_data.get('note')
            velocity = note_data.get('velocity', 0)
            if note:
                note_str = format_note(note)
                vel_bar = create_bar(velocity, 127, 10)
                note_strs.append(f"{note_str} vel:{velocity:3d} {vel_bar}")

        print(colored('♪ STRUM', Colors.GREEN, bold=True))
        for note_str in note_strs:
            print(f"  {note_str}")
        print()

    elif event_type == 'release':
        velocity = event.get('velocity', 0)
        print(colored('↑ RELEASE', Colors.YELLOW) + f" (last velocity: {velocity})")
        print()


def strip_ansi(text: str) -> str:
    """Strip ANSI escape codes from text to get visible length"""
    import re
    return re.sub(r'\033\[[0-9;]*m', '', text)


def pad_line(content: str, target_len: int) -> str:
    """Pad line content accounting for ANSI codes"""
    visible_len = len(strip_ansi(content))
    padding = max(0, target_len - visible_len)
    return content + ' ' * padding


def print_live_dashboard(
    strummer: Strummer,
    x: float,
    y: float,
    pressure: float,
    state: str,
    last_event: Optional[Dict[str, Any]],
    packet_count: int
):
    """Print a live dashboard view with visual string representation"""
    # ANSI codes
    HIDE_CURSOR = '\033[?25l'
    MOVE_HOME = '\033[H'
    CLEAR_LINE = '\033[2K'

    lines = []
    border = colored('│', Colors.CYAN, bold=True)
    box_width = 63

    # Header
    lines.append(colored('┌' + '─' * box_width + '┐', Colors.CYAN, bold=True))
    lines.append(border + colored('                      STRUM EVENT VIEWER                        ', Colors.WHITE, bold=True) + border)
    lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))

    # Packet counter and state
    packet_str = f"Packets: {packet_count}"
    state_color = Colors.GREEN if state == 'contact' else Colors.YELLOW if state == 'hover' else Colors.GRAY
    state_str = f"State: {colored(state, state_color, bold=True)}"
    lines.append(border + ' ' + pad_line(f"{packet_str}     {state_str}", box_width - 1) + border)

    # Pressure bar
    p_pct = f"{pressure * 100:.0f}%".rjust(4)
    pressure_bar = create_bar(pressure, 1.0, 20)
    threshold = strummer.pressure_threshold
    is_pressed = pressure >= threshold
    pressure_label = colored('PRESSED', Colors.GREEN, bold=True) if is_pressed else '       '
    lines.append(border + ' ' + pad_line(f"Pressure: {p_pct} {pressure_bar} {pressure_label}", box_width - 1) + border)

    lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))

    # String visualization
    num_strings = len(strummer.notes)
    if num_strings > 0:
        string_width = 1.0 / num_strings
        current_string = min(int(x / string_width), num_strings - 1) if string_width > 0 else 0

        # Calculate spacing for strings
        string_spacing = (box_width - 4) // num_strings
        total_width = string_spacing * num_strings
        left_pad = (box_width - total_width) // 2

        # String characters
        STRING_IDLE = '│'
        STRING_HOVER = '┃'
        STRING_STRUM = '╋'

        # Build string rows (5 rows for visual height)
        for row in range(5):
            row_content = ' ' * left_pad
            for i in range(num_strings):
                is_current_string = i == current_string
                is_strummed = is_current_string and is_pressed
                is_hovered = is_current_string and not is_pressed

                if is_strummed:
                    # Strummed - show vibrating string
                    string_char = colored(STRING_STRUM if row == 2 else '║', Colors.GREEN, bold=True)
                elif is_hovered:
                    # Hovered - highlight
                    string_char = colored(STRING_HOVER, Colors.YELLOW)
                else:
                    # Idle
                    string_char = colored(STRING_IDLE, Colors.GRAY)

                # Center the string character in its column
                col_pad = (string_spacing - 1) // 2
                row_content += ' ' * col_pad + string_char + ' ' * (string_spacing - col_pad - 1)

            lines.append(border + pad_line(row_content, box_width - 1) + border)

        # Note labels row
        note_row = ' ' * left_pad
        for i in range(num_strings):
            note = strummer.notes[i]
            note_label = f"{note.notation}{note.octave}"
            is_current_string = i == current_string
            is_strummed = is_current_string and is_pressed

            if is_strummed:
                colored_label = colored(note_label, Colors.GREEN, bold=True)
            elif is_current_string:
                colored_label = colored(note_label, Colors.YELLOW)
            elif note.secondary:
                colored_label = colored(note_label, Colors.GRAY)
            else:
                colored_label = colored(note_label, Colors.WHITE)

            # Center the note label in its column
            label_len = len(note_label)
            col_pad = (string_spacing - label_len) // 2
            note_row += ' ' * col_pad + colored_label + ' ' * (string_spacing - col_pad - label_len)

        lines.append(border + pad_line(note_row, box_width - 1) + border)

        # Velocity row (show velocity for strummed string)
        vel_row = ' ' * left_pad
        for i in range(num_strings):
            is_current_string = i == current_string
            is_strummed = is_current_string and is_pressed

            if is_strummed:
                # Calculate velocity based on pressure
                velocity = min(127, int(pressure * strummer.velocity_scale * 127))
                vel_label = colored(f"v{velocity:3d}", Colors.CYAN)
            else:
                vel_label = '    '

            col_pad = (string_spacing - 4) // 2
            vel_row += ' ' * col_pad + vel_label + ' ' * (string_spacing - col_pad - 4)

        lines.append(border + pad_line(vel_row, box_width - 1) + border)
    else:
        lines.append(border + pad_line('  No strings configured', box_width - 1) + border)

    # Last event section
    lines.append(colored('├' + '─' * box_width + '┤', Colors.CYAN, bold=True))

    if last_event:
        event_type = last_event.get('type', 'none')
        if event_type == 'strum':
            notes = last_event.get('notes', [])
            note_names = [f"{n['note'].notation}{n['note'].octave}" for n in notes if 'note' in n]
            velocities = [n.get('velocity', 0) for n in notes]
            avg_vel = round(sum(velocities) / len(velocities)) if velocities else 0
            event_line = f"{colored('♪ STRUM', Colors.GREEN, bold=True)} {' '.join(note_names)} {colored(f'vel:{avg_vel}', Colors.CYAN)}"
            lines.append(border + ' ' + pad_line(event_line, box_width - 1) + border)
        elif event_type == 'release':
            vel = last_event.get('velocity', 0)
            event_line = f"{colored('↑ RELEASE', Colors.YELLOW)} {colored(f'(velocity: {vel})', Colors.GRAY)}"
            lines.append(border + ' ' + pad_line(event_line, box_width - 1) + border)
        else:
            lines.append(border + ' ' + pad_line(colored('Waiting for strum...', Colors.GRAY), box_width - 1) + border)
    else:
        lines.append(border + ' ' + pad_line(colored('Waiting for strum...', Colors.GRAY), box_width - 1) + border)

    lines.append(colored('└' + '─' * box_width + '┘', Colors.CYAN, bold=True))
    lines.append(colored('Press Ctrl+C to stop', Colors.GRAY))

    # Build output
    content = '\n'.join(f"{CLEAR_LINE}{line}" for line in lines) + '\n'
    sys.stdout.write(HIDE_CURSOR + MOVE_HOME + content)
    sys.stdout.flush()


class StrumEventViewer(TabletReaderBase):
    """Strum event viewer that reads directly from tablet via HID"""

    def __init__(
        self,
        config_path: str,
        mock: bool = False,
        strummer_config_path: Optional[str] = None,
        live_mode: bool = False
    ):
        super().__init__(config_path, mock=mock, exit_on_stop=True)
        self.live_mode = live_mode
        self.last_event: Optional[Dict[str, Any]] = None
        self.last_live_update = 0

        # Load or create strummer config
        if strummer_config_path:
            self.strummer_config = StrummerConfig.from_json_file(strummer_config_path)
        else:
            self.strummer_config = StrummerConfig()

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(
            pluck_velocity_scale=self.strummer_config.velocity_scale,
            pressure_threshold=self.strummer_config.pressure_threshold
        )

        # Set up notes
        self._setup_notes()

    def _setup_notes(self):
        """Set up the strummer notes from config"""
        notes: List[NoteObject] = []

        if self.strummer_config.chord:
            # Parse chord notation
            chord_notes = Note.parse_chord(self.strummer_config.chord)
            notes = Note.fill_note_spread(
                chord_notes,
                self.strummer_config.lower_spread,
                self.strummer_config.upper_spread
            )
        else:
            # Use explicit notes from config
            for note_str in self.strummer_config.notes:
                notes.append(Note.parse_notation(note_str))

        self.strummer.notes = notes

    def start(self):
        """Start viewing strum events"""
        self.print_header('Strum Event Viewer')
        print_strummer_info(self.strummer_config)

        # Initialize reader
        print(colored('Initializing...', Colors.GRAY))
        self.initialize_reader_sync()

        if not self.reader:
            raise RuntimeError('Reader not initialized')

        # Start reading
        print(colored('Setting up data callback...', Colors.GRAY))
        if hasattr(self.reader, 'start_reading'):
            self.reader.start_reading(lambda data: self.handle_packet(data))

        print(colored('✓ Started reading data', Colors.GREEN))
        print(colored('Press Ctrl+C to stop\n', Colors.GRAY))

        self.is_running = True

        if self.is_mock_mode:
            self.start_mock_gesture_cycle_sync()

        # Keep process alive
        try:
            while self.is_running:
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_sync()

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

            # Update strummer bounds (use normalized 0-1 range)
            self.strummer.update_bounds(1.0, 1.0)

            # Process strum
            event = self.strummer.strum(x, pressure)

            if event:
                self.last_event = event
                if not self.live_mode:
                    print_strum_event(event, self.strummer)

            if self.live_mode:
                # Throttle live updates to ~10fps
                now = time.time()
                if now - self.last_live_update >= 0.1 or event:
                    self.last_live_update = now
                    print_live_dashboard(
                        self.strummer,
                        x, y, pressure, state,
                        self.last_event,
                        self.packet_count
                    )
        except Exception as e:
            import traceback
            sys.stderr.write(f"\n[ERROR] Failed to process packet: {e}\n")
            traceback.print_exc(file=sys.stderr)
            sys.stderr.flush()


def main():
    parser = argparse.ArgumentParser(
        description='View strum events from tablet input',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Basic usage with tablet config
    python -m sketchatone.cli.strum_event_viewer -c tablet-config.json

    # With custom strummer config
    python -m sketchatone.cli.strum_event_viewer -c tablet-config.json -s strummer-config.json

    # Live dashboard mode
    python -m sketchatone.cli.strum_event_viewer -c tablet-config.json --live

    # Use mock data for testing
    python -m sketchatone.cli.strum_event_viewer -c tablet-config.json --mock
"""
    )

    parser.add_argument(
        '-c', '--config',
        required=True,
        help='Path to tablet config JSON file'
    )

    parser.add_argument(
        '-s', '--strummer-config',
        help='Path to strummer config JSON file'
    )

    parser.add_argument(
        '-l', '--live',
        action='store_true',
        help='Live dashboard mode (updates in place)'
    )

    parser.add_argument(
        '-m', '--mock',
        action='store_true',
        help='Use mock data instead of real device'
    )

    args = parser.parse_args()

    # Validate config file exists
    if not os.path.exists(args.config):
        print(colored(f'Error: Config file not found: {args.config}', Colors.RED))
        sys.exit(1)

    if args.strummer_config and not os.path.exists(args.strummer_config):
        print(colored(f'Error: Strummer config file not found: {args.strummer_config}', Colors.RED))
        sys.exit(1)

    viewer = None
    try:
        viewer = StrumEventViewer(
            config_path=args.config,
            mock=args.mock,
            strummer_config_path=args.strummer_config,
            live_mode=args.live
        )

        # Run synchronously - no asyncio needed
        viewer.start()
    except KeyboardInterrupt:
        print(colored('\n\nShutdown signal received...', Colors.YELLOW))
        if viewer:
            viewer.stop_sync()
        # Show cursor again
        sys.stdout.write('\033[?25h')
        sys.stdout.flush()
        print(colored('\n✓ Exited cleanly', Colors.GREEN))
        sys.exit(0)
    except Exception as error:
        print(colored('Error: ', Colors.RED) + str(error))
        sys.exit(1)


if __name__ == '__main__':
    main()