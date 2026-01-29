"""
MIDI module for Sketchatone

Provides MIDI output backends, input handling, and a bridge to connect Strummer events to MIDI.

Backends:
    - RtMidiBackend: Uses rtmidi for cross-platform MIDI output
    - JackMidiBackend: Uses JACK Audio Connection Kit for Linux/Zynthian
    - RtMidiInput: Uses rtmidi for cross-platform MIDI input (external keyboards)

Usage:
    from sketchatone.midi import MidiStrummerBridge, RtMidiBackend, JackMidiBackend, RtMidiInput

    # Create a MIDI backend
    backend = RtMidiBackend(channel=1)
    backend.connect()

    # Create the bridge
    bridge = MidiStrummerBridge(strummer, backend)

    # Now strummer events will automatically send MIDI notes

    # For MIDI input from external keyboards:
    midi_input = RtMidiInput()
    midi_input.on_note(lambda event: print('Notes:', event['notes']))
    midi_input.connect_all()  # Listen to all ports
"""

from .protocol import MidiBackendProtocol
from .rtmidi_backend import RtMidiBackend
from .jack_backend import JackMidiBackend
from .bridge import MidiStrummerBridge
from .rtmidi_input import RtMidiInput, MidiInputPort, MidiInputNoteEvent

__all__ = [
    'MidiBackendProtocol',
    'RtMidiBackend',
    'JackMidiBackend',
    'MidiStrummerBridge',
    'RtMidiInput',
    'MidiInputPort',
    'MidiInputNoteEvent',
]
