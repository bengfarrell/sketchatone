"""
MIDI module for Sketchatone

Provides MIDI output backends, input handling, and a bridge to connect Strummer events to MIDI.

Backends:
    - RtMidiBackend: Uses rtmidi for cross-platform MIDI output
    - JackMidiBackend: Uses JACK Audio Connection Kit for Linux/Zynthian
    - RtMidiInput: Uses rtmidi for cross-platform MIDI input (external keyboards)
    - JackMidiInput: Uses JACK for MIDI input on Linux/Zynthian

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

    # For JACK MIDI input (on Zynthian/Linux):
    from sketchatone.midi import JackMidiInput
    midi_input = JackMidiInput()
    midi_input.on_note(lambda event: print('Notes:', event['notes']))
    midi_input.connect_all()  # Listen to all JACK MIDI ports
"""

from .protocol import MidiBackendProtocol
from .rtmidi_backend import RtMidiBackend
from .jack_backend import JackMidiBackend
from .bridge import MidiStrummerBridge
from .rtmidi_input import RtMidiInput, MidiInputPort, MidiInputNoteEvent
from .jack_input import JackMidiInput

__all__ = [
    'MidiBackendProtocol',
    'RtMidiBackend',
    'JackMidiBackend',
    'MidiStrummerBridge',
    'RtMidiInput',
    'JackMidiInput',
    'MidiInputPort',
    'MidiInputNoteEvent',
]
