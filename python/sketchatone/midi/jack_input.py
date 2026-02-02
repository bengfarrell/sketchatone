"""
JACK MIDI Input Backend

MIDI input backend using JACK Audio Connection Kit.
Designed for Linux systems, especially Zynthian.
"""

import threading
import queue
from typing import Optional, List, Dict, Callable, Union, TypedDict

try:
    import jack
except ImportError:
    jack = None


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


class JackMidiInput:
    """
    MIDI input backend using JACK Audio Connection Kit.

    Listens to MIDI input and calls callbacks when notes are pressed/released.
    Can connect to a single port or listen to ALL available JACK MIDI output ports.

    Example:
        input = JackMidiInput()
        input.on_note(lambda event: print('Notes held:', event['notes']))
        # Connect to all available MIDI sources
        input.connect_all()
    """

    def __init__(self, client_name: str = "sketchatone-input"):
        """
        Initialize the JACK MIDI input backend.

        Args:
            client_name: JACK client name
        """
        if jack is None:
            raise ImportError(
                "JACK-Client library not installed. "
                "Install with: pip install JACK-Client"
            )

        self._client_name = client_name
        self._jack_client: Optional[jack.Client] = None
        self._midi_in_port: Optional[jack.MidiPort] = None
        self._is_connected = False
        self._current_input_name: Optional[str] = None
        self._notes: List[str] = []
        self._connected_ports: List[MidiInputPort] = []
        self._note_callbacks: List[Callable[[MidiInputNoteEvent], None]] = []
        self._lock = threading.Lock()

        # Queue for passing MIDI events from process callback to main thread
        self._event_queue: queue.Queue = queue.Queue(maxsize=1000)
        self._event_thread: Optional[threading.Thread] = None
        self._running = False

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

    def _emit_note_event(self, event: MidiInputNoteEvent) -> None:
        """Emit note event to all registered callbacks"""
        for callback in self._note_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[JackMidiInput] Error in callback: {e}")

    def get_available_ports(self, filter_useful: bool = True) -> List[MidiInputPort]:
        """
        Get list of available JACK MIDI output ports (sources we can receive from).

        Args:
            filter_useful: If True, only return ports that are likely to be useful
                          MIDI input sources (physical devices, not internal routing)
        """
        try:
            # Create temporary client to query ports
            temp_client = jack.Client("temp-query", no_start_server=True)
            ports = temp_client.get_ports(is_midi=True, is_output=True)
            result: List[MidiInputPort] = []

            # Patterns for ports that are useful MIDI input sources
            useful_patterns = [
                'system:midi_capture',  # Physical MIDI inputs (USB devices)
                'a2j:',                 # ALSA to JACK bridge (physical devices)
            ]

            # Patterns for ports to exclude (internal routing, not useful for user selection)
            exclude_patterns = [
                'ZynMidiRouter',        # Zynthian internal routing
                'zynseq',               # Zynthian sequencer
                'zynsmf',               # Zynthian SMF player
                'ttymidi',              # Serial MIDI (usually not useful)
                'sketchatone',          # Our own ports
            ]

            for i, port in enumerate(ports):
                if filter_useful:
                    # Check if port matches any useful pattern
                    is_useful = any(pattern in port.name for pattern in useful_patterns)
                    # Check if port matches any exclude pattern
                    is_excluded = any(pattern in port.name for pattern in exclude_patterns)

                    if is_useful and not is_excluded:
                        result.append({'id': i, 'name': port.name})
                else:
                    result.append({'id': i, 'name': port.name})

            temp_client.close()
            return result
        except Exception as e:
            print(f"[JackMidiInput] Failed to get available ports: {e}")
            return []

    def register_only(self) -> bool:
        """
        Register a JACK MIDI input port WITHOUT auto-connecting to any sources.

        This matches how midi-strummer works - it exposes a MIDI input port
        that users can connect to via Zynthian's MIDI routing UI or jack_connect.
        This avoids feedback loops entirely since we don't auto-connect to
        ZynMidiRouter ports.

        Returns:
            True if port was registered successfully
        """
        try:
            # Close existing connections
            self.disconnect()

            # Create JACK client
            self._jack_client = jack.Client(self._client_name)

            # Register MIDI input port with is_physical=True so it appears in Zynthian's MIDI menus
            self._midi_in_port = self._jack_client.midi_inports.register('midi_in', is_physical=True)

            # Set up process callback
            self._jack_client.set_process_callback(self._process_callback)

            # Activate client
            self._jack_client.activate()

            print(f"[JackMidiInput] Client activated: {self._jack_client.name}")
            print(f"[JackMidiInput] MIDI input port registered: {self._midi_in_port.name}")
            print(f"[JackMidiInput] Not auto-connecting - use Zynthian MIDI routing to connect sources")

            self._is_connected = True
            self._current_input_name = f"{self._jack_client.name}:{self._midi_in_port.name}"
            with self._lock:
                self._notes = []

            # Start event processing thread
            self._running = True
            self._event_thread = threading.Thread(target=self._event_processor, daemon=True)
            self._event_thread.start()

            return True

        except Exception as e:
            print(f"[JackMidiInput] Failed to register port: {e}")
            self.disconnect()
            return False

    def connect_all(self, exclude_ports: Optional[List[str]] = None) -> bool:
        """
        Connect to ALL available JACK MIDI output ports (sources).

        Args:
            exclude_ports: List of port name substrings to exclude (e.g., to avoid feedback loops)
        """
        try:
            # Close existing connections
            self.disconnect()

            exclude_ports = exclude_ports or []

            # Create JACK client
            self._jack_client = jack.Client(self._client_name)

            # Register MIDI input port
            self._midi_in_port = self._jack_client.midi_inports.register('midi_in')

            # Set up process callback
            self._jack_client.set_process_callback(self._process_callback)

            # Activate client
            self._jack_client.activate()

            print(f"[JackMidiInput] Client activated: {self._jack_client.name}")
            print(f"[JackMidiInput] MIDI input: {self._midi_in_port.name}")

            # Get all MIDI output ports (sources we can receive from)
            all_ports = self._jack_client.get_ports(is_midi=True, is_output=True)
            
            connected_count = 0
            for i, port in enumerate(all_ports):
                # Check if this port should be excluded
                should_exclude = False
                for exclude_pattern in exclude_ports:
                    if exclude_pattern and exclude_pattern.lower() in port.name.lower():
                        print(f"[JackMidiInput] Skipping port: {port.name} (matches exclude pattern '{exclude_pattern}')")
                        should_exclude = True
                        break
                
                # Also skip our own ports
                if self._client_name in port.name:
                    should_exclude = True
                
                if should_exclude:
                    continue

                try:
                    # Connect the source port to our input port
                    self._jack_client.connect(port, self._midi_in_port)
                    self._connected_ports.append({'id': i, 'name': port.name})
                    connected_count += 1
                    print(f"[JackMidiInput] Connected to: {port.name}")
                except Exception as e:
                    # Port might already be connected or unavailable
                    print(f"[JackMidiInput] Could not connect to {port.name}: {e}")

            if connected_count == 0:
                print("[JackMidiInput] No MIDI output ports available to connect to")
                self.disconnect()
                return False

            self._is_connected = True
            self._current_input_name = f"All ports ({connected_count})"
            with self._lock:
                self._notes = []

            # Start event processing thread
            self._running = True
            self._event_thread = threading.Thread(target=self._event_processor, daemon=True)
            self._event_thread.start()

            return True

        except Exception as e:
            print(f"[JackMidiInput] Failed to connect: {e}")
            self.disconnect()
            return False

    def connect(self, input_port: Union[str, int]) -> bool:
        """
        Connect to a specific JACK MIDI output port (source).

        Args:
            input_port: Port name (string) or index (int)
        """
        try:
            # Close existing connections
            self.disconnect()

            # Create JACK client
            self._jack_client = jack.Client(self._client_name)
            
            # Register MIDI input port
            self._midi_in_port = self._jack_client.midi_inports.register('midi_in')
            
            # Set up process callback
            self._jack_client.set_process_callback(self._process_callback)
            
            # Activate client
            self._jack_client.activate()

            # Get all MIDI output ports
            all_ports = self._jack_client.get_ports(is_midi=True, is_output=True)
            
            if not all_ports:
                print("[JackMidiInput] No MIDI output ports available")
                self.disconnect()
                return False

            target_port = None
            port_index = 0

            if isinstance(input_port, int):
                # Use port index directly
                if 0 <= input_port < len(all_ports):
                    target_port = all_ports[input_port]
                    port_index = input_port
                else:
                    print(f"[JackMidiInput] Invalid port index: {input_port}")
                    self.disconnect()
                    return False
            elif isinstance(input_port, str):
                # Find port by name (partial match)
                for i, port in enumerate(all_ports):
                    if port.name == input_port or input_port in port.name:
                        target_port = port
                        port_index = i
                        break
                if not target_port:
                    print(f"[JackMidiInput] Port not found: {input_port}")
                    print("[JackMidiInput] Available ports:")
                    for i, port in enumerate(all_ports):
                        print(f"  {i}: {port.name}")
                    self.disconnect()
                    return False

            # Connect the source port to our input port
            self._jack_client.connect(target_port, self._midi_in_port)
            self._connected_ports.append({'id': port_index, 'name': target_port.name})
            
            self._is_connected = True
            self._current_input_name = target_port.name
            with self._lock:
                self._notes = []

            print(f"[JackMidiInput] Connected to: {target_port.name}")

            # Start event processing thread
            self._running = True
            self._event_thread = threading.Thread(target=self._event_processor, daemon=True)
            self._event_thread.start()

            return True

        except Exception as e:
            print(f"[JackMidiInput] Failed to connect: {e}")
            self.disconnect()
            return False

    def disconnect(self) -> None:
        """Disconnect from JACK and clean up"""
        self._running = False
        
        if self._event_thread and self._event_thread.is_alive():
            self._event_thread.join(timeout=1.0)
        self._event_thread = None

        if self._jack_client:
            try:
                self._jack_client.deactivate()
                self._jack_client.close()
            except Exception:
                pass

        self._jack_client = None
        self._midi_in_port = None
        self._connected_ports = []
        self._is_connected = False
        self._current_input_name = None
        
        with self._lock:
            self._notes = []

        print("[JackMidiInput] Disconnected")

    def _process_callback(self, frames: int) -> None:
        """
        JACK process callback - runs in real-time audio thread.
        Reads incoming MIDI events and queues them for processing.
        """
        if not self._midi_in_port:
            return

        for offset, data in self._midi_in_port.incoming_midi_events():
            if len(data) >= 3:
                try:
                    # Queue the MIDI message for processing outside the callback
                    self._event_queue.put_nowait(bytes(data))
                except queue.Full:
                    pass  # Drop events if queue is full

    def _event_processor(self) -> None:
        """Process MIDI events from the queue (runs in separate thread)"""
        while self._running:
            try:
                data = self._event_queue.get(timeout=0.1)
                self._handle_midi_message(list(data), self._current_input_name or "JACK")
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[JackMidiInput] Error processing event: {e}")

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
            else:
                return  # Note already in list

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
