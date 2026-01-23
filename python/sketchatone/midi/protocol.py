"""
MIDI Backend Protocol

Defines the interface that all MIDI backends must implement.
"""

from abc import ABC, abstractmethod
from typing import Optional, List
from ..models.note import NoteObject


class MidiBackendProtocol(ABC):
    """
    Abstract base class defining the MIDI backend interface.
    
    All MIDI backends (rtmidi, JACK, etc.) must implement this interface
    to be compatible with MidiStrummerBridge.
    """
    
    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Check if the backend is connected and ready to send MIDI."""
        pass
    
    @abstractmethod
    def connect(self, output_port: Optional[str] = None) -> bool:
        """
        Connect to MIDI output.
        
        Args:
            output_port: Optional port identifier (name or index)
            
        Returns:
            True if connection successful, False otherwise
        """
        pass
    
    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from MIDI output and clean up resources."""
        pass
    
    @abstractmethod
    def send_note_on(self, note: NoteObject, velocity: int, channel: Optional[int] = None) -> None:
        """
        Send a MIDI note-on message.
        
        Args:
            note: The note to play
            velocity: MIDI velocity (0-127)
            channel: MIDI channel (1-16), or None to use default
        """
        pass
    
    @abstractmethod
    def send_note_off(self, note: NoteObject, channel: Optional[int] = None) -> None:
        """
        Send a MIDI note-off message.
        
        Args:
            note: The note to stop
            channel: MIDI channel (1-16), or None to use default
        """
        pass
    
    @abstractmethod
    def send_note(self, note: NoteObject, velocity: int, duration: float = 1.5, 
                  channel: Optional[int] = None) -> None:
        """
        Send a MIDI note with automatic note-off after duration.
        
        Args:
            note: The note to play
            velocity: MIDI velocity (0-127)
            duration: Duration in seconds before note-off
            channel: MIDI channel (1-16), or None to use default
        """
        pass
    
    @abstractmethod
    def release_notes(self, notes: List[NoteObject]) -> None:
        """
        Immediately release specific notes.
        
        Args:
            notes: List of notes to release
        """
        pass
    
    @abstractmethod
    def set_channel(self, channel: Optional[int]) -> None:
        """
        Set the default MIDI channel.
        
        Args:
            channel: MIDI channel (1-16), or None for omni/all channels
        """
        pass
    
    def send_pitch_bend(self, bend_value: float) -> None:
        """
        Send a pitch bend message (optional).
        
        Args:
            bend_value: Float between -1.0 (full down) and 1.0 (full up), 0 is center
        """
        pass  # Default no-op, backends can override
    
    def get_available_ports(self) -> List[str]:
        """
        Get list of available MIDI output ports.
        
        Returns:
            List of port names
        """
        return []  # Default empty, backends can override
