"""
RtMidi Input Backend

MIDI input backend using python-rtmidi for cross-platform MIDI support.
Listens to MIDI input from external devices (keyboards, controllers).
"""

import threading
import time
from typing import Optional, List, Dict, Callable, Union, TypedDict

try:
    import rtmidi
except ImportError:
    rtmidi = None


class MidiInputPort(TypedDict):
    """MIDI input port info"""
    id: int
    name: str


class MidiInputNoteEvent(TypedDict, total=False):
    """MIDI note event data"""
    notes: List[str]  # Currently held notes as strings (e.g., ['C4', 'E4', 'G4'])
    added: Optional[str]  # Note that was just added (if any)
    removed: Optional[str]  # Note that was just removed (if any)
    port_name: Optional[str]  # Name of the port that sent this event


# Note name lookup table (sharps only, matching Node.js implementation)
SHARP_NOTATIONS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def _sort_notes(notes: List[str]) -> List[str]:
    """Sort notes by MIDI note number (lowest to highest)"""
    def note_to_midi(note_str: str) -> int:
        # Parse note string like "C4", "C#4", "D4"
        if len(note_str) < 2:
            return 0
        if '#' in note_str:
            notation = note_str[:2]
            octave = int(note_str[2:])
        else:
            notation = note_str[0]
            octave = int(note_str[1:])
        
        try:
            note_index = SHARP_NOTATIONS.index(notation)
            return (octave + 1) * 12 + note_index
        except ValueError:
            return 0
    
    return sorted(notes, key=note_to_midi)


class RtMidiInput:
    """
    MIDI input backend using python-rtmidi.

    Listens to MIDI input and calls callbacks when notes are pressed/released.
    Can connect to a single port or listen to ALL available ports.

    Example:
        input = RtMidiInput()
        input.on_note(lambda event: print('Notes held:', event['notes']))
        # Connect to specific port
        input.connect('My MIDI Keyboard')
        # Or listen to all ports
        input.connect_all()
    """

    def __init__(self, device_monitoring: Union[int, bool] = False):
        """
        Initialize the MIDI input backend.

        Args:
            device_monitoring: Device monitoring disabled by default (False).
                Users must manually refresh the device list.
        """
        if rtmidi is None:
            raise ImportError(
                "python-rtmidi not installed. "
                "Install with: pip install python-rtmidi"
            )

        self._midi_inputs: Dict[int, rtmidi.MidiIn] = {}
        self._is_connected = False
        self._current_input_name: Optional[str] = None
        self._notes: List[str] = []
        self._connected_ports: List[MidiInputPort] = []
        self._note_callbacks: List[Callable[[MidiInputNoteEvent], None]] = []
        self._lock = threading.Lock()

        # Device monitoring
        # Normalize: False or 0 means disabled, otherwise convert to seconds
        if device_monitoring is False or device_monitoring == 0:
            self._device_monitoring = False
        else:
            self._device_monitoring = float(device_monitoring) / 1000.0  # Convert ms to seconds
        self._monitoring_timer: Optional[threading.Timer] = None
        self._last_requested_port: Optional[Union[int, str]] = None
        self._connect_all_mode = False
        self._last_exclude_ports: Optional[List[str]] = None
        self._last_available_ports: List[str] = []
        self._device_change_callback: Optional[Callable[[], None]] = None

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    @property
    def current_input_name(self) -> Optional[str]:
        return self._current_input_name

    @property
    def notes(self) -> List[str]:
        """Get the list of currently held notes as strings"""
        with self._lock:
            return list(self._notes)

    @property
    def connected_ports(self) -> List[MidiInputPort]:
        """Get the list of connected ports"""
        return list(self._connected_ports)

    def on_note(self, callback: Callable[[MidiInputNoteEvent], None]) -> None:
        """Register a callback for note events"""
        self._note_callbacks.append(callback)

    def off_note(self, callback: Callable[[MidiInputNoteEvent], None]) -> None:
        """Remove a note event callback"""
        if callback in self._note_callbacks:
            self._note_callbacks.remove(callback)

    def on_device_change(self, callback: Callable[[], None]) -> None:
        """
        Register a callback to be called when MIDI devices change.

        Args:
            callback: Function to call when devices are added/removed
        """
        self._device_change_callback = callback

    def _emit_note_event(self, event: MidiInputNoteEvent) -> None:
        """Emit note event to all registered callbacks"""
        for callback in self._note_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[RtMidiInput] Error in callback: {e}")

    def get_available_ports(self) -> List[MidiInputPort]:
        """Get list of available MIDI input ports."""
        try:
            # Create a fresh MidiIn instance to force port list refresh
            # On macOS, rtmidi sometimes caches the port list, so we need to
            # create a new instance each time to see newly connected devices
            temp_in = rtmidi.MidiIn()

            # Small delay to allow the system to enumerate devices
            # This helps on macOS where device detection can be delayed
            time.sleep(0.01)

            ports: List[MidiInputPort] = []
            port_count = temp_in.get_port_count()
            for i in range(port_count):
                ports.append({'id': i, 'name': temp_in.get_port_name(i)})
            del temp_in
            return ports
        except Exception as e:
            print(f"[RtMidiInput] Failed to get available ports: {e}")
            return []

    def connect_all(self, exclude_ports: Optional[List[str]] = None) -> bool:
        """
        Connect to ALL available MIDI input ports.
        Useful for discovering which device the user is playing.

        Args:
            exclude_ports: List of port name substrings to exclude (e.g., to avoid feedback loops)
        """
        try:
            # Close existing connections
            self.disconnect()

            # Get available ports
            temp_in = rtmidi.MidiIn()
            port_count = temp_in.get_port_count()
            del temp_in

            if port_count == 0:
                print("[RtMidiInput] No MIDI input ports available")
                return False

            exclude_ports = exclude_ports or []
            connected_count = 0

            # Connect to each port
            for i in range(port_count):
                midi_in = rtmidi.MidiIn()
                port_name = midi_in.get_port_name(i)

                # Check if this port should be excluded
                should_exclude = False
                for exclude_pattern in exclude_ports:
                    if exclude_pattern and exclude_pattern.lower() in port_name.lower():
                        print(f"[RtMidiInput] Skipping port {i}: {port_name} (matches exclude pattern '{exclude_pattern}')")
                        should_exclude = True
                        break

                if should_exclude:
                    del midi_in
                    continue

                # Set up callback with port info
                midi_in.set_callback(self._create_callback(port_name))

                midi_in.open_port(i)
                self._midi_inputs[i] = midi_in
                self._connected_ports.append({'id': i, 'name': port_name})
                connected_count += 1

                print(f"[RtMidiInput] Connected to port {i}: {port_name}")

            if connected_count == 0:
                print("[RtMidiInput] No MIDI input ports available after exclusions")
                return False

            self._is_connected = True
            self._current_input_name = f"All ports ({connected_count})"
            self._connect_all_mode = True
            self._last_exclude_ports = exclude_ports
            with self._lock:
                self._notes = []

            self._start_hot_swap_monitoring()
            return True
        except Exception as e:
            print(f"[RtMidiInput] Failed to connect to all ports: {e}")
            return False

    def connect_multiple(self, port_ids: List[int]) -> bool:
        """
        Connect to multiple specific MIDI input ports by their IDs.

        Args:
            port_ids: List of port indices to connect to

        Returns:
            True if at least one port was connected successfully
        """
        try:
            # Close existing connections
            self.disconnect()

            if not port_ids:
                print("[RtMidiInput] No ports specified - staying disconnected")
                return False

            # Get available ports
            temp_in = rtmidi.MidiIn()
            port_count = temp_in.get_port_count()
            del temp_in

            if port_count == 0:
                print("[RtMidiInput] No MIDI input ports available")
                return False

            connected_count = 0

            # Connect to each specified port
            for port_id in port_ids:
                if not (0 <= port_id < port_count):
                    print(f"[RtMidiInput] Skipping invalid port index: {port_id}")
                    continue

                midi_in = rtmidi.MidiIn()
                port_name = midi_in.get_port_name(port_id)

                # Set up callback with port info
                midi_in.set_callback(self._create_callback(port_name))

                midi_in.open_port(port_id)
                self._midi_inputs[port_id] = midi_in
                self._connected_ports.append({'id': port_id, 'name': port_name})
                connected_count += 1

                print(f"[RtMidiInput] Connected to port {port_id}: {port_name}")

            if connected_count == 0:
                print("[RtMidiInput] No valid ports were connected")
                return False

            self._is_connected = True
            self._current_input_name = f"Selected ports ({connected_count})"
            self._connect_all_mode = False
            self._last_requested_port = port_ids  # Store list for reconnection
            with self._lock:
                self._notes = []

            self._start_hot_swap_monitoring()
            return True
        except Exception as e:
            print(f"[RtMidiInput] Failed to connect to multiple ports: {e}")
            return False

    def connect(self, input_port: Union[str, int]) -> bool:
        """
        Connect to a specific MIDI input port.

        Args:
            input_port: Port name (string) or index (int)
        """
        try:
            # Close existing connections
            self.disconnect()

            midi_in = rtmidi.MidiIn()
            port_count = midi_in.get_port_count()

            if port_count == 0:
                print("[RtMidiInput] No MIDI input ports available")
                del midi_in
                return False

            port_index = 0

            if isinstance(input_port, int):
                # Use port index directly
                if 0 <= input_port < port_count:
                    port_index = input_port
                else:
                    print(f"[RtMidiInput] Invalid port index: {input_port}")
                    del midi_in
                    return False
            elif isinstance(input_port, str):
                # Find port by name (partial match)
                found = False
                for i in range(port_count):
                    name = midi_in.get_port_name(i)
                    if name == input_port or input_port in name:
                        port_index = i
                        found = True
                        break
                if not found:
                    print(f"[RtMidiInput] Port not found: {input_port}")
                    print("[RtMidiInput] Available ports:")
                    for i in range(port_count):
                        print(f"  {i}: {midi_in.get_port_name(i)}")
                    del midi_in
                    return False

            port_name = midi_in.get_port_name(port_index)

            # Set up callback before opening port
            midi_in.set_callback(self._create_callback(port_name))

            midi_in.open_port(port_index)

            self._midi_inputs[port_index] = midi_in
            self._connected_ports.append({'id': port_index, 'name': port_name})
            self._is_connected = True
            self._current_input_name = port_name
            self._connect_all_mode = False
            self._last_requested_port = input_port
            with self._lock:
                self._notes = []

            print(f"[RtMidiInput] Connected to port {port_index}: {port_name}")
            self._start_hot_swap_monitoring()

            return True
        except Exception as e:
            print(f"[RtMidiInput] Failed to connect: {e}")
            return False

    def disconnect(self) -> None:
        """Disconnect from all MIDI inputs"""
        self._stop_hot_swap_monitoring()

        for midi_in in self._midi_inputs.values():
            try:
                midi_in.close_port()
            except Exception:
                pass
        self._midi_inputs.clear()
        self._connected_ports = []

        self._is_connected = False
        self._current_input_name = None
        with self._lock:
            self._notes = []

        print("[RtMidiInput] Disconnected")

    def _create_callback(self, port_name: str):
        """Create a MIDI message callback for a specific port"""
        def callback(message, data=None):
            self._handle_midi_message(message[0], port_name)
        return callback

    def _handle_midi_message(self, message: List[int], port_name: str) -> None:
        """Handle incoming MIDI messages"""
        if len(message) < 3:
            return

        command = message[0]
        note_number = message[1]
        velocity = message[2]

        # Convert MIDI note number to notation
        notation = SHARP_NOTATIONS[note_number % 12]
        octave = (note_number // 12) - 1

        # Note On: 0x90-0x9F (144-159)
        if 0x90 <= command <= 0x9F:
            if velocity > 0:
                self._on_note_down(notation, octave, port_name)
            else:
                # Note On with velocity 0 is treated as Note Off
                self._on_note_up(notation, octave, port_name)
        # Note Off: 0x80-0x8F (128-143)
        elif 0x80 <= command <= 0x8F:
            self._on_note_up(notation, octave, port_name)

    def _on_note_down(self, notation: str, octave: int, port_name: str) -> None:
        """Handle note down event"""
        note_str = f"{notation}{octave}"
        with self._lock:
            if note_str not in self._notes:
                self._notes.append(note_str)
                self._notes = _sort_notes(self._notes)
                notes_copy = list(self._notes)

        # Emit event (outside lock)
        self._emit_note_event({
            'notes': notes_copy,
            'added': note_str,
            'port_name': port_name,
        })

    def _on_note_up(self, notation: str, octave: int, port_name: str) -> None:
        """Handle note up event"""
        note_str = f"{notation}{octave}"
        with self._lock:
            if note_str in self._notes:
                self._notes.remove(note_str)
                self._notes = _sort_notes(self._notes)
                notes_copy = list(self._notes)
            else:
                return  # Note wasn't in the list

        # Emit event (outside lock)
        self._emit_note_event({
            'notes': notes_copy,
            'removed': note_str,
            'port_name': port_name,
        })

    def _start_hot_swap_monitoring(self) -> None:
        """Start device monitoring for device changes."""
        if self._device_monitoring is False:
            return

        self._stop_hot_swap_monitoring()
        self._schedule_next_check()

    def _stop_hot_swap_monitoring(self) -> None:
        """Stop device monitoring."""
        if self._monitoring_timer:
            self._monitoring_timer.cancel()
            self._monitoring_timer = None

    def _schedule_next_check(self) -> None:
        """Schedule the next device check."""
        if self._device_monitoring is False:
            return

        self._monitoring_timer = threading.Timer(
            self._device_monitoring,
            self._check_device_changes
        )
        self._monitoring_timer.daemon = True
        self._monitoring_timer.start()

    def _check_device_changes(self) -> None:
        """Check for device changes and attempt reconnection if needed."""
        try:
            available_ports = self.get_available_ports()
            current_port_names = [p['name'] for p in available_ports]
            devices_changed = False

            # Check if any connected devices are still present
            if self._is_connected:
                connected_names = [p['name'] for p in self._connected_ports]
                disconnected = [name for name in connected_names if name not in current_port_names]

                if disconnected:
                    print(f"[RtMidiInput] Device(s) disconnected: {', '.join(disconnected)}")
                    # Close disconnected ports
                    for port_id in list(self._midi_inputs.keys()):
                        port_info = next((p for p in self._connected_ports if p['id'] == port_id), None)
                        if port_info and port_info['name'] in disconnected:
                            try:
                                self._midi_inputs[port_id].close_port()
                                del self._midi_inputs[port_id]
                            except Exception:
                                pass

                    # Update connected ports list
                    self._connected_ports = [p for p in self._connected_ports if p['name'] not in disconnected]

                    if not self._connected_ports:
                        self._is_connected = False
                        self._current_input_name = None

                    devices_changed = True

            # Check for new devices and attempt reconnection
            if not self._is_connected:
                new_ports = [p for p in current_port_names if p not in self._last_available_ports]
                if new_ports:
                    print(f"[RtMidiInput] New device(s) detected: {', '.join(new_ports)}")
                    self._attempt_reconnection()
                    devices_changed = True

            # Check if device list changed (even if we're connected)
            if set(current_port_names) != set(self._last_available_ports):
                devices_changed = True

            self._last_available_ports = current_port_names

            # Notify callback if devices changed
            if devices_changed and self._device_change_callback:
                try:
                    self._device_change_callback()
                except Exception as e:
                    print(f"[RtMidiInput] Error in device change callback: {e}")

        except Exception as e:
            print(f"[RtMidiInput] Error checking device changes: {e}")
        finally:
            # Schedule next check
            self._schedule_next_check()

    def _attempt_reconnection(self) -> None:
        """Attempt to reconnect to the last requested port(s)."""
        if self._is_connected:
            return

        try:
            if self._connect_all_mode:
                print("[RtMidiInput] Attempting to reconnect to all ports")
                success = self.connect_all(self._last_exclude_ports)
            elif self._last_requested_port is not None:
                # Check if it's a list of port IDs
                if isinstance(self._last_requested_port, list):
                    print(f"[RtMidiInput] Attempting to reconnect to ports: {self._last_requested_port}")
                    success = self.connect_multiple(self._last_requested_port)
                else:
                    print(f"[RtMidiInput] Attempting to reconnect to: {self._last_requested_port}")
                    success = self.connect(self._last_requested_port)
            else:
                return

            if success:
                print(f"[RtMidiInput] Successfully reconnected to: {self._current_input_name}")
            else:
                print("[RtMidiInput] Reconnection failed")

        except Exception as e:
            print(f"[RtMidiInput] Reconnection error: {e}")
