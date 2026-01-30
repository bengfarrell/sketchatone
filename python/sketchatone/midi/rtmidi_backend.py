"""
RtMidi Backend

MIDI output backend using python-rtmidi for cross-platform MIDI support.
"""

import threading
import time
from typing import Optional, List, Dict, Tuple

try:
    import rtmidi
except ImportError:
    rtmidi = None

from .protocol import MidiBackendProtocol
from ..models.note import Note, NoteObject


class RtMidiBackend(MidiBackendProtocol):
    """
    MIDI backend using python-rtmidi.

    Works on macOS, Windows, and Linux with ALSA.

    Example:
        backend = RtMidiBackend(channel=1)
        backend.connect()
        backend.send_note(note, velocity=100, duration=1.0)
        backend.disconnect()
    """

    def __init__(self, channel: Optional[int] = None):
        """
        Initialize the rtmidi backend.

        Args:
            channel: Default MIDI channel (1-16), or None for all channels
        """
        if rtmidi is None:
            raise ImportError(
                "python-rtmidi not installed. "
                "Install with: pip install python-rtmidi"
            )

        self._channel = channel
        self._midi_out: Optional[rtmidi.MidiOut] = None
        self._connected = False
        self._current_output_name: Optional[str] = None

        # Note timing management
        self._active_note_timers: Dict[Tuple[int, Tuple[int, ...]], threading.Timer] = {}
        self._timer_lock = threading.Lock()

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
                self._current_output_name = "Sketchatone"
                self._connected = True
                return True

            # Resolve port
            port_index = 0
            if output_port is not None:
                port_index = self._resolve_port(output_port, available_ports)

            self._midi_out.open_port(port_index)
            self._current_output_name = available_ports[port_index]
            print(f"[RtMidi] Connected to: {self._current_output_name}")
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
        # Cancel all active timers
        with self._timer_lock:
            for timer in self._active_note_timers.values():
                timer.cancel()
            self._active_note_timers.clear()

        if self._midi_out:
            # Send "All Notes Off" and "Reset All Controllers" on all channels
            # to clean up any stuck notes or pitch bend
            try:
                for ch in range(16):
                    # All Notes Off (CC 123)
                    self._midi_out.send_message([0xB0 + ch, 123, 0])
                    # Reset All Controllers (CC 121)
                    self._midi_out.send_message([0xB0 + ch, 121, 0])
                    # Reset pitch bend to center
                    self._midi_out.send_message([0xE0 + ch, 0x00, 0x40])
            except Exception as e:
                print(f"[RtMidi] Error sending cleanup messages: {e}")

            self._midi_out.close_port()
            self._midi_out = None

        self._connected = False
        print("[RtMidi] Disconnected")
    
    def set_channel(self, channel: Optional[int]) -> None:
        """Set default MIDI channel (0-15, 0-based) or None for default (channel 0)."""
        self._channel = channel
        if channel is not None:
            # Display as 1-based for user-friendliness
            print(f"[RtMidi] Channel set to: {channel + 1}")
        else:
            print("[RtMidi] Channel set to: default (1)")
    
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
            # Default to channel 0 (MIDI channel 1)
            return [0]
    
    def send_note_on(self, note: NoteObject, velocity: int, channel: Optional[int] = None) -> None:
        """Send note-on message."""
        if not self.is_connected:
            return
        
        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)
        
        for ch in channels:
            message = [0x90 + ch, midi_note, velocity]
            self._midi_out.send_message(message)
    
    def send_note_off(self, note: NoteObject, channel: Optional[int] = None) -> None:
        """Send note-off message."""
        if not self.is_connected:
            return
        
        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)
        
        for ch in channels:
            message = [0x80 + ch, midi_note, 0x40]
            self._midi_out.send_message(message)
    
    def send_note(self, note: NoteObject, velocity: int, duration: float = 1.5,
                  channel: Optional[int] = None) -> None:
        """Send note with automatic note-off after duration."""
        if not self.is_connected:
            return

        midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
        channels = self._get_channels(channel)
        note_key = (midi_note, tuple(channels))

        # Cancel existing timer for this note
        with self._timer_lock:
            if note_key in self._active_note_timers:
                self._active_note_timers[note_key].cancel()
                del self._active_note_timers[note_key]

        # Send note-on
        for ch in channels:
            message = [0x90 + ch, midi_note, velocity]
            self._midi_out.send_message(message)

        # Schedule note-off
        def send_off():
            if self.is_connected and self._midi_out:
                for ch in channels:
                    message = [0x80 + ch, midi_note, 0x40]
                    self._midi_out.send_message(message)
            with self._timer_lock:
                self._active_note_timers.pop(note_key, None)

        timer = threading.Timer(duration, send_off)
        timer.daemon = True
        with self._timer_lock:
            self._active_note_timers[note_key] = timer
        timer.start()

    def send_raw_note(self, midi_note: int, velocity: int, duration: float = 1.5,
                      channel: Optional[int] = None) -> None:
        """
        Send a raw MIDI note number with automatic note-off after duration.

        Used for features like strum release where we need to send a specific
        MIDI note number rather than a NoteObject.

        Args:
            midi_note: MIDI note number (0-127)
            velocity: MIDI velocity (0-127)
            duration: Duration in seconds before note-off
            channel: MIDI channel (1-16), or None to use default
        """
        if not self.is_connected:
            return

        channels = self._get_channels(channel)
        note_key = (midi_note, tuple(channels))

        # Cancel existing timer for this note
        with self._timer_lock:
            if note_key in self._active_note_timers:
                self._active_note_timers[note_key].cancel()
                del self._active_note_timers[note_key]

        # Send note-on
        for ch in channels:
            message = [0x90 + ch, midi_note, velocity]
            self._midi_out.send_message(message)

        # Schedule note-off
        def send_off():
            if self.is_connected and self._midi_out:
                for ch in channels:
                    message = [0x80 + ch, midi_note, 0x40]
                    self._midi_out.send_message(message)
            with self._timer_lock:
                self._active_note_timers.pop(note_key, None)

        timer = threading.Timer(duration, send_off)
        timer.daemon = True
        with self._timer_lock:
            self._active_note_timers[note_key] = timer
        timer.start()

    def release_notes(self, notes: List[NoteObject]) -> None:
        """Immediately release specific notes."""
        if not self.is_connected or not notes:
            return

        channels = self._get_channels()

        for note in notes:
            midi_note = Note.notation_to_midi(f"{note.notation}{note.octave}")
            note_key = (midi_note, tuple(channels))

            # Cancel timer
            with self._timer_lock:
                if note_key in self._active_note_timers:
                    self._active_note_timers[note_key].cancel()
                    del self._active_note_timers[note_key]

            # Send note-off
            for ch in channels:
                message = [0x80 + ch, midi_note, 0x40]
                self._midi_out.send_message(message)
    
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
            message = [0xE0 + ch, lsb, msb]
            self._midi_out.send_message(message)