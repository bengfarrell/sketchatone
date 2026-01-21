"""
Strummer

Strummer class for detecting strum events from tablet input.
Ported from midi-strummer/server/strummer.py
"""

from typing import List, Optional, Dict, Any, Tuple
import time
from dataclasses import asdict

from ..models.note import NoteObject
from ..utils.event_emitter import EventEmitter


class Strummer(EventEmitter):
    """
    Strummer class for detecting strum events from tablet input.
    
    The strummer divides the tablet width into "strings" based on the number of notes.
    When the pen moves across strings with sufficient pressure, it triggers strum events.
    
    Events emitted:
        - 'strum': When notes are strummed (data: {'type': 'strum', 'notes': [...]})
        - 'release': When pressure is released (data: {'type': 'release', 'velocity': int})
        - 'notes_changed': When the notes list changes
    """
    
    def __init__(self):
        super().__init__()
        self._width: float = 1.0
        self._height: float = 1.0
        self._notes: List[NoteObject] = []
        self.last_x: float = -1.0
        self.last_strummed_index: int = -1
        self.last_pressure: float = 0.0
        self.last_timestamp: float = 0.0
        self.pressure_velocity: float = 0.0  # Rate of pressure change
        self.pressure_threshold: float = 0.1  # Minimum pressure to trigger a strum
        self.velocity_scale: float = 4.0  # Scale factor for pressure velocity to MIDI velocity
        self.last_strum_velocity: int = 0  # Last calculated velocity for release event
        
        # Pressure buffering for accurate velocity sensing on quick taps
        self.pressure_buffer: List[Tuple[float, float]] = []  # List of (pressure, timestamp) tuples
        self.buffer_max_samples: int = 3  # Number of samples to collect before triggering
        self.pending_tap_index: int = -1  # Index of pending tap waiting for buffer

    @property
    def notes(self) -> List[NoteObject]:
        return self._notes

    @notes.setter
    def notes(self, notes: List[NoteObject]) -> None:
        self._notes = notes
        self.update_bounds(self._width, self._height)
        # Emit event when notes change
        self.emit('notes_changed')
    
    def get_notes_state(self) -> Dict[str, Any]:
        """
        Get the current notes state as a dictionary for broadcasting.
        
        Returns:
            Dictionary with type, notes, stringCount, baseNotes, and timestamp
        """
        # Get base notes (non-secondary) as NoteObject instances for recalculation
        base_notes = [note for note in self._notes if not note.secondary]
        
        return {
            'type': 'notes',
            'notes': [asdict(note) for note in self._notes],
            'stringCount': len(self._notes),
            'baseNotes': [asdict(note) for note in base_notes],
            'timestamp': time.time()
        }

    def strum(self, x: float, pressure: float) -> Optional[Dict[str, Any]]:
        """
        Process strumming input and return dict with type and notes/velocities if triggered.
        
        Args:
            x: X position on the tablet (0 to width)
            pressure: Pen pressure (0 to 1)
            
        Returns:
            Dictionary with strum event data, or None if no event triggered
        """
        if len(self._notes) > 0:
            string_width = self._width / len(self._notes)
            index = min(int(x / string_width), len(self._notes) - 1)
            
            # Calculate time delta and pressure velocity
            current_time = time.time()
            time_delta = current_time - self.last_timestamp if self.last_timestamp > 0 else 0.001
            
            # Calculate pressure velocity (rate of change)
            pressure_delta = pressure - self.last_pressure
            self.pressure_velocity = pressure_delta / time_delta if time_delta > 0 else 0.0
            
            # Check if we have sufficient pressure (used in multiple places)
            has_sufficient_pressure = pressure >= self.pressure_threshold
            
            # Detect pressure transitions (pen down/up)
            pressure_down = self.last_pressure < self.pressure_threshold and pressure >= self.pressure_threshold
            pressure_up = self.last_pressure >= self.pressure_threshold and pressure < self.pressure_threshold
            
            # Handle pressure release - return release event with last velocity
            if pressure_up:
                # Store the last velocity before resetting
                release_velocity = self.last_strum_velocity
                
                # Reset strummed index and buffer when pressure is released
                self.last_strummed_index = -1
                self.last_pressure = pressure
                self.last_timestamp = current_time
                self.pressure_velocity = 0.0
                self.pressure_buffer.clear()
                self.pending_tap_index = -1
                self.last_strum_velocity = 0
                
                # Return release event if we had a previous strum
                if release_velocity > 0:
                    return {'type': 'release', 'velocity': release_velocity}
                
                return None
            
            # Handle new tap - start buffering
            if pressure_down and (self.last_strummed_index == -1 or self.last_strummed_index != index):
                # Include the previous pressure (before threshold) to capture the initial velocity spike
                # Store the initial low pressure to measure from the beginning
                self.pressure_buffer = [(self.last_pressure, self.last_timestamp), (pressure, current_time)]
                self.pending_tap_index = index
                self.last_x = x
                self.last_pressure = pressure
                self.last_timestamp = current_time
                return None  # Don't trigger yet, need to buffer
            
            # Handle case where pressure is already high on first sample (timing issue)
            # If we have sufficient pressure but no previous strum, treat this as an initial tap
            if has_sufficient_pressure and self.last_strummed_index == -1 and self.pending_tap_index == -1:
                # Start buffering with current sample
                self.pressure_buffer = [(pressure, current_time)]
                self.pending_tap_index = index
                self.last_x = x
                self.last_pressure = pressure
                self.last_timestamp = current_time
                return None  # Start buffering
            
            # Continue buffering if we have a pending tap
            if self.pending_tap_index != -1 and len(self.pressure_buffer) < self.buffer_max_samples:
                self.pressure_buffer.append((pressure, current_time))
                self.last_x = x
                self.last_pressure = pressure
                self.last_timestamp = current_time
                
                # Once buffer is full, trigger the note with calculated velocity
                if len(self.pressure_buffer) >= self.buffer_max_samples:
                    # Use current pressure as the main velocity indicator
                    # This is more intuitive - harder press = louder note
                    # Map pressure (0.0-1.0) to MIDI velocity (20-127)
                    current_pressure = pressure
                    
                    # Apply velocity scaling and map to MIDI range
                    # Pressure range: 0.1 (threshold) to 1.0 → Velocity: 20 to 127
                    normalized_pressure = (current_pressure - self.pressure_threshold) / (1.0 - self.pressure_threshold)
                    normalized_pressure = max(0.0, min(1.0, normalized_pressure))
                    
                    # Scale to velocity range (20-127)
                    midi_velocity = int(20 + normalized_pressure * 107)
                    midi_velocity = max(20, min(127, midi_velocity))
                    
                    # Store velocity for potential release event
                    self.last_strum_velocity = midi_velocity
                    
                    note = self._notes[self.pending_tap_index]
                    self.last_strummed_index = self.pending_tap_index
                    self.pending_tap_index = -1
                    self.pressure_buffer.clear()
                    
                    return {'type': 'strum', 'notes': [{'note': note, 'velocity': midi_velocity}]}
                
                return None  # Still buffering
            
            self.last_x = x
            self.last_pressure = pressure
            self.last_timestamp = current_time
            
            # Handle strumming across strings (index changed while pressure maintained)
            if has_sufficient_pressure and self.last_strummed_index != -1 and self.last_strummed_index != index:
                # Strumming across strings - use current pressure
                # Minimum velocity of 20 for audibility
                midi_velocity = max(20, int(pressure * 127))
                notes_to_play = []

                # Determine direction for proper ordering
                if self.last_strummed_index < index:
                    # Moving right/forward
                    indices = range(self.last_strummed_index + 1, index + 1)
                else:
                    # Moving left/backward  
                    indices = range(self.last_strummed_index - 1, index - 1, -1)
                
                for i in indices:
                    note = self._notes[i]
                    notes_to_play.append({
                        'note': note,
                        'velocity': midi_velocity
                    })
                
                # Store velocity for potential release event
                self.last_strum_velocity = midi_velocity
                
                self.last_strummed_index = index
                return {'type': 'strum', 'notes': notes_to_play} if notes_to_play else None
                
        return None

    def clear_strum(self) -> None:
        """Clear the last strummed index and pressure"""
        self.last_strummed_index = -1
        self.last_pressure = 0.0
        self.last_timestamp = 0.0
        self.pressure_velocity = 0.0
        self.last_strum_velocity = 0
        self.pressure_buffer.clear()
        self.pending_tap_index = -1

    def configure(self, pluck_velocity_scale: float = 4.0, pressure_threshold: float = 0.1) -> None:
        """Configure strummer parameters"""
        self.velocity_scale = pluck_velocity_scale
        self.pressure_threshold = pressure_threshold

    def update_bounds(self, width: float, height: float) -> None:
        """Update the bounds of the strummer"""
        self._width = width
        self._height = height
