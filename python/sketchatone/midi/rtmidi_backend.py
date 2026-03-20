"""
RtMidi Backend

MIDI output backend using python-rtmidi for cross-platform MIDI support.
"""

import threading
import time
from typing import Optional, List, Tuple, Set

try:
    import rtmidi
except ImportError:
    rtmidi = None

from .protocol import MidiBackendProtocol
from ..models.note import Note, NoteObject
from .note_scheduler import get_scheduler


class RtMidiBackend(MidiBackendProtocol):
    """
    MIDI backend using python-rtmidi.

    Works on macOS, Windows, and Linux with ALSA.

    Example:
        backend = RtMidiBackend(channel=0)  # MIDI channel 1 (0-based)
        backend.connect()
        backend.send_note(note, velocity=100, duration=1.0)
        backend.disconnect()
    """

    def __init__(self, channel: Optional[int] = None, inter_message_delay: float = 0.0):
        """
        Initialize the rtmidi backend.

        Args:
            channel: Default MIDI channel (0-15 internal representation, displayed as 1-16 to users),
                or None for omni mode (sends to all 16 channels). Note: CLI and user-facing interfaces use 1-16.
            inter_message_delay: Seconds to wait after each MIDI message (default 0).
                Use e.g. 0.002 (2 ms) on Raspberry Pi when notes stick with direct USB (e.g. Juno DS).
        """
        if rtmidi is None:
            raise ImportError(
                "python-rtmidi not installed. "
                "Install with: pip install python-rtmidi"
            )

        self._last_send_time = 0
        self._channel = channel
        self._midi_out: Optional[rtmidi.MidiOut] = None
        self._connected = False
        self._current_output_name: Optional[str] = None
        self._inter_message_delay = max(0.0, float(inter_message_delay))

        # Serialize all MIDI output to avoid RtMIDI/ALSA contention (fixes stuck notes on RPi when strumming fast)
        self._send_lock = threading.Lock()
        # Note-off via single scheduler thread (threading.Timer often never runs on Pi when main thread is busy)
        self._scheduler = get_scheduler()
        self._scheduled_note_keys: Set[Tuple[int, Tuple[int, ...]]] = set()

        # State Guard: Track active notes to prevent "Note Shadowing" (sending Note On twice without Note Off)
        self._active_notes: Set[int] = set()
        self._last_send_time = 0.0

    def _send(self, message) -> None:
        """
        Send one MIDI message with global throttling to protect hardware buffers.
        Call only while holding _send_lock.
        """
        if self._inter_message_delay > 0:
            now = time.time()
            # Calculate if we need to wait to maintain the inter-message gap
            wait = (self._last_send_time + self._inter_message_delay) - now
            if wait > 0:
                time.sleep(wait)
    
        self._midi_out.send_message(message)
        self._last_send_time = time.time() # Track last physical send

    @property
    def is_connected(self) -> bool:
        return self._connected and self._midi_out is not None

    @property
    def current_output_name(self) -> Optional[str]:
        """Get the name of the currently connected output port."""
        return self._current_output_name
    
    def get_available_ports(self) -> List[str]:
        """Get list of available MIDI output ports."""
        try:
            temp_out = rtmidi.MidiOut()
            ports = temp_out.get_ports()
            del temp_out
            return ports
        except Exception:
            return []
    
    def connect(self, output_port: Optional[str] = None) -> bool:
        """
        Connect to MIDI output.

        Args:
            output_port: Port name or index (as string). If None, uses first available.

        Returns:
            True if connection successful
        """
        try:
            self._midi_out = rtmidi.MidiOut()
            available_ports = self._midi_out.get_ports()

            if not available_ports:
                print("[RtMidi] Warning: No MIDI output ports available")
                # Create virtual port as fallback
                self._midi_out.open_virtual_port("Sketchatone")
                print("[RtMidi] Created virtual port: Sketchatone")
                print("[RtMidi] Debug: note-off via NoteScheduler (single thread)")
                self._current_output_name = "Sketchatone"
                self._connected = True
                return True

            # Print available ports for debugging
            print(f"[RtMidi] Available MIDI output ports:")
            for i, port in enumerate(available_ports):
                print(f"[RtMidi]   {i}: {port}")

            # Resolve port
            port_index = 0
            if output_port is not None:
                port_index = self._resolve_port(output_port, available_ports)

            self._midi_out.open_port(port_index)
            self._current_output_name = available_ports[port_index]
            print(f"[RtMidi] Connected to: {self._current_output_name}")
            print("[RtMidi] Debug: note-off via NoteScheduler (single thread)")
            self._connected = True
            return True

        except Exception as e:
            print(f"[RtMidi] Connection failed: {e}")
            self._current_output_name = None
            self._connected = False
            return False
    
    def _resolve_port(self, port_id, available_ports: List[str]) -> int:
        """Resolve port identifier to index.

        Args:
            port_id: Can be an int (port index) or str (port name or partial match)
            available_ports: List of available port names

        Returns:
            Port index to use
        """
        # If it's already an int, use it directly as index
        if isinstance(port_id, int):
            if 0 <= port_id < len(available_ports):
                return port_id
            print(f"[RtMidi] Port index {port_id} out of range, using port 0")
            return 0

        # It's a string - try to parse as int first
        try:
            index = int(port_id)
            if 0 <= index < len(available_ports):
                return index
        except (ValueError, TypeError):
            pass

        # Try as name (exact or partial match)
        port_str = str(port_id)
        for idx, name in enumerate(available_ports):
            if port_str == name or port_str in name:
                return idx

        print(f"[RtMidi] Port '{port_id}' not found, using port 0")
        return 0
    
    def disconnect(self) -> None:
        """Disconnect and clean up."""
        for note_key in list(self._scheduled_note_keys):
            self._scheduler.cancel(note_key)
        self._scheduled_note_keys.clear()

        if self._midi_out:
            # Send "All Notes Off" and "Reset All Controllers" on all channels
            # to clean up any stuck notes or pitch bend
            try:
                for ch in range(16):
                    with self._send_lock:
                        self._send([0xB0 + ch, 123, 0])
                    if self._inter_message_delay > 0:
                        time.sleep(self._inter_message_delay)
                    with self._send_lock:
                        self._send([0xB0 + ch, 121, 0])
                    if self._inter_message_delay > 0:
                        time.sleep(self._inter_message_delay)
                    with self._send_lock:
                        self._send([0xE0 + ch, 0x00, 0x40])
                    if self._inter_message_delay > 0:
                        time.sleep(self._inter_message_delay)
            except Exception as e:
                print(f"[RtMidi] Error sending cleanup messages: {e}")

            self._midi_out.close_port()
            self._midi_out = None

        self._connected = False
        print("[RtMidi] Disconnected")
    
    def set_channel(self, channel: Optional[int]) -> None:
        """Set default MIDI channel (0-15, 0-based) or None for omni (all channels)."""
        self._channel = channel
        if channel is not None:
            # Display as 1-based for user-friendliness
            print(f"[RtMidi] Channel set to: {channel + 1}")
        else:
            print("[RtMidi] Channel set to: ALL (omni)")
    
    def _get_channels(self, channel: Optional[int] = None) -> List[int]:
        """
        Get list of 0-based channel indices to send on.

        Args:
            channel: 0-based MIDI channel (0-15), or None to use default

        Returns:
            List of 0-based channel indices
        """
        if channel is not None:
            # Channel is already 0-based (0-15)
            return [channel]
        elif self._channel is not None:
            # Default channel is also 0-based
            return [self._channel]
        else:
            # None = omni mode (all 16 channels)
            return list(range(16))
    
    def send_note_on(self, note: NoteObject, velocity: int, channel: Optional[int] = None) -> None:
        """
        Send note-on message with State Guard protection.

        If the note is already on, kills it first to prevent "Note Shadowing"
        (sending Note On twice without Note Off causes orphaned notes on hardware synths).
        """
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)

        with self._send_lock:
            # If the note is already on, kill it first (Standard Strum Practice)
            if midi_note in self._active_notes:
                for ch in channels:
                    self._send([0x90 + ch, midi_note, 0])

            # Now play the new note
            for ch in channels:
                self._send([0x90 + ch, midi_note, velocity])
            self._active_notes.add(midi_note)
    
    def send_note_off(self, note: NoteObject, channel: Optional[int] = None) -> None:
        """
        Send note-off message with State Guard protection.

        Only sends Note Off if the note is actually active, preventing
        redundant messages that could confuse the synth's voice allocator.
        """
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)

        with self._send_lock:
            if midi_note in self._active_notes:
                for ch in channels:
                    # Send 0x90 velocity 0 (Note ON with velocity 0)
                    self._send([0x90 + ch, midi_note, 0])
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

        self._scheduler.cancel(note_key)
        self._scheduled_note_keys.discard(note_key)

        # Send note-on with State Guard protection
        with self._send_lock:
            # If the note is already on, kill it first (prevents orphaned notes)
            if midi_note in self._active_notes:
                for ch in channels:
                    self._send([0x90 + ch, midi_note, 0])

            # Now play the new note
            for ch in channels:
                self._send([0x90 + ch, midi_note, velocity])
            self._active_notes.add(midi_note)

        def send_off() -> None:
            if self.is_connected and self._midi_out:
                with self._send_lock:
                    if midi_note in self._active_notes:
                        for ch in channels:
                            self._send([0x90 + ch, midi_note, 0])
                        self._active_notes.discard(midi_note)
            self._scheduled_note_keys.discard(note_key)

        self._scheduler.schedule(note_key, duration, send_off)
        self._scheduled_note_keys.add(note_key)

    def send_raw_note(self, midi_note: int, velocity: int, duration: float = 1.5,
                      channel: Optional[int] = None) -> None:
        """
        Send a raw MIDI note number with State Guard protection.
        """
        if not self.is_connected:
            return

        channels = self._get_channels(channel)
        note_key = (midi_note, tuple(channels))

        self._scheduler.cancel(note_key)
        self._scheduled_note_keys.discard(note_key)

        # Send note-on with State Guard protection
        with self._send_lock:
            # If the note is already on, kill it first
            if midi_note in self._active_notes:
                for ch in channels:
                    self._send([0x90 + ch, midi_note, 0])

            # Now play the new note
            for ch in channels:
                self._send([0x90 + ch, midi_note, velocity])
            self._active_notes.add(midi_note)

        def send_off() -> None:
            if self.is_connected and self._midi_out:
                with self._send_lock:
                    if midi_note in self._active_notes:
                        for ch in channels:
                            self._send([0x90 + ch, midi_note, 0])
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

                self._scheduler.cancel(note_key)
                self._scheduled_note_keys.discard(note_key)

                if midi_note in self._active_notes:
                    for ch in channels:
                        self._send([0x90 + ch, midi_note, 0])
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
            with self._send_lock:
                self._send([0xE0 + ch, lsb, msb])
            if self._inter_message_delay > 0:
                time.sleep(self._inter_message_delay)