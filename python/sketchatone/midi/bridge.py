"""
MIDI Strummer Bridge

Connects Strummer events to MIDI output backends.
"""

from typing import Optional, List, Dict, Any
from ..strummer.strummer import Strummer
from ..models.note import NoteObject
from .protocol import MidiBackendProtocol


class MidiStrummerBridge:
    """
    Bridge that connects Strummer events to a MIDI backend.
    
    Listens for strum and release events from the Strummer and
    sends corresponding MIDI note-on/note-off messages through
    the configured backend.
    
    Example:
        from sketchatone import Strummer
        from sketchatone.midi import MidiStrummerBridge, RtMidiBackend
        
        # Create strummer and backend
        strummer = Strummer()
        backend = RtMidiBackend(channel=1)
        backend.connect()
        
        # Create bridge - automatically connects events
        bridge = MidiStrummerBridge(strummer, backend)
        
        # Configure note duration
        bridge.note_duration = 2.0
        
        # Now strummer.strum() calls will send MIDI notes
        strummer.notes = [NoteObject(...), ...]
        event = strummer.strum(x=0.5, pressure=0.8)
        # MIDI notes are automatically sent!
        
        # Clean up
        bridge.disconnect()
        backend.disconnect()
    """
    
    def __init__(self, strummer: Strummer, backend: MidiBackendProtocol,
                 note_duration: float = 1.5, auto_connect: bool = True):
        """
        Initialize the bridge.
        
        Args:
            strummer: The Strummer instance to listen to
            backend: The MIDI backend to send notes through
            note_duration: Default duration for notes in seconds
            auto_connect: If True, automatically connect event listeners
        """
        self._strummer = strummer
        self._backend = backend
        self._note_duration = note_duration
        self._connected = False
        self._active_notes: List[NoteObject] = []
        
        if auto_connect:
            self.connect()
    
    @property
    def strummer(self) -> Strummer:
        """Get the connected Strummer instance."""
        return self._strummer
    
    @property
    def backend(self) -> MidiBackendProtocol:
        """Get the MIDI backend."""
        return self._backend
    
    @property
    def note_duration(self) -> float:
        """Get/set the default note duration in seconds."""
        return self._note_duration
    
    @note_duration.setter
    def note_duration(self, value: float) -> None:
        self._note_duration = max(0.1, value)
    
    @property
    def is_connected(self) -> bool:
        """Check if the bridge is connected to strummer events."""
        return self._connected
    
    def connect(self) -> None:
        """Connect event listeners to the strummer."""
        if self._connected:
            return
        
        self._strummer.on('strum', self._on_strum)
        self._strummer.on('release', self._on_release)
        self._connected = True
    
    def disconnect(self) -> None:
        """Disconnect event listeners and release any active notes."""
        if not self._connected:
            return
        
        # Release any active notes
        if self._active_notes:
            self._backend.release_notes(self._active_notes)
            self._active_notes.clear()
        
        self._strummer.off('strum', self._on_strum)
        self._strummer.off('release', self._on_release)
        self._connected = False
    
    def _on_strum(self, event: Dict[str, Any]) -> None:
        """Handle strum events from the strummer."""
        if event.get('type') != 'strum':
            return
        
        notes_data = event.get('notes', [])
        
        for note_data in notes_data:
            note = note_data.get('note')
            velocity = note_data.get('velocity', 100)
            
            if note is None:
                continue
            
            # Track active note
            self._active_notes.append(note)
            
            # Send MIDI note
            self._backend.send_note(
                note=note,
                velocity=velocity,
                duration=self._note_duration
            )
    
    def _on_release(self, event: Dict[str, Any]) -> None:
        """Handle release events from the strummer."""
        if event.get('type') != 'release':
            return
        
        # Release all active notes immediately
        if self._active_notes:
            self._backend.release_notes(self._active_notes)
            self._active_notes.clear()
    
    def process_strum(self, x: float, pressure: float) -> Optional[Dict[str, Any]]:
        """
        Convenience method to process a strum and send MIDI in one call.
        
        This is useful when you want to manually control the strum processing
        rather than relying on the event system.
        
        Args:
            x: X position (0 to 1)
            pressure: Pressure (0 to 1)
            
        Returns:
            The strum event if triggered, None otherwise
        """
        event = self._strummer.strum(x, pressure)
        
        if event:
            if event.get('type') == 'strum':
                self._on_strum(event)
            elif event.get('type') == 'release':
                self._on_release(event)
        
        return event
    
    def release_all(self) -> None:
        """Release all currently active notes."""
        if self._active_notes:
            self._backend.release_notes(self._active_notes)
            self._active_notes.clear()
