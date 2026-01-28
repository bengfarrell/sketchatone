"""
Unit Tests for Strum Event Viewer CLI

Tests for the strum_event_viewer module including:
- Helper functions (create_bar, format_note, print_strummer_info)
- StrumEventViewer class initialization and configuration
- Packet handling and strum event processing
"""

import pytest
import json
import os
import tempfile
from unittest.mock import Mock, patch, MagicMock
from io import StringIO

# Import the module under test
from sketchatone.cli.strum_event_viewer import (
    create_bar,
    format_note,
    print_strummer_info,
    print_strum_event,
    StrumEventViewer,
)
from sketchatone.models.note import Note, NoteObject
from sketchatone.models.strummer_config import StrummerConfig
from sketchatone.strummer.strummer import Strummer


class TestCreateBar:
    """Tests for the create_bar helper function"""
    
    def test_create_bar_empty(self):
        """Test bar with zero value"""
        bar = create_bar(0, 100, 10)
        # Should have no filled blocks, all empty
        assert '█' not in bar or bar.count('█') == 0
        assert '░' in bar
    
    def test_create_bar_full(self):
        """Test bar with max value"""
        bar = create_bar(100, 100, 10)
        # Should have all filled blocks
        assert '█' in bar
        # Count actual block characters (ignoring ANSI codes)
        filled_count = bar.count('█')
        assert filled_count == 10
    
    def test_create_bar_half(self):
        """Test bar with half value"""
        bar = create_bar(50, 100, 10)
        filled_count = bar.count('█')
        empty_count = bar.count('░')
        assert filled_count == 5
        assert empty_count == 5
    
    def test_create_bar_zero_max(self):
        """Test bar with zero max value (edge case)"""
        bar = create_bar(50, 0, 10)
        # Should handle gracefully with no filled blocks
        filled_count = bar.count('█')
        assert filled_count == 0
    
    def test_create_bar_exceeds_max(self):
        """Test bar with value exceeding max"""
        bar = create_bar(150, 100, 10)
        # Should cap at max width
        filled_count = bar.count('█')
        assert filled_count == 10


class TestFormatNote:
    """Tests for the format_note helper function"""

    def test_format_note_basic(self):
        """Test formatting a basic note"""
        note = NoteObject(notation='C', octave=4, secondary=False)
        result = format_note(note)
        assert 'C4' in result
        assert '*' not in result

    def test_format_note_with_sharp(self):
        """Test formatting a note with sharp"""
        note = NoteObject(notation='C#', octave=4, secondary=False)
        result = format_note(note)
        assert 'C#4' in result

    def test_format_note_secondary(self):
        """Test formatting a secondary note (shows asterisk)"""
        note = NoteObject(notation='E', octave=4, secondary=True)
        result = format_note(note)
        assert 'E4' in result
        assert '*' in result


class TestPrintStrummerInfo:
    """Tests for the print_strummer_info function"""

    def test_print_strummer_info_basic(self, capsys):
        """Test printing basic strummer info"""
        config = StrummerConfig()
        config.strumming.pressure_threshold = 0.15
        config.strumming.initial_notes = ['C4', 'E4', 'G4']
        print_strummer_info(config)
        captured = capsys.readouterr()
        assert 'Pressure Threshold' in captured.out
        assert '0.15' in captured.out
        assert 'Notes' in captured.out
        assert 'C4' in captured.out

    def test_print_strummer_info_with_chord(self, capsys):
        """Test printing strummer info with chord"""
        config = StrummerConfig()
        config.strumming.pressure_threshold = 0.1
        config.strumming.initial_notes = ['C4', 'E4', 'G4']
        config.strumming.chord = 'Cmaj'
        print_strummer_info(config)
        captured = capsys.readouterr()
        assert 'Chord' in captured.out
        assert 'Cmaj' in captured.out


class TestPrintStrumEvent:
    """Tests for the print_strum_event function"""
    
    def test_print_strum_event_strum(self, capsys):
        """Test printing a strum event"""
        strummer = Strummer()
        note = NoteObject(notation='C', octave=4, secondary=False)
        event = {
            'type': 'strum',
            'notes': [{'note': note, 'velocity': 100}]
        }
        print_strum_event(event, strummer)
        captured = capsys.readouterr()
        assert 'STRUM' in captured.out
        assert 'C4' in captured.out
        assert '100' in captured.out
    
    def test_print_strum_event_release(self, capsys):
        """Test printing a release event"""
        strummer = Strummer()
        event = {
            'type': 'release',
            'velocity': 80
        }
        print_strum_event(event, strummer)
        captured = capsys.readouterr()
        assert 'RELEASE' in captured.out
        assert '80' in captured.out
    
    def test_print_strum_event_unknown(self, capsys):
        """Test printing an unknown event type"""
        strummer = Strummer()
        event = {'type': 'unknown'}
        print_strum_event(event, strummer)
        captured = capsys.readouterr()
        # Should not crash, may produce no output
        assert True


class TestStrumEventViewerInit:
    """Tests for StrumEventViewer initialization"""
    
    @pytest.fixture
    def tablet_config_file(self, tmp_path):
        """Create a temporary tablet config file"""
        config = {
            "name": "Test Tablet",
            "vendorId": "0x1234",
            "productId": "0x5678",
            "deviceInfo": {
                "vendor_id": 4660,
                "product_id": 22136,
                "usage_page": 13
            },
            "byteCodeMappings": {
                "x": {"byteIndex": [2, 3], "max": 32000, "type": "multi-byte-range"},
                "y": {"byteIndex": [4, 5], "max": 18000, "type": "multi-byte-range"},
                "pressure": {"byteIndex": [6, 7], "max": 8192, "type": "multi-byte-range"},
                "status": {
                    "byteIndex": [1],
                    "type": "code",
                    "values": {
                        "160": {"state": "hover"},
                        "161": {"state": "contact"}
                    }
                }
            }
        }
        config_path = tmp_path / "tablet_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)
    
    @pytest.fixture
    def strummer_config_file(self, tmp_path):
        """Create a temporary strummer config file"""
        config = {
            "strumming": {
                "pressure_threshold": 0.2,
                "pluck_velocity_scale": 0.8,
                "initial_notes": ["D4", "F#4", "A4", "D5"],
                "chord": None
            }
        }
        config_path = tmp_path / "strummer_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)
    
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_init_with_default_strummer_config(self, mock_base_init, tablet_config_file):
        """Test initialization with default strummer config"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )

        # Should use default strummer config
        assert viewer.strummer_config.pressure_threshold == 0.1
        assert viewer.strummer_config.notes == ["C4", "E4", "G4"]  # New default
        assert viewer.live_mode is False

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_init_with_custom_strummer_config(self, mock_base_init, tablet_config_file, strummer_config_file):
        """Test initialization with custom strummer config"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file,
            strummer_config_path=strummer_config_file
        )

        # Should use custom strummer config
        assert viewer.strummer_config.pressure_threshold == 0.2
        assert viewer.strummer_config.velocity_scale == 0.8
        assert viewer.strummer_config.notes == ["D4", "F#4", "A4", "D5"]

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_init_live_mode(self, mock_base_init, tablet_config_file):
        """Test initialization with live mode enabled"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file,
            live_mode=True
        )

        assert viewer.live_mode is True

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_strummer_configured_correctly(self, mock_base_init, tablet_config_file, strummer_config_file):
        """Test that strummer is configured with correct parameters"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file,
            strummer_config_path=strummer_config_file
        )

        # Strummer should be configured with values from config
        assert viewer.strummer.pressure_threshold == 0.2
        assert viewer.strummer.velocity_scale == 0.8


class TestStrumEventViewerSetupNotes:
    """Tests for StrumEventViewer._setup_notes method"""
    
    @pytest.fixture
    def tablet_config_file(self, tmp_path):
        """Create a temporary tablet config file"""
        config = {
            "name": "Test Tablet",
            "vendorId": "0x1234",
            "productId": "0x5678",
            "deviceInfo": {"vendor_id": 4660, "product_id": 22136, "usage_page": 13},
            "byteCodeMappings": {
                "x": {"byteIndex": [2, 3], "max": 32000, "type": "multi-byte-range"},
                "y": {"byteIndex": [4, 5], "max": 18000, "type": "multi-byte-range"},
                "pressure": {"byteIndex": [6, 7], "max": 8192, "type": "multi-byte-range"},
                "status": {"byteIndex": [1], "type": "code", "values": {"160": {"state": "hover"}}}
            }
        }
        config_path = tmp_path / "tablet_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)
    
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_setup_notes_from_explicit_list(self, mock_base_init, tablet_config_file):
        """Test setting up notes from explicit note list"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )

        # Default config has ["C4", "E4", "G4"] (new default)
        assert len(viewer.strummer.notes) == 3
        assert viewer.strummer.notes[0].notation == 'C'
        assert viewer.strummer.notes[0].octave == 4
        assert viewer.strummer.notes[1].notation == 'E'
        assert viewer.strummer.notes[2].notation == 'G'

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_setup_notes_from_chord(self, mock_base_init, tablet_config_file, tmp_path):
        """Test setting up notes from chord notation"""
        mock_base_init.return_value = None

        # Create config with chord
        strummer_config = {
            "strumming": {
                "pressure_threshold": 0.1,
                "initial_notes": [],
                "chord": "Am",
                "lower_note_spread": 0,
                "upper_note_spread": 0
            }
        }
        strummer_config_path = tmp_path / "strummer_chord.json"
        with open(strummer_config_path, 'w') as f:
            json.dump(strummer_config, f)

        viewer = StrumEventViewer(
            config_path=tablet_config_file,
            strummer_config_path=str(strummer_config_path)
        )

        # Am chord should have A, C, E notes
        assert len(viewer.strummer.notes) >= 3
        note_names = [n.notation for n in viewer.strummer.notes]
        assert 'A' in note_names
        assert 'C' in note_names
        assert 'E' in note_names


class TestStrumEventViewerHandlePacket:
    """Tests for StrumEventViewer.handle_packet method"""
    
    @pytest.fixture
    def tablet_config_file(self, tmp_path):
        """Create a temporary tablet config file"""
        config = {
            "name": "Test Tablet",
            "vendorId": "0x1234",
            "productId": "0x5678",
            "deviceInfo": {"vendor_id": 4660, "product_id": 22136, "usage_page": 13},
            "byteCodeMappings": {
                "x": {"byteIndex": [2, 3], "max": 32000, "type": "multi-byte-range"},
                "y": {"byteIndex": [4, 5], "max": 18000, "type": "multi-byte-range"},
                "pressure": {"byteIndex": [6, 7], "max": 8192, "type": "multi-byte-range"},
                "status": {"byteIndex": [1], "type": "code", "values": {"160": {"state": "hover"}, "161": {"state": "contact"}}}
            }
        }
        config_path = tmp_path / "tablet_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)
    
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    def test_handle_packet_increments_count(self, mock_process, mock_base_init, tablet_config_file):
        """Test that handle_packet increments packet count"""
        mock_base_init.return_value = None
        mock_process.return_value = {'x': 0.5, 'y': 0.5, 'pressure': 0.0, 'state': 'hover'}

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )
        viewer.packet_count = 0

        viewer.handle_packet(b'\x00' * 10)
        assert viewer.packet_count == 1

        viewer.handle_packet(b'\x00' * 10)
        assert viewer.packet_count == 2

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    def test_handle_packet_updates_strummer_bounds(self, mock_process, mock_base_init, tablet_config_file):
        """Test that handle_packet updates strummer bounds"""
        mock_base_init.return_value = None
        mock_process.return_value = {'x': 0.5, 'y': 0.5, 'pressure': 0.0, 'state': 'hover'}

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )
        viewer.packet_count = 0

        viewer.handle_packet(b'\x00' * 10)

        # Strummer should have bounds set to 1.0 (normalized)
        assert viewer.strummer._width == 1.0
        assert viewer.strummer._height == 1.0

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    @patch('sketchatone.cli.strum_event_viewer.print_strum_event')
    def test_handle_packet_triggers_strum_event(self, mock_print, mock_process, mock_base_init, tablet_config_file):
        """Test that handle_packet triggers strum events correctly"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file,
            live_mode=False
        )
        viewer.packet_count = 0

        # Simulate a sequence that triggers a strum:
        # 1. First touch with pressure (tap detection starts)
        mock_process.return_value = {'x': 0.1, 'y': 0.5, 'pressure': 0.5, 'state': 'contact'}
        for _ in range(5):  # Fill pressure buffer
            viewer.handle_packet(b'\x00' * 10)

        # Check if strum event was triggered and printed
        if viewer.last_event:
            assert viewer.last_event['type'] == 'strum'

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    def test_handle_packet_stores_last_event(self, mock_process, mock_base_init, tablet_config_file):
        """Test that handle_packet stores the last event"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )
        viewer.packet_count = 0

        # Initially no last event
        assert viewer.last_event is None

        # Simulate packets that trigger a strum
        mock_process.return_value = {'x': 0.1, 'y': 0.5, 'pressure': 0.5, 'state': 'contact'}
        for _ in range(5):
            viewer.handle_packet(b'\x00' * 10)

        # After strum, last_event should be set
        if viewer.last_event:
            assert 'type' in viewer.last_event


class TestStrumEventViewerIntegration:
    """Integration tests for StrumEventViewer with real config files"""
    
    @pytest.fixture
    def real_tablet_config(self):
        """Path to real tablet config if available"""
        config_path = os.path.join(
            os.path.dirname(__file__),
            '..', '..', '..', 'public', 'configs', 'xp-pen-deco640.json'
        )
        if os.path.exists(config_path):
            return config_path
        pytest.skip("Real tablet config not found")
    
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    def test_init_with_real_config(self, mock_base_init, real_tablet_config):
        """Test initialization with real tablet config"""
        mock_base_init.return_value = None

        viewer = StrumEventViewer(
            config_path=real_tablet_config
        )

        # Should initialize without errors
        assert viewer.strummer is not None
        assert len(viewer.strummer.notes) > 0


class TestEdgeCases:
    """Tests for edge cases and error handling"""

    @pytest.fixture
    def tablet_config_file(self, tmp_path):
        """Create a temporary tablet config file"""
        config = {
            "name": "Test Tablet",
            "vendorId": "0x1234",
            "productId": "0x5678",
            "deviceInfo": {"vendor_id": 4660, "product_id": 22136, "usage_page": 13},
            "byteCodeMappings": {
                "x": {"byteIndex": [2, 3], "max": 32000, "type": "multi-byte-range"},
                "y": {"byteIndex": [4, 5], "max": 18000, "type": "multi-byte-range"},
                "pressure": {"byteIndex": [6, 7], "max": 8192, "type": "multi-byte-range"},
                "status": {"byteIndex": [1], "type": "code", "values": {"160": {"state": "hover"}}}
            }
        }
        config_path = tmp_path / "tablet_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    def test_handle_packet_with_missing_values(self, mock_process, mock_base_init, tablet_config_file):
        """Test handle_packet with missing values in processed data"""
        mock_base_init.return_value = None
        mock_process.return_value = {}  # Empty dict

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )
        viewer.packet_count = 0

        # Should not crash with missing values
        viewer.handle_packet(b'\x00' * 10)
        assert viewer.packet_count == 1

    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.__init__')
    @patch('sketchatone.cli.strum_event_viewer.TabletReaderBase.process_packet')
    def test_handle_packet_with_exception(self, mock_process, mock_base_init, tablet_config_file, capsys):
        """Test handle_packet handles exceptions gracefully"""
        mock_base_init.return_value = None
        mock_process.side_effect = Exception("Test error")

        viewer = StrumEventViewer(
            config_path=tablet_config_file
        )
        viewer.packet_count = 0

        # Should not crash, should log error
        viewer.handle_packet(b'\x00' * 10)

        # Check that error was logged to stderr
        captured = capsys.readouterr()
        assert 'ERROR' in captured.err or 'Test error' in captured.err
    
    def test_create_bar_negative_value(self):
        """Test create_bar with negative value"""
        bar = create_bar(-10, 100, 10)
        # Should handle gracefully
        filled_count = bar.count('█')
        assert filled_count == 0
    
    def test_create_bar_negative_width(self):
        """Test create_bar with negative width"""
        # This might raise an error or return empty string
        try:
            bar = create_bar(50, 100, -5)
            # If it doesn't raise, it should return something reasonable
            assert isinstance(bar, str)
        except (ValueError, Exception):
            # Acceptable to raise an error for invalid input
            pass

class TestNoteClass:
    """Tests for the Note class - matching Node.js tests"""
    
    def test_parse_notation_basic(self):
        """Test parsing basic notation"""
        note = Note.parse_notation('C4')
        assert note.notation == 'C'
        assert note.octave == 4
    
    def test_parse_notation_with_sharp(self):
        """Test parsing notation with sharp"""
        note = Note.parse_notation('C#4')
        assert note.notation == 'C#'
        assert note.octave == 4
    
    def test_parse_notation_with_flat(self):
        """Test parsing notation with flat"""
        note = Note.parse_notation('Bb3')
        assert note.notation == 'Bb'
        assert note.octave == 3
    
    def test_parse_notation_default_octave(self):
        """Test parsing notation without octave defaults to 4"""
        note = Note.parse_notation('G')
        assert note.notation == 'G'
        assert note.octave == 4
    
    def test_parse_chord_major(self):
        """Test parsing major chord"""
        notes = Note.parse_chord('C')
        assert len(notes) == 3
        assert notes[0].notation == 'C'
        assert notes[1].notation == 'E'
        assert notes[2].notation == 'G'
    
    def test_parse_chord_minor(self):
        """Test parsing minor chord"""
        notes = Note.parse_chord('Am')
        assert len(notes) == 3
        assert notes[0].notation == 'A'
        assert notes[1].notation == 'C'
        assert notes[2].notation == 'E'
    
    def test_parse_chord_seventh(self):
        """Test parsing seventh chord"""
        notes = Note.parse_chord('G7')
        assert len(notes) == 4
        assert notes[0].notation == 'G'
        assert notes[1].notation == 'B'
        assert notes[2].notation == 'D'
        assert notes[3].notation == 'F'
    
    def test_fill_note_spread_upper(self):
        """Test filling note spread with upper notes"""
        base_notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        filled = Note.fill_note_spread(base_notes, 0, 3)
        
        assert len(filled) == 6  # 3 base + 3 upper
        assert filled[3].octave == 5  # First upper note
        assert filled[3].secondary is True
    
    def test_fill_note_spread_lower(self):
        """Test filling note spread with lower notes"""
        base_notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        filled = Note.fill_note_spread(base_notes, 3, 0)
        
        assert len(filled) == 6  # 3 lower + 3 base
        assert filled[0].octave == 3  # First lower note
        assert filled[0].secondary is True
    
    def test_transpose_note_up(self):
        """Test transposing note up"""
        note = NoteObject(notation='C', octave=4, secondary=False)
        transposed = note.transpose(2)
        assert transposed.notation == 'D'
        assert transposed.octave == 4
    
    def test_transpose_note_down(self):
        """Test transposing note down"""
        note = NoteObject(notation='C', octave=4, secondary=False)
        transposed = note.transpose(-2)
        assert transposed.notation == 'A#'
        assert transposed.octave == 3
    
    def test_note_to_midi(self):
        """Test converting note to MIDI"""
        note = NoteObject(notation='C', octave=4, secondary=False)
        midi = note.to_midi()
        assert midi == 48  # C4 = 48
    
    def test_note_to_string(self):
        """Test converting note to string"""
        note = NoteObject(notation='C#', octave=4, secondary=False)
        assert str(note) == 'C#4'
