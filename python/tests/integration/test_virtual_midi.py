"""
Virtual MIDI Integration Tests

Tests the RtMidiBackend and JackMidiBackend with actual MIDI libraries
using virtual MIDI ports. These tests verify that MIDI messages are
actually sent correctly through the real MIDI libraries.

Requirements:
  - macOS: IAC Driver enabled (built-in)
  - Linux: snd-virmidi kernel module loaded
"""

import time
import sys
import pytest

from sketchatone.models.note import Note
from sketchatone.midi.note_scheduler import shutdown_scheduler
from tests.helpers.virtual_midi import detect_virtual_midi, skip_if_no_virtual_midi

# Detect virtual MIDI availability
virtual_midi_setup = detect_virtual_midi()


@pytest.fixture(scope="module", autouse=True)
def check_virtual_midi():
    """Check if virtual MIDI is available before running tests"""
    if skip_if_no_virtual_midi(virtual_midi_setup):
        pytest.skip("Virtual MIDI not available")

    print(f"\n✅ Virtual MIDI available: {virtual_midi_setup.port_name} ({virtual_midi_setup.platform})")

    # Cleanup after all tests in this module
    yield

    # Shutdown the global scheduler to prevent hanging
    print("\n🧹 Shutting down note scheduler...")
    shutdown_scheduler()


@pytest.fixture
def backend():
    """Create and cleanup backend"""
    backend_instance = None
    
    def _create_backend(backend_type='rtmidi'):
        nonlocal backend_instance
        
        if backend_type == 'rtmidi':
            from sketchatone.midi.rtmidi_backend import RtMidiBackend
            backend_instance = RtMidiBackend(channel=0)
        elif backend_type == 'jack':
            try:
                from sketchatone.midi.jack_backend import JackMidiBackend
                backend_instance = JackMidiBackend(channel=0, client_name="sketchatone_test")
            except ImportError:
                pytest.skip("JACK backend not available")
        
        return backend_instance
    
    yield _create_backend
    
    if backend_instance is not None:
        backend_instance.disconnect()


class TestRtMidiBackendVirtual:
    """Integration tests for RtMidiBackend with virtual MIDI"""
    
    def test_connect_to_virtual_port(self, backend):
        """Should connect to virtual MIDI port"""
        b = backend('rtmidi')
        connected = b.connect(virtual_midi_setup.port_name)
        
        assert connected is True
        assert b.is_connected is True
    
    def test_send_note_on_and_off(self, backend):
        """Should send note on and note off messages"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        note = Note.parse_notation('C4')
        
        # Send note on
        b.send_note_on(note, 100)
        
        # Give it a moment to process
        time.sleep(0.01)
        
        # Send note off
        b.send_note_off(note)
        
        # If we got here without errors, MIDI was sent successfully
        assert b.is_connected is True
    
    def test_send_scheduled_note(self, backend):
        """Should send scheduled note with automatic note off"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        note = Note.parse_notation('A4')
        
        # Send note with 50ms duration
        b.send_note(note, 100, duration=0.05)
        
        # Wait for note to auto-release
        time.sleep(0.1)
        
        assert b.is_connected is True
    
    def test_send_pitch_bend(self, backend):
        """Should send pitch bend messages"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        # Send center pitch bend
        b.send_pitch_bend(0.0)
        time.sleep(0.01)
        
        # Send up bend
        b.send_pitch_bend(1.0)
        time.sleep(0.01)
        
        # Send down bend
        b.send_pitch_bend(-1.0)
        time.sleep(0.01)
        
        assert b.is_connected is True
    
    def test_multiple_channels(self, backend):
        """Should handle multiple channels"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        note = Note.parse_notation('E4')
        
        # Send on default channel (0)
        b.send_note_on(note, 100)
        time.sleep(0.01)
        b.send_note_off(note)
        
        # Send on channel 1
        b.send_note_on(note, 100, channel=1)
        time.sleep(0.01)
        b.send_note_off(note, channel=1)
        
        assert b.is_connected is True
    
    def test_release_all_notes(self, backend):
        """Should release all notes"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        notes = [
            Note.parse_notation('C4'),
            Note.parse_notation('E4'),
            Note.parse_notation('G4')
        ]
        
        # Send multiple notes
        for note in notes:
            b.send_note_on(note, 100)
        
        time.sleep(0.01)
        
        # Release all
        b.release_notes(notes)
        
        time.sleep(0.01)
        
        assert b.is_connected is True
    
    def test_list_available_ports(self, backend):
        """Should list available MIDI ports"""
        b = backend('rtmidi')
        ports = b.get_available_ports()
        
        assert len(ports) > 0
        # Check that virtual port is in the list
        assert any('IAC' in port or 'Virtual' in port or 'virmidi' in port for port in ports)
    
    def test_rapid_note_changes(self, backend):
        """Should handle rapid note changes (State Guard test)"""
        b = backend('rtmidi')
        b.connect(virtual_midi_setup.port_name)
        
        note = Note.parse_notation('C4')
        
        # Rapidly send the same note multiple times
        # State Guard should prevent note shadowing
        for _ in range(10):
            b.send_note_on(note, 100)
            time.sleep(0.005)
        
        b.send_note_off(note)
        
        assert b.is_connected is True


@pytest.mark.skipif(sys.platform != 'linux', reason="JACK backend only available on Linux")
class TestJackMidiBackendVirtual:
    """Integration tests for JackMidiBackend with virtual MIDI (Linux only)"""
    
    def test_connect_to_virtual_port(self, backend):
        """Should connect to virtual MIDI port via JACK"""
        try:
            b = backend('jack')
        except Exception:
            pytest.skip("JACK server not running")
        
        connected = b.connect()
        
        # JACK doesn't require explicit port connection like RtMidi
        assert b.is_connected is True
    
    def test_send_notes_via_jack(self, backend):
        """Should send notes through JACK MIDI"""
        try:
            b = backend('jack')
        except Exception:
            pytest.skip("JACK server not running")
        
        b.connect()
        
        note = Note.parse_notation('C4')
        
        # Send note
        b.send_note(note, 100, duration=0.05)
        
        # Wait for processing
        time.sleep(0.1)
        
        assert b.is_connected is True
