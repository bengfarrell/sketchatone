"""
Sketchatone - Python Package

This package provides:
- Core functionality
- CLI utilities
- Models
- Strummer for detecting strum events from tablet input
- MIDI output backends (rtmidi, JACK)
- Mock data generators for testing

Example:
    from sketchatone import Strummer, StrummerConfig, Note, NoteObject
    from sketchatone.midi import MidiStrummerBridge, RtMidiBackend
"""

# Get version from package metadata (reads from pyproject.toml)
try:
    from importlib.metadata import version
    __version__ = version("sketchatone")
except Exception:
    # Fallback for development/editable installs where metadata might not be available
    __version__ = "0.0.0-dev"

# Export main classes and functions
from .strummer.strummer import Strummer
from .models.strummer_config import StrummerConfig
from .models.note import Note, NoteObject
from .utils.event_emitter import EventEmitter

__all__ = [
    '__version__',
    'Strummer',
    'StrummerConfig',
    'Note',
    'NoteObject',
    'EventEmitter',
]