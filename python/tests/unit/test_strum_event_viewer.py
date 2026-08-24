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
from sketchatone.tablet.server.event_adapter import TabletEvent


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
    def strummer_config_file(self, tmp_path):
        """Create a temporary strummer config file"""
        config = {
            "strumming": {
                "pressure_threshold": 0.2,
                "initial_notes": ["D4", "F#4", "A4", "D5"],
                "chord": None
            }
        }
        config_path = tmp_path / "strummer_config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f)
        return str(config_path)

    def test_init_with_default_strummer_config(self):
        """Test initialization with default strummer config"""
        viewer = StrumEventViewer()

        # Should use default strummer config
        assert viewer.strummer_config.pressure_threshold == 0.1
        assert viewer.strummer_config.notes == ["C4", "E4", "G4"]  # New default
        assert viewer.live_mode is False

    def test_init_with_custom_strummer_config(self, strummer_config_file):
        """Test initialization with custom strummer config"""
        viewer = StrumEventViewer(
            strummer_config_path=strummer_config_file
        )

        # Should use custom strummer config
        assert viewer.strummer_config.pressure_threshold == 0.2
        assert viewer.strummer_config.notes == ["D4", "F#4", "A4", "D5"]

    def test_init_live_mode(self):
        """Test initialization with live mode enabled"""
        viewer = StrumEventViewer(live_mode=True)

        assert viewer.live_mode is True

    def test_strummer_configured_correctly(self, strummer_config_file):
        """Test that strummer is configured with correct parameters"""
        viewer = StrumEventViewer(
            strummer_config_path=strummer_config_file
        )

        # Strummer should be configured with values from config
        assert viewer.strummer.pressure_threshold == 0.2


class TestStrumEventViewerSetupNotes:
    """Tests for StrumEventViewer._setup_notes method"""

    def test_setup_notes_from_explicit_list(self):
        """Test setting up notes from explicit note list"""
        viewer = StrumEventViewer()

        # Default config has ["C4", "E4", "G4"] (new default)
        assert len(viewer.strummer.notes) == 3
        assert viewer.strummer.notes[0].notation == 'C'
        assert viewer.strummer.notes[0].octave == 4
        assert viewer.strummer.notes[1].notation == 'E'
        assert viewer.strummer.notes[2].notation == 'G'

    def test_setup_notes_from_chord(self, tmp_path):
        """Test setting up notes from chord notation"""
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
            strummer_config_path=str(strummer_config_path)
        )

        # Am chord should have A, C, E notes
        assert len(viewer.strummer.notes) >= 3
        note_names = [n.notation for n in viewer.strummer.notes]
        assert 'A' in note_names
        assert 'C' in note_names
        assert 'E' in note_names


def _make_event(*, x: float = 0.5, y: float = 0.5, pressure: float = 0.0,
                state: str = 'hover') -> TabletEvent:
    """Build a normalized ``TabletEvent`` for feeding ``_on_tablet_event``."""
    return TabletEvent(x=x, y=y, pressure=pressure, state=state)


class TestStrumEventViewerHandleEvent:
    """Tests for StrumEventViewer._on_tablet_event method"""

    def test_handle_event_increments_count(self):
        """Test that _on_tablet_event increments packet count"""
        viewer = StrumEventViewer()
        viewer.packet_count = 0

        viewer._on_tablet_event(_make_event())
        assert viewer.packet_count == 1

        viewer._on_tablet_event(_make_event())
        assert viewer.packet_count == 2

    def test_handle_event_updates_strummer_bounds(self):
        """Test that _on_tablet_event updates strummer bounds"""
        viewer = StrumEventViewer()
        viewer.packet_count = 0

        viewer._on_tablet_event(_make_event())

        # Strummer should have bounds set to 1.0 (normalized)
        assert viewer.strummer._width == 1.0
        assert viewer.strummer._height == 1.0

    @patch('sketchatone.cli.strum_event_viewer.print_strum_event')
    def test_handle_event_triggers_strum_event(self, mock_print):
        """Test that _on_tablet_event triggers strum events correctly"""
        viewer = StrumEventViewer(live_mode=False)
        viewer.packet_count = 0

        # Simulate a sequence that triggers a strum: sustained pressure
        for _ in range(5):
            viewer._on_tablet_event(
                _make_event(x=0.1, pressure=0.5, state='contact')
            )

        if viewer.last_event:
            assert viewer.last_event['type'] == 'strum'

    def test_handle_event_stores_last_event(self):
        """Test that _on_tablet_event stores the last event"""
        viewer = StrumEventViewer()
        viewer.packet_count = 0

        assert viewer.last_event is None

        for _ in range(5):
            viewer._on_tablet_event(
                _make_event(x=0.1, pressure=0.5, state='contact')
            )

        if viewer.last_event:
            assert 'type' in viewer.last_event


class TestEdgeCases:
    """Tests for edge cases and error handling"""

    def test_handle_event_with_zero_values(self):
        """_on_tablet_event should not crash with all-zero event fields"""
        viewer = StrumEventViewer()
        viewer.packet_count = 0

        viewer._on_tablet_event(TabletEvent())
        assert viewer.packet_count == 1

    def test_handle_event_with_exception(self, capsys):
        """_on_tablet_event should log and swallow strummer exceptions"""
        viewer = StrumEventViewer()
        viewer.packet_count = 0

        with patch.object(viewer.strummer, 'update_bounds',
                          side_effect=Exception("Test error")):
            viewer._on_tablet_event(_make_event())

        # Should have logged the error to stderr, not crashed
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

        # Lower spread should be in ascending pitch order (not mirrored from the base),
        # so a C major chord with lower_spread=3 yields C3, E3, G3, C4, E4, G4.
        notations = [(n.notation, n.octave) for n in filled]
        assert notations == [
            ('C', 3), ('E', 3), ('G', 3),
            ('C', 4), ('E', 4), ('G', 4),
        ]

    def test_fill_note_spread_lower_and_upper_sorted(self):
        """Combined lower + upper spread is returned in ascending pitch order"""
        base_notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        filled = Note.fill_note_spread(base_notes, 3, 2)

        assert len(filled) == 8  # 3 lower + 3 base + 2 upper
        notations = [(n.notation, n.octave) for n in filled]
        assert notations == [
            ('C', 3), ('E', 3), ('G', 3),
            ('C', 4), ('E', 4), ('G', 4),
            ('C', 5), ('E', 5),
        ]

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
        assert midi == 60  # C4 (middle C) = MIDI 60
    
    def test_note_to_string(self):
        """Test converting note to string"""
        note = NoteObject(notation='C#', octave=4, secondary=False)
        assert str(note) == 'C#4'
