"""
Note Model

Note utilities for chord parsing and music theory operations.
Ported from midi-strummer/server/note.py
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import json
import os


@dataclass
class NoteObject:
    """Represents a single note with notation, octave, and secondary flag"""
    notation: str
    octave: int
    secondary: bool = False
    
    def transpose(self, semitones: int) -> 'NoteObject':
        """Transpose the note by a given number of semitones"""
        if semitones == 0:
            return self
        
        # Convert to MIDI note number
        try:
            note_index = Note.sharp_notations.index(self.notation)
        except ValueError:
            try:
                note_index = Note.flat_notations.index(self.notation)
            except ValueError:
                note_index = 0
        
        midi_number = self.octave * 12 + note_index
        
        # Add semitones
        transposed_midi = midi_number + semitones
        
        # Convert back to notation and octave
        new_octave = transposed_midi // 12
        new_note_index = transposed_midi % 12
        
        # Prefer to use the same notation style (sharp vs flat) as the original
        if '#' in self.notation:
            new_notation = Note.sharp_notations[new_note_index]
        elif 'b' in self.notation:
            new_notation = Note.flat_notations[new_note_index]
        else:
            new_notation = Note.sharp_notations[new_note_index]
        
        return NoteObject(notation=new_notation, octave=new_octave, secondary=self.secondary)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'notation': self.notation,
            'octave': self.octave,
            'secondary': self.secondary
        }
    
    def to_midi(self) -> int:
        """Convert to MIDI note number"""
        try:
            note_index = Note.sharp_notations.index(self.notation)
        except ValueError:
            try:
                note_index = Note.flat_notations.index(self.notation)
            except ValueError:
                note_index = 0
        return self.octave * 12 + note_index
    
    def __str__(self) -> str:
        return f"{self.notation}{self.octave}"


class Note:
    """Note static class for music theory operations"""
    
    # Cached key signature lookup table
    keys: Dict[str, Any] = {}
    
    common_notations = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    
    # Incremental tones as sharp notation
    sharp_notations = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    
    # Incremental tones as flat notation
    flat_notations = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
    
    # Odd notations
    odd_notations = ["B#", "Cb", "E#", "Fb"]
    
    # Corrected notations
    corrected_notations = ["C", "C", "F", "F"]
    
    # Chord intervals (semitones from root)
    chord_intervals = {
        # Triads
        'maj': [0, 4, 7],           # Major triad
        'min': [0, 3, 7],           # Minor triad
        'm': [0, 3, 7],             # Minor triad (short form)
        'dim': [0, 3, 6],           # Diminished triad
        'aug': [0, 4, 8],           # Augmented triad
        'sus2': [0, 2, 7],          # Suspended 2nd
        'sus4': [0, 5, 7],          # Suspended 4th
        '5': [0, 7],                # Power chord (root + fifth)
        
        # Seventh chords
        '7': [0, 4, 7, 10],         # Dominant 7th
        'maj7': [0, 4, 7, 11],      # Major 7th
        'min7': [0, 3, 7, 10],      # Minor 7th
        'm7': [0, 3, 7, 10],        # Minor 7th (short form)
        'dim7': [0, 3, 6, 9],       # Diminished 7th
        'aug7': [0, 4, 8, 10],      # Augmented 7th
        'maj9': [0, 4, 7, 11, 14],  # Major 9th
        'min9': [0, 3, 7, 10, 14],  # Minor 9th
        'm9': [0, 3, 7, 10, 14],    # Minor 9th (short form)
        '9': [0, 4, 7, 10, 14],     # Dominant 9th
        
        # Extended chords
        'add9': [0, 4, 7, 14],      # Major add 9
        '6': [0, 4, 7, 9],          # Major 6th
        'min6': [0, 3, 7, 9],       # Minor 6th
        'm6': [0, 3, 7, 9],         # Minor 6th (short form)
    }

    @classmethod
    def index_of_notation(cls, notation: str) -> int:
        """Get notation index when notation is either flat or sharp"""
        try:
            return cls.sharp_notations.index(notation)
        except ValueError:
            try:
                return cls.flat_notations.index(notation)
            except ValueError:
                return -1

    @classmethod
    def notation_at_index(cls, index: int, prefer_flat: bool = False) -> str:
        """Get notation given an index"""
        if index >= len(cls.sharp_notations):
            index = index % len(cls.sharp_notations)
        
        if prefer_flat:
            return cls.flat_notations[index]
        else:
            return cls.sharp_notations[index]

    @classmethod
    def midi_to_notation(cls, index: int) -> str:
        """Translate index from MIDI to notation"""
        position = index % len(cls.sharp_notations)
        return cls.sharp_notations[position]

    @classmethod
    def notation_to_midi(cls, notation: str) -> int:
        """Translate notation and octave to MIDI index"""
        nt_obj = cls.parse_notation(notation)
        try:
            nt_indx = cls.sharp_notations.index(nt_obj.notation)
        except ValueError:
            try:
                nt_indx = cls.flat_notations.index(nt_obj.notation)
            except ValueError:
                nt_indx = 0
        return nt_obj.octave * len(cls.sharp_notations) + nt_indx

    @classmethod
    def sort(cls, notes: List[str]) -> List[str]:
        """Sort notes by octave and then by notation"""
        def sort_key(note: str):
            octave = int(note[-1]) if note[-1].isdigit() else 4
            notation = note[:-1] if note[-1].isdigit() else note
            try:
                notation_index = cls.sharp_notations.index(notation)
            except ValueError:
                notation_index = 0
            return (octave, notation_index)
        
        return sorted(notes, key=sort_key)

    @classmethod
    def parse_notation(cls, notation: str) -> NoteObject:
        """Parse notation to notation and octave"""
        # Only supports one digit octaves
        octave_char = notation[-1]
        if octave_char.isdigit():
            octave = int(octave_char)
            if len(notation) == 3:
                note_notation = notation[:2]
            else:
                note_notation = notation[0]
        else:
            octave = 4  # default
            note_notation = notation
        
        return NoteObject(notation=note_notation, octave=octave)

    @classmethod
    def parse_chord(cls, chord_notation: str, octave: int = 4) -> List[NoteObject]:
        """
        Parse a chord notation into a list of notes.
        
        Args:
            chord_notation: Chord notation (e.g., "C", "Gm", "Am7", "Fmaj7", "Ddim", "Esus4")
            octave: Base octave for the root note (default: 4)
            
        Returns:
            List of NoteObject instances representing the chord
        """
        # Parse the root note and chord type
        # Extract root note (first 1-2 characters)
        if len(chord_notation) >= 2 and chord_notation[1] in ['#', 'b']:
            root = chord_notation[:2]
            chord_type = chord_notation[2:]
        else:
            root = chord_notation[0]
            chord_type = chord_notation[1:]
        
        # Default to major triad if no chord type specified
        if not chord_type:
            chord_type = 'maj'
        
        # Get the intervals for this chord type
        intervals = cls.chord_intervals.get(chord_type)
        if intervals is None:
            # Unknown chord type, default to major triad
            intervals = cls.chord_intervals['maj']
        
        # Parse the root note
        root_note = cls.parse_notation(root + str(octave))
        root_index = cls.index_of_notation(root_note.notation)
        
        # Build the chord notes
        chord_notes = []
        for interval in intervals:
            note_index = (root_index + interval) % 12
            # Calculate which octave this note should be in
            note_octave = octave + (root_index + interval) // 12
            
            notation = cls.sharp_notations[note_index]
            chord_notes.append(NoteObject(notation=notation, octave=note_octave))
        
        return chord_notes
    
    @classmethod
    def fill_note_spread(cls, notes: List[NoteObject], lower_spread: int = 0, upper_spread: int = 0) -> List[NoteObject]:
        """Fill note spread with upper and lower notes"""
        # If no notes provided, return empty list
        if not notes:
            return []
        
        upper = []
        for c in range(upper_spread):
            note_index = c % len(notes)
            octave_increase = c // len(notes)
            upper.append(NoteObject(
                notation=notes[note_index].notation,
                octave=notes[note_index].octave + octave_increase + 1,
                secondary=True
            ))
        
        lower = []
        for c in range(lower_spread):
            note_index = c % len(notes)
            octave_decrease = c // len(notes)
            reverse_index = len(notes) - 1 - note_index
            lower.append(NoteObject(
                notation=notes[reverse_index].notation,
                octave=notes[reverse_index].octave - octave_decrease - 1,
                secondary=True
            ))
        
        return [*lower, *notes, *upper]
