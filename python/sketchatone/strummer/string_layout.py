"""
String Layout

Shared geometry/notes/bounds helper used by Strummer and Slider.
Owns the tablet bounds and the list of notes ("strings"), and exposes
helpers to translate an x position into a string index.
"""

from typing import List, Dict, Any
import time
from dataclasses import asdict

from ..models.note import NoteObject
from ..utils.event_emitter import EventEmitter


class StringLayout(EventEmitter):
    """
    Holds tablet bounds and the note list, and computes string geometry.

    The tablet width is divided evenly into N "strings" based on the number
    of notes. ``index_at(x)`` returns the string index for a given x.

    Events emitted:
        - 'notes_changed': When the notes list is replaced
    """

    def __init__(self):
        super().__init__()
        self._width: float = 1.0
        self._height: float = 1.0
        self._notes: List[NoteObject] = []

    @property
    def notes(self) -> List[NoteObject]:
        return self._notes

    @notes.setter
    def notes(self, notes: List[NoteObject]) -> None:
        self._notes = notes
        self.emit('notes_changed')

    @property
    def width(self) -> float:
        return self._width

    @property
    def height(self) -> float:
        return self._height

    def update_bounds(self, width: float, height: float) -> None:
        """Update the tablet bounds."""
        self._width = width
        self._height = height

    @property
    def string_width(self) -> float:
        """Width of a single string slot, or 0 if there are no notes."""
        if len(self._notes) == 0:
            return 0.0
        return self._width / len(self._notes)

    def index_at(self, x: float) -> int:
        """Return the string index at x, or -1 if there are no notes."""
        if len(self._notes) == 0:
            return -1
        sw = self.string_width
        if sw <= 0:
            return -1
        return min(int(x / sw), len(self._notes) - 1)

    def get_notes_state(self) -> Dict[str, Any]:
        """Return the current notes state as a dictionary for broadcasting."""
        base_notes = [note for note in self._notes if not note.secondary]
        return {
            'type': 'notes',
            'notes': [asdict(note) for note in self._notes],
            'stringCount': len(self._notes),
            'baseNotes': [asdict(note) for note in base_notes],
            'timestamp': time.time(),
        }
