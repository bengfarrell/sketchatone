"""
MIDI module for Sketchatone

Provides MIDI output backends and a bridge to connect Strummer events to MIDI.

Backends:
    - RtMidiBackend: Uses rtmidi for cross-platform MIDI output
    - JackMidiBackend: Uses JACK Audio Connection Kit for Linux/Zynthian

Usage:
    from sketchatone.midi import MidiStrummerBridge, RtMidiBackend, JackMidiBackend
    
    # Create a MIDI backend
    backend = RtMidiBackend(channel=1)
    backend.connect()
    
    # Create the bridge
    bridge = MidiStrummerBridge(strummer, backend)
    
    # Now strummer events will automatically send MIDI notes
"""

from .protocol import MidiBackendProtocol
from .rtmidi_backend import RtMidiBackend
from .jack_backend import JackMidiBackend
from .bridge import MidiStrummerBridge

__all__ = [
    'MidiBackendProtocol',
    'RtMidiBackend', 
    'JackMidiBackend',
    'MidiStrummerBridge',
]
