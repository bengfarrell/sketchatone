"""
Mock MIDI Backend for Unit Testing

Provides a fake MIDI backend that records all MIDI messages
without requiring actual MIDI hardware or virtual ports.
"""

import time
import threading
from typing import List, Optional, Set, Dict, Any, Union
from sketchatone.midi.protocol import MidiBackendProtocol
from sketchatone.models.note import NoteObject


class MidiMessage:
    """Represents a recorded MIDI message"""
    
    def __init__(
        self,
        msg_type: str,
        timestamp: float,
        note: Optional[NoteObject] = None,
        velocity: Optional[int] = None,
        channel: Optional[int] = None,
        bend_value: Optional[float] = None,
        raw_bytes: Optional[bytes] = None
    ):
        self.type = msg_type
        self.timestamp = timestamp
        self.note = note
        self.velocity = velocity
        self.channel = channel
        self.bend_value = bend_value
        self.raw_bytes = raw_bytes
    
    def __repr__(self):
        return f"MidiMessage(type={self.type}, channel={self.channel}, note={self.note})"


class MockMidiBackend(MidiBackendProtocol):
    """Mock MIDI backend that records all sent messages for testing"""

    def __init__(
        self,
        channel: Optional[int] = None,
        inter_message_delay: float = 0.0,
        device_monitoring: Union[int, bool] = False,
        **kwargs  # Accept but ignore other options like useVirtualPorts, virtualPortName
    ):
        """
        Initialize mock backend.

        Args:
            channel: Default MIDI channel (0-15)
            inter_message_delay: Ignored by mock (accepted for compatibility)
            device_monitoring: Ignored by mock (accepted for compatibility)
            **kwargs: Other options ignored by mock (accepted for compatibility)
        """
        self._is_connected = False
        self._current_output_name: Optional[str] = None
        self._channel = channel if channel is not None else 0
        self._messages: List[MidiMessage] = []
        self._active_notes: Set[str] = set()
        self._available_ports = ['Mock Port 1', 'Mock Port 2', 'Mock Virtual Port']
        self._note_timers: Dict[str, threading.Timer] = {}
        self._lock = threading.Lock()
    
    @property
    def is_connected(self) -> bool:
        return self._is_connected
    
    @property
    def current_output_name(self) -> Optional[str]:
        return self._current_output_name
    
    def connect(self, output_port: Optional[str | int] = None) -> bool:
        self._is_connected = True
        if isinstance(output_port, str):
            self._current_output_name = output_port
        elif isinstance(output_port, int):
            self._current_output_name = self._available_ports[output_port] if output_port < len(self._available_ports) else None
        else:
            self._current_output_name = self._available_ports[0]
        return True
    
    def disconnect(self) -> None:
        self._is_connected = False
        self._current_output_name = None
        with self._lock:
            self._active_notes.clear()
            # Cancel all pending timers
            for timer in self._note_timers.values():
                timer.cancel()
            self._note_timers.clear()
    
    def send_note_on(self, note: NoteObject, velocity: int, channel: Optional[int] = None) -> None:
        ch = channel if channel is not None else self._channel
        # Store note as string: "notation_octave_channel" (e.g., "C_4_0")
        note_key = f"{note.notation}_{note.octave}_{ch}"
        with self._lock:
            self._active_notes.add(note_key)
            self._messages.append(MidiMessage(
                msg_type='note_on',
                timestamp=time.time(),
                note=note,
                velocity=velocity,
                channel=ch
            ))

    def send_note_off(self, note: NoteObject, channel: Optional[int] = None) -> None:
        ch = channel if channel is not None else self._channel
        note_key = f"{note.notation}_{note.octave}_{ch}"
        with self._lock:
            self._active_notes.discard(note_key)
            self._messages.append(MidiMessage(
                msg_type='note_off',
                timestamp=time.time(),
                note=note,
                channel=ch
            ))
    
    def send_note(self, note: NoteObject, velocity: int, duration: float = 1.5,
                  channel: Optional[int] = None) -> None:
        self.send_note_on(note, velocity, channel)

        def note_off_callback():
            self.send_note_off(note, channel)

        timer = threading.Timer(duration, note_off_callback)
        ch = channel if channel is not None else self._channel
        note_key = f"{note.notation}_{note.octave}_{ch}"
        with self._lock:
            self._note_timers[note_key] = timer
        timer.start()
    
    def release_notes(self, notes: List[NoteObject]) -> None:
        for note in notes:
            self.send_note_off(note)
    
    def release_all(self) -> None:
        with self._lock:
            self._active_notes.clear()
    
    def set_channel(self, channel: Optional[int]) -> None:
        self._channel = channel if channel is not None else 0
    
    def send_pitch_bend(self, bend_value: float) -> None:
        with self._lock:
            self._messages.append(MidiMessage(
                msg_type='pitch_bend',
                timestamp=time.time(),
                bend_value=bend_value,
                channel=self._channel
            ))
    
    def get_available_ports(self) -> List[str]:
        return list(self._available_ports)
    
    # Test helper methods
    def get_messages(self) -> List[MidiMessage]:
        """Get all recorded messages"""
        with self._lock:
            return list(self._messages)
    
    def clear_messages(self) -> None:
        """Clear all recorded messages"""
        with self._lock:
            self._messages.clear()

    def get_active_notes(self) -> List[str]:
        """Get all active notes"""
        with self._lock:
            return list(self._active_notes)

    def set_available_ports(self, ports: List[str]) -> None:
        """Set available ports for testing"""
        self._available_ports = ports

    def send_raw_message(self, message_bytes: bytes) -> None:
        """Simulate sending a raw MIDI message (for passthrough testing)"""
        with self._lock:
            self._messages.append(MidiMessage(
                msg_type='raw',
                timestamp=time.time(),
                raw_bytes=message_bytes
            ))

