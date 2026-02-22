"""
JACK MIDI Backend

MIDI output backend using JACK Audio Connection Kit.
Designed for Linux systems, especially Zynthian.
"""

import threading
import queue
import time
from typing import Optional, List, Dict, Tuple, Set

try:
    import jack
except ImportError:
    jack = None

from .protocol import MidiBackendProtocol
from ..models.note import Note, NoteObject
from .note_scheduler import get_scheduler


class JackMidiBackend(MidiBackendProtocol):
    """
    MIDI backend using JACK Audio Connection Kit.

    Ideal for Linux systems with JACK, especially Zynthian.
    MIDI events are queued and sent from the JACK process callback
    for real-time performance.

    Example:
        backend = JackMidiBackend(channel=1, client_name="sketchatone")
        backend.connect()
        backend.send_note(note, velocity=100, duration=1.0)
        backend.disconnect()
    """

    def __init__(self, channel: Optional[int] = None, client_name: str = "sketchatone",
                 auto_connect: str = "chain0", inter_message_delay: float = 0.0):
        """
        Initialize the JACK MIDI backend.

        Args:
            channel: Default MIDI channel (1-16), or None for all channels
            client_name: JACK client name
            auto_connect: Auto-connect mode: "chain0", "all-chains", or "none"
            inter_message_delay: Seconds to wait after each MIDI message (default 0).
                Use e.g. 0.002 (2 ms) on systems where notes stick during busy strumming.
        """
        if jack is None:
            raise ImportError(
                "JACK-Client library not installed. "
                "Install with: pip install JACK-Client"
            )

        self._channel = channel
        self._client_name = client_name
        self._auto_connect = auto_connect
        self._inter_message_delay = inter_message_delay

        self._jack_client: Optional[jack.Client] = None
        self._midi_out_port: Optional[jack.MidiPort] = None
        self._connected = False

        # MIDI event queue for real-time processing
        self._midi_queue: queue.Queue = queue.Queue(maxsize=1000)

        # Note scheduling using shared scheduler (daemon=False for Pi timing)
        self._scheduler = get_scheduler()
        self._scheduled_note_keys: Set[Tuple[int, Tuple[int, ...]]] = set()

        # State Guard: Track active notes to prevent "Note Shadowing"
        self._active_notes: Set[int] = set()
        self._send_lock = threading.Lock()
        self._last_send_time = 0.0
    
    @property
    def is_connected(self) -> bool:
        return self._connected and self._jack_client is not None

    @property
    def current_output_name(self) -> Optional[str]:
        """Get the name of the current MIDI output port."""
        if self._midi_out_port:
            return self._midi_out_port.name
        return None

    def get_available_ports(self) -> List[str]:
        """Get list of available JACK MIDI input ports (destinations)."""
        if not self.is_connected:
            return []
        try:
            ports = self._jack_client.get_ports(is_midi=True, is_input=True)
            return [p.name for p in ports]
        except Exception:
            return []
    
    def connect(self, output_port: Optional[str] = None) -> bool:
        """
        Connect to JACK and create MIDI output port.
        
        Args:
            output_port: Ignored for JACK (uses auto-connect instead)
            
        Returns:
            True if connection successful
        """
        try:
            # Create JACK client
            self._jack_client = jack.Client(self._client_name)
            
            # Register MIDI output port with is_physical=True and is_terminal=True
            # These flags are required for the port to appear in Zynthian's MIDI device list
            # Use a descriptive name (not 'midi_out') as Zynthian uses this for the device list
            self._midi_out_port = self._jack_client.midi_outports.register(
                'Sketchatone', is_physical=True, is_terminal=True
            )
            
            # Set up process callback
            self._jack_client.set_process_callback(self._process_callback)
            
            # Activate client
            self._jack_client.activate()
            
            print(f"[JackMidi] Client activated: {self._jack_client.name}")
            print(f"[JackMidi] MIDI output: {self._midi_out_port.name}")
            
            # Auto-connect to synths
            self._auto_connect_to_synths()
            
            self._connected = True
            return True
            
        except Exception as e:
            print(f"[JackMidi] Connection failed: {e}")
            self._connected = False
            return False
    
    def _process_callback(self, frames: int) -> None:
        """
        JACK process callback - runs in real-time audio thread.
        Sends all queued MIDI events.
        """
        self._midi_out_port.clear_buffer()
        
        while not self._midi_queue.empty():
            try:
                offset, midi_message = self._midi_queue.get_nowait()
                self._midi_out_port.write_midi_event(offset, midi_message)
            except queue.Empty:
                break
            except Exception:
                pass  # Can't print in callback
    
    def _auto_connect_to_synths(self) -> None:
        """Auto-connect to available synths based on mode."""
        if not self._jack_client or not self._midi_out_port:
            return
        
        if self._auto_connect == "none":
            print("[JackMidi] Auto-connect disabled")
            return
        
        try:
            all_ports = self._jack_client.get_ports(is_midi=True, is_input=True)
            
            if self._auto_connect == "all-chains":
                # Connect to all ZynMidiRouter chains
                zyn_ports = [p for p in all_ports 
                            if 'ZynMidiRouter' in p.name and 'dev' in p.name and '_in' in p.name]
                connected = 0
                for port in zyn_ports:
                    try:
                        self._jack_client.connect(self._midi_out_port, port)
                        connected += 1
                    except Exception:
                        pass
                if connected > 0:
                    print(f"[JackMidi] Connected to {connected} Zynthian chain(s)")
                    return
            
            # Default: Connect to Chain 0
            zyn_ports = [p for p in all_ports 
                        if 'ZynMidiRouter' in p.name and 'dev0_in' in p.name]
            if zyn_ports:
                try:
                    self._jack_client.connect(self._midi_out_port, zyn_ports[0])
                    print("[JackMidi] Connected to Zynthian (Chain 0)")
                    return
                except Exception:
                    pass
            
            # Try common synth engines
            common_synths = ['ZynAddSubFX', 'setBfree', 'FluidSynth', 'LinuxSampler']
            for synth_name in common_synths:
                synth_ports = [p for p in all_ports 
                              if synth_name in p.name and 'midi_in' in p.name.lower()]
                if synth_ports:
                    try:
                        self._jack_client.connect(self._midi_out_port, synth_ports[0])
                        print(f"[JackMidi] Connected to {synth_name}")
                        return
                    except Exception:
                        pass
            
            print("[JackMidi] No synths found - use JACK tools to connect")
            
        except Exception as e:
            print(f"[JackMidi] Auto-connect error: {e}")
    
    def _queue_midi_event(self, midi_message: bytes, offset: int = 0) -> None:
        """
        Queue a MIDI event for the process callback with optional throttling.
        Call only while holding _send_lock for inter-message delay.
        """
        if self._inter_message_delay > 0:
            now = time.time()
            wait = (self._last_send_time + self._inter_message_delay) - now
            if wait > 0:
                time.sleep(wait)

        try:
            self._midi_queue.put_nowait((offset, midi_message))
            self._last_send_time = time.time()
        except queue.Full:
            print("[JackMidi] Warning: MIDI queue full")
    
    def disconnect(self) -> None:
        """Disconnect and clean up."""
        # Cancel all scheduled note-offs
        for note_key in list(self._scheduled_note_keys):
            self._scheduler.cancel(note_key)
        self._scheduled_note_keys.clear()

        if self._jack_client and self._midi_out_port:
            # Send "All Notes Off" and "Reset All Controllers" on all channels
            # to clean up any stuck notes or pitch bend
            try:
                with self._send_lock:
                    for ch in range(16):
                        # All Notes Off (CC 123)
                        self._queue_midi_event(bytes([0xB0 + ch, 123, 0]))
                        # Reset All Controllers (CC 121)
                        self._queue_midi_event(bytes([0xB0 + ch, 121, 0]))
                        # Reset pitch bend to center
                        self._queue_midi_event(bytes([0xE0 + ch, 0x00, 0x40]))
                    self._active_notes.clear()
            except Exception as e:
                print(f"[JackMidi] Error sending cleanup messages: {e}")

        if self._jack_client:
            try:
                self._jack_client.deactivate()
                self._jack_client.close()
                print("[JackMidi] Client closed")
            except Exception:
                pass

        self._jack_client = None
        self._midi_out_port = None
        self._connected = False
    
    def set_channel(self, channel: Optional[int]) -> None:
        """Set default MIDI channel (1-16) or None for all."""
        self._channel = channel
        if channel is not None:
            print(f"[JackMidi] Channel set to: {channel}")
        else:
            print("[JackMidi] Channel set to: ALL (omni)")
    
    def _get_channels(self, channel: Optional[int] = None) -> List[int]:
        """Get list of 0-based channel indices to send on."""
        if channel is not None:
            return [channel - 1]
        elif self._channel is not None:
            return [self._channel - 1]
        else:
            return list(range(16))
    
    def send_note_on(self, note: NoteObject, velocity: int, channel: Optional[int] = None) -> None:
        """
        Send note-on message with State Guard protection.

        If the note is already on, kills it first to prevent "Note Shadowing".
        """
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)

        with self._send_lock:
            # If the note is already on, kill it first
            if midi_note in self._active_notes:
                for ch in channels:
                    message = bytes([0x90 + ch, midi_note, 0])
                    self._queue_midi_event(message)

            # Now play the new note
            for ch in channels:
                message = bytes([0x90 + ch, midi_note, velocity])
                self._queue_midi_event(message)
            self._active_notes.add(midi_note)
    
    def send_note_off(self, note: NoteObject, channel: Optional[int] = None) -> None:
        """
        Send note-off message with State Guard protection.

        Only sends Note Off if the note is actually active.
        """
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)

        with self._send_lock:
            if midi_note in self._active_notes:
                for ch in channels:
                    # Send 0x90 velocity 0 (Note ON with velocity 0)
                    message = bytes([0x90 + ch, midi_note, 0])
                    self._queue_midi_event(message)
                self._active_notes.discard(midi_note)
    
    def send_note(self, note: NoteObject, velocity: int, duration: float = 1.5,
                  channel: Optional[int] = None) -> None:
        """
        Send note with automatic note-off after duration.

        Uses State Guard to prevent Note Shadowing during rapid strumming.
        Uses single scheduler thread (reliable on Pi with daemon=False).
        """
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)
        note_key = (midi_note, tuple(channels))

        # Cancel existing scheduled note-off for this note
        self._scheduler.cancel(note_key)
        self._scheduled_note_keys.discard(note_key)

        # Send note-on with State Guard protection
        with self._send_lock:
            # If the note is already on, kill it first (prevents orphaned notes)
            if midi_note in self._active_notes:
                for ch in channels:
                    message = bytes([0x90 + ch, midi_note, 0])
                    self._queue_midi_event(message)

            # Now play the new note
            for ch in channels:
                message = bytes([0x90 + ch, midi_note, velocity])
                self._queue_midi_event(message)
            self._active_notes.add(midi_note)

        # Schedule note-off
        def send_off() -> None:
            if self.is_connected:
                with self._send_lock:
                    if midi_note in self._active_notes:
                        for ch in channels:
                            message = bytes([0x90 + ch, midi_note, 0])
                            self._queue_midi_event(message)
                        self._active_notes.discard(midi_note)
            self._scheduled_note_keys.discard(note_key)

        self._scheduler.schedule(note_key, duration, send_off)
        self._scheduled_note_keys.add(note_key)
    
    def release_notes(self, notes: List[NoteObject]) -> None:
        """
        Immediately release specific notes with State Guard protection.
        """
        if not self.is_connected or not notes:
            return

        channels = self._get_channels()

        with self._send_lock:
            for note in notes:
                midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
                note_key = (midi_note, tuple(channels))

                # Cancel scheduled note-off
                self._scheduler.cancel(note_key)
                self._scheduled_note_keys.discard(note_key)

                # Send note-off only if note is active
                if midi_note in self._active_notes:
                    for ch in channels:
                        message = bytes([0x90 + ch, midi_note, 0])
                        self._queue_midi_event(message)
                    self._active_notes.discard(midi_note)
    
    def send_pitch_bend(self, bend_value: float) -> None:
        """Send pitch bend message."""
        if not self.is_connected:
            return
        
        # Clamp and convert to 14-bit value
        bend_value = max(-1.0, min(1.0, bend_value))
        midi_bend = int((bend_value + 1.0) * 8192)
        midi_bend = max(0, min(16383, midi_bend))
        
        lsb = midi_bend & 0x7F
        msb = (midi_bend >> 7) & 0x7F
        
        channels = self._get_channels()
        for ch in channels:
            message = bytes([0xE0 + ch, lsb, msb])
            self._queue_midi_event(message)
