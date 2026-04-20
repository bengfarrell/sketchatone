"""
Unit tests for MIDI backend functionality using mocks
"""

import pytest
import time
from sketchatone.models.note import Note
from tests.mocks import MockMidiBackend


class TestMockMidiBackend:
    """Test MockMidiBackend functionality"""
    
    def setup_method(self):
        """Set up test backend"""
        self.backend = MockMidiBackend()
    
    def teardown_method(self):
        """Clean up"""
        if self.backend.is_connected:
            self.backend.disconnect()


class TestConnection(TestMockMidiBackend):
    """Test connection functionality"""
    
    def test_starts_disconnected(self):
        """Backend should start disconnected"""
        assert self.backend.is_connected is False
        assert self.backend.current_output_name is None
    
    def test_connect_default_port(self):
        """Should connect to default port"""
        self.backend.connect()
        assert self.backend.is_connected is True
        assert self.backend.current_output_name == 'Mock Port 1'
    
    def test_connect_specific_port(self):
        """Should connect to specific port by name"""
        self.backend.connect('Mock Port 2')
        assert self.backend.is_connected is True
        assert self.backend.current_output_name == 'Mock Port 2'

    def test_connect_specific_port_by_index(self):
        """Should connect to specific port by index"""
        self.backend.connect(1)
        assert self.backend.is_connected is True
        assert self.backend.current_output_name == 'Mock Port 2'

    def test_disconnect(self):
        """Should disconnect properly"""
        self.backend.connect()
        self.backend.disconnect()
        assert self.backend.is_connected is False
        assert self.backend.current_output_name is None


class TestMidiMessages(TestMockMidiBackend):
    """Test MIDI message recording"""
    
    def setup_method(self):
        """Set up connected backend"""
        super().setup_method()
        self.backend.connect()
        self.backend.clear_messages()
    
    def test_send_note_on(self):
        """Should record note-on message"""
        note = Note.parse_notation('C4')
        self.backend.send_note_on(note, 100, 0)

        messages = self.backend.get_messages()
        assert len(messages) == 1
        assert messages[0].type == 'note_on'
        assert messages[0].note.to_midi() == 60  # C4 (middle C) = MIDI 60
        assert messages[0].velocity == 100
        assert messages[0].channel == 0

    def test_send_note_off(self):
        """Should record note-off message"""
        note = Note.parse_notation('D4')
        self.backend.send_note_off(note, 0)

        messages = self.backend.get_messages()
        assert len(messages) == 1
        assert messages[0].type == 'note_off'
        assert messages[0].note.to_midi() == 62  # D4 = MIDI 62
        assert messages[0].channel == 0
    
    def test_track_active_notes(self):
        """Should track active notes"""
        c4 = Note.parse_notation('C4')
        e4 = Note.parse_notation('E4')
        
        self.backend.send_note_on(c4, 100, 0)
        self.backend.send_note_on(e4, 100, 0)
        assert len(self.backend.get_active_notes()) == 2
        
        self.backend.send_note_off(c4, 0)
        assert len(self.backend.get_active_notes()) == 1
        
        self.backend.release_all()
        assert len(self.backend.get_active_notes()) == 0
    
    def test_send_pitch_bend(self):
        """Should record pitch bend message"""
        self.backend.send_pitch_bend(0.5)
        
        messages = self.backend.get_messages()
        assert len(messages) == 1
        assert messages[0].type == 'pitch_bend'
        assert messages[0].bend_value == 0.5
    
    def test_use_default_channel(self):
        """Should use default channel"""
        self.backend.set_channel(5)
        note = Note.parse_notation('C4')
        self.backend.send_note_on(note, 100)
        
        messages = self.backend.get_messages()
        assert messages[0].channel == 5
    
    def test_override_default_channel(self):
        """Should override default channel when specified"""
        self.backend.set_channel(5)
        note = Note.parse_notation('C4')
        self.backend.send_note_on(note, 100, channel=2)
        
        messages = self.backend.get_messages()
        assert messages[0].channel == 2


class TestNoteScheduling(TestMockMidiBackend):
    """Test note scheduling functionality"""
    
    def setup_method(self):
        """Set up connected backend"""
        super().setup_method()
        self.backend.connect()
        self.backend.clear_messages()
    
    def test_schedule_note_on_off(self):
        """Should schedule note on and off"""
        note = Note.parse_notation('C4')
        self.backend.send_note(note, 100, duration=0.05)  # 50ms
        
        # Should have note-on immediately
        messages = self.backend.get_messages()
        assert len(messages) == 1
        assert messages[0].type == 'note_on'
        
        # Wait for note-off
        time.sleep(0.1)
        messages = self.backend.get_messages()
        assert len(messages) == 2
        assert messages[1].type == 'note_off'
    
    def test_release_multiple_notes(self):
        """Should release multiple notes"""
        c4 = Note.parse_notation('C4')
        e4 = Note.parse_notation('E4')
        g4 = Note.parse_notation('G4')
        
        self.backend.send_note_on(c4, 100, 0)
        self.backend.send_note_on(e4, 100, 0)
        self.backend.send_note_on(g4, 100, 0)
        
        self.backend.release_notes([c4, e4, g4])
        
        messages = self.backend.get_messages()
        assert len(messages) == 6  # 3 note-on + 3 note-off
        note_offs = [m for m in messages if m.type == 'note_off']
        assert len(note_offs) == 3


class TestMidiBackendConfiguration:
    """Test configuration options for MIDI backends"""

    def test_channel_configuration_on_construction(self):
        """Should respect channel configuration"""
        backend = MockMidiBackend(channel=3)
        backend.connect()

        note = Note.parse_notation('C4')
        backend.send_note_on(note, 100)

        messages = backend.get_messages()
        assert messages[0].channel == 3
        backend.disconnect()

    def test_default_channel_is_zero(self):
        """Should default to channel 0 when no channel specified"""
        backend = MockMidiBackend()
        backend.connect()

        note = Note.parse_notation('C4')
        backend.send_note_on(note, 100)

        messages = backend.get_messages()
        assert messages[0].channel == 0
        backend.disconnect()

    def test_change_channel_dynamically(self):
        """Should allow changing channel with set_channel"""
        backend = MockMidiBackend(channel=0)
        backend.connect()

        note = Note.parse_notation('C4')

        # Send on channel 0
        backend.send_note_on(note, 100)
        assert backend.get_messages()[0].channel == 0

        # Change to channel 7
        backend.set_channel(7)
        backend.clear_messages()
        backend.send_note_on(note, 100)
        assert backend.get_messages()[0].channel == 7

        # Change to channel 15 (max)
        backend.set_channel(15)
        backend.clear_messages()
        backend.send_note_on(note, 100)
        assert backend.get_messages()[0].channel == 15

        backend.disconnect()

    def test_all_16_midi_channels(self):
        """Should support all 16 MIDI channels (0-15)"""
        backend = MockMidiBackend()
        backend.connect()

        note = Note.parse_notation('C4')

        for ch in range(16):
            backend.clear_messages()
            backend.send_note_on(note, 100, ch)
            assert backend.get_messages()[0].channel == ch

        backend.disconnect()

    def test_inter_message_delay_option(self):
        """Should handle inter_message_delay option"""
        backend = MockMidiBackend(channel=0, inter_message_delay=0.002)

        # Mock doesn't actually delay, but verify option is accepted
        assert backend is not None
        backend.disconnect()

    def test_device_monitoring_disabled(self):
        """Should handle device monitoring disabled"""
        backend = MockMidiBackend(channel=0, device_monitoring=False)

        assert backend is not None
        backend.disconnect()

    def test_device_monitoring_custom_interval(self):
        """Should handle device monitoring with custom interval"""
        backend = MockMidiBackend(channel=0, device_monitoring=5000)

        assert backend is not None
        backend.disconnect()

    def test_device_monitoring_zero_disabled(self):
        """Should handle device monitoring set to 0 (disabled)"""
        backend = MockMidiBackend(channel=0, device_monitoring=0)

        assert backend is not None
        backend.disconnect()


class TestChannelRoutingEdgeCases:
    """Test edge cases for channel routing"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Create and cleanup backend"""
        self.backend = MockMidiBackend()
        self.backend.connect()
        yield
        self.backend.disconnect()

    def test_rapid_channel_switching(self):
        """Should send to different channels in rapid succession"""
        note = Note.parse_notation('C4')

        self.backend.send_note_on(note, 100, 0)
        self.backend.send_note_on(note, 100, 1)
        self.backend.send_note_on(note, 100, 2)

        messages = self.backend.get_messages()
        assert messages[0].channel == 0
        assert messages[1].channel == 1
        assert messages[2].channel == 2

    def test_separate_active_notes_per_channel(self):
        """Should maintain separate active notes per channel"""
        note = Note.parse_notation('C4')

        self.backend.send_note_on(note, 100, 0)
        self.backend.send_note_on(note, 100, 1)
        self.backend.send_note_on(note, 100, 2)

        # All three notes should be active
        assert len(self.backend.get_active_notes()) == 3

        # Release on channel 0
        self.backend.send_note_off(note, 0)
        assert len(self.backend.get_active_notes()) == 2

        # Release on channel 1
        self.backend.send_note_off(note, 1)
        assert len(self.backend.get_active_notes()) == 1

    def test_scheduled_notes_on_different_channels(self):
        """Should handle scheduled notes on different channels"""
        note = Note.parse_notation('C4')

        self.backend.send_note(note, 100, 0.05, 0)  # Channel 0
        self.backend.send_note(note, 100, 0.05, 5)  # Channel 5
        self.backend.send_note(note, 100, 0.05, 10) # Channel 10

        messages = self.backend.get_messages()
        assert len([m for m in messages if m.channel == 0 and m.type == 'note_on']) == 1
        assert len([m for m in messages if m.channel == 5 and m.type == 'note_on']) == 1
        assert len([m for m in messages if m.channel == 10 and m.type == 'note_on']) == 1

        # Wait for auto-release
        time.sleep(0.1)

        all_messages = self.backend.get_messages()
        assert len([m for m in all_messages if m.channel == 0 and m.type == 'note_off']) == 1
        assert len([m for m in all_messages if m.channel == 5 and m.type == 'note_off']) == 1
        assert len([m for m in all_messages if m.channel == 10 and m.type == 'note_off']) == 1
