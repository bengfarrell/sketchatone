"""
Tests for the Actions class.
Focuses on verifying that note spread configuration is properly applied
when setting chords via tablet buttons.
"""

import pytest
from unittest.mock import Mock, MagicMock
from dataclasses import dataclass

from sketchatone.strummer.actions import Actions, ChordProgressionState
from sketchatone.strummer.strummer import Strummer
from sketchatone.models.note import Note, NoteObject
from sketchatone.models.midi_strummer_config import MidiStrummerConfig


class TestChordProgressionState:
    """Tests for ChordProgressionState class."""
    
    def test_initial_state(self):
        """Test initial state is empty."""
        state = ChordProgressionState()
        assert state.progression_name is None
        assert state.chords == []
        assert state.current_index == 0
    
    def test_load_progression(self):
        """Test loading a valid progression."""
        state = ChordProgressionState()
        result = state.load_progression('c-major-pop')
        assert result is True
        assert state.progression_name == 'c-major-pop'
        assert len(state.chords) > 0
        assert state.current_index == 0
    
    def test_load_invalid_progression(self):
        """Test loading an invalid progression returns False."""
        state = ChordProgressionState()
        result = state.load_progression('nonexistent-progression')
        assert result is False
    
    def test_set_index_wraps(self):
        """Test that set_index wraps around."""
        state = ChordProgressionState()
        state.load_progression('c-major-pop')
        num_chords = len(state.chords)
        
        # Set to index beyond length
        actual = state.set_index(num_chords + 2)
        assert actual == 2
    
    def test_increment_index(self):
        """Test incrementing index."""
        state = ChordProgressionState()
        state.load_progression('c-major-pop')
        
        state.increment_index(1)
        assert state.current_index == 1
        
        state.increment_index(2)
        assert state.current_index == 3
    
    def test_increment_index_negative(self):
        """Test decrementing index wraps around."""
        state = ChordProgressionState()
        state.load_progression('c-major-pop')
        num_chords = len(state.chords)
        
        # Decrement from 0 should wrap to end
        state.increment_index(-1)
        assert state.current_index == num_chords - 1
    
    def test_get_current_chord(self):
        """Test getting current chord."""
        state = ChordProgressionState()
        state.load_progression('c-major-pop')
        
        chord = state.get_current_chord()
        assert chord is not None
        assert isinstance(chord, str)


class TestActionsWithDictConfig:
    """Tests for Actions class with dictionary config.

    Note: Dictionary configs don't support attribute access via getattr(),
    so spread values in dictionaries are NOT applied. This demonstrates
    why we need to use the actual config object (MidiStrummerConfig) instead.
    """

    def test_set_strum_chord_no_spread(self):
        """Test setting chord with no spread configured."""
        strummer = Strummer()
        config = {
            'lower_spread': 0,
            'upper_spread': 0,
        }
        actions = Actions(config=config, strummer=strummer)

        actions.set_strum_chord(['Am'], {'button': 'Test'})

        # Am chord should have 3 notes: A, C, E
        assert len(strummer.notes) == 3

    def test_set_strum_chord_dict_spread_not_applied(self):
        """Test that dictionary spread values are NOT applied.

        This demonstrates the limitation of using dictionaries - getattr()
        returns the default value (0) because dicts don't support attribute access.
        This is why we need to use MidiStrummerConfig objects instead.
        """
        strummer = Strummer()
        config = {
            'lower_spread': 2,
            'upper_spread': 3,
        }
        actions = Actions(config=config, strummer=strummer)

        actions.set_strum_chord(['Am'], {'button': 'Test'})

        # Dictionary values are NOT accessible via getattr, so spread is not applied
        # This demonstrates the bug that was fixed by using MidiStrummerConfig
        assert len(strummer.notes) == 3  # Only base chord notes

    def test_set_strum_notes_dict_spread_not_applied(self):
        """Test that dictionary spread values are NOT applied for set_strum_notes."""
        strummer = Strummer()
        config = {
            'lower_spread': 1,
            'upper_spread': 1,
        }
        actions = Actions(config=config, strummer=strummer)

        actions.set_strum_notes([['C4', 'E4', 'G4']], {'button': 'Test'})

        # Dictionary values are NOT accessible via getattr, so spread is not applied
        assert len(strummer.notes) == 3  # Only base notes


class TestActionsWithMidiStrummerConfig:
    """Tests for Actions class with MidiStrummerConfig object.
    
    This tests the fix for the bug where spread values weren't being
    applied when using the actual config object.
    """
    
    def test_set_strum_chord_uses_config_spread(self):
        """Test that set_strum_chord uses spread from MidiStrummerConfig."""
        strummer = Strummer()
        config = MidiStrummerConfig()
        
        # Set spread values on the config
        config.strummer.strumming.lower_note_spread = 2
        config.strummer.strumming.upper_note_spread = 3
        
        actions = Actions(config=config, strummer=strummer)
        
        actions.set_strum_chord(['C'], {'button': 'Tablet1'})
        
        # C major chord (3 notes) + 2 lower + 3 upper = 8 notes
        assert len(strummer.notes) == 8
    
    def test_set_strum_chord_reflects_config_changes(self):
        """Test that changing config spread values affects subsequent chord sets.
        
        This is the key test for the bug fix - verifying that when the config
        is updated, the Actions class sees the new values.
        """
        strummer = Strummer()
        config = MidiStrummerConfig()
        
        # Start with no spread
        config.strummer.strumming.lower_note_spread = 0
        config.strummer.strumming.upper_note_spread = 0
        
        actions = Actions(config=config, strummer=strummer)
        
        # Set chord with no spread
        actions.set_strum_chord(['Am'], {'button': 'Tablet1'})
        assert len(strummer.notes) == 3  # Just the 3 chord notes
        
        # Now update the config (simulating UI change)
        config.strummer.strumming.lower_note_spread = 2
        config.strummer.strumming.upper_note_spread = 2
        
        # Set chord again - should now have spread applied
        actions.set_strum_chord(['Am'], {'button': 'Tablet1'})
        assert len(strummer.notes) == 7  # 3 + 2 + 2 = 7 notes
    
    def test_set_strum_notes_reflects_config_changes(self):
        """Test that set_strum_notes also reflects config changes."""
        strummer = Strummer()
        config = MidiStrummerConfig()
        
        # Start with no spread
        config.strummer.strumming.lower_note_spread = 0
        config.strummer.strumming.upper_note_spread = 0
        
        actions = Actions(config=config, strummer=strummer)
        
        # Set notes with no spread
        actions.set_strum_notes([['C4', 'E4', 'G4']], {'button': 'Tablet1'})
        assert len(strummer.notes) == 3
        
        # Update config
        config.strummer.strumming.lower_note_spread = 3
        config.strummer.strumming.upper_note_spread = 3
        
        # Set notes again
        actions.set_strum_notes([['C4', 'E4', 'G4']], {'button': 'Tablet1'})
        assert len(strummer.notes) == 9  # 3 + 3 + 3 = 9 notes
    
    def test_config_properties_accessible(self):
        """Test that MidiStrummerConfig properties are accessible via getattr."""
        config = MidiStrummerConfig()
        config.strummer.strumming.lower_note_spread = 5
        config.strummer.strumming.upper_note_spread = 7
        
        # These are the exact calls the Actions class makes
        lower = getattr(config, 'lower_spread', 0)
        upper = getattr(config, 'upper_spread', 0)
        
        assert lower == 5
        assert upper == 7
    
    def test_note_repeater_accessible(self):
        """Test that note_repeater is accessible from MidiStrummerConfig."""
        config = MidiStrummerConfig()
        config.strummer.note_repeater.active = True
        
        # This is how Actions accesses it
        note_repeater = getattr(config, 'note_repeater', None)
        
        assert note_repeater is not None
        assert note_repeater.active is True
    
    def test_transpose_accessible(self):
        """Test that transpose is accessible from MidiStrummerConfig."""
        config = MidiStrummerConfig()
        config.strummer.transpose.active = True
        config.strummer.transpose.semitones = 7
        
        # This is how Actions accesses it
        transpose = getattr(config, 'transpose', None)
        
        assert transpose is not None
        assert transpose.active is True
        assert transpose.semitones == 7


class TestActionsExecute:
    """Tests for the execute() method."""
    
    def test_execute_string_action(self):
        """Test executing action as string."""
        config = MidiStrummerConfig()
        actions = Actions(config=config)
        
        # toggle-repeater should work
        result = actions.execute('toggle-repeater', {'button': 'Test'})
        assert result is True
    
    def test_execute_array_action(self):
        """Test executing action as array with params."""
        strummer = Strummer()
        config = MidiStrummerConfig()
        actions = Actions(config=config, strummer=strummer)
        
        result = actions.execute(['set-strum-chord', 'Am'], {'button': 'Test'})
        assert result is True
        assert len(strummer.notes) > 0
    
    def test_execute_unknown_action(self):
        """Test executing unknown action returns False."""
        config = MidiStrummerConfig()
        actions = Actions(config=config)
        
        result = actions.execute('unknown-action', {'button': 'Test'})
        assert result is False
    
    def test_execute_none_action(self):
        """Test executing None action returns False."""
        config = MidiStrummerConfig()
        actions = Actions(config=config)
        
        result = actions.execute(None, {'button': 'Test'})
        assert result is False


class TestActionsToggleRepeater:
    """Tests for toggle-repeater action."""
    
    def test_toggle_repeater_on(self):
        """Test toggling repeater on."""
        config = MidiStrummerConfig()
        config.strummer.note_repeater.active = False
        
        actions = Actions(config=config)
        actions.execute('toggle-repeater', {'button': 'Test'})
        
        assert config.strummer.note_repeater.active is True
    
    def test_toggle_repeater_off(self):
        """Test toggling repeater off."""
        config = MidiStrummerConfig()
        config.strummer.note_repeater.active = True
        
        actions = Actions(config=config)
        actions.execute('toggle-repeater', {'button': 'Test'})
        
        assert config.strummer.note_repeater.active is False


class TestActionsToggleTranspose:
    """Tests for toggle-transpose action."""
    
    def test_toggle_transpose_on(self):
        """Test toggling transpose on."""
        config = MidiStrummerConfig()
        config.strummer.transpose.active = False
        
        actions = Actions(config=config)
        actions.execute('toggle-transpose', {'button': 'Test'})
        
        assert config.strummer.transpose.active is True
    
    def test_toggle_transpose_off(self):
        """Test toggling transpose off."""
        config = MidiStrummerConfig()
        config.strummer.transpose.active = True
        
        actions = Actions(config=config)
        actions.execute('toggle-transpose', {'button': 'Test'})
        
        assert config.strummer.transpose.active is False


class TestActionsChordProgression:
    """Tests for chord progression actions."""
    
    def test_set_chord_in_progression(self):
        """Test setting chord from progression."""
        strummer = Strummer()
        config = MidiStrummerConfig()
        config.strummer.strumming.lower_note_spread = 0
        config.strummer.strumming.upper_note_spread = 0
        
        actions = Actions(config=config, strummer=strummer)
        
        # Set to first chord in c-major-pop progression
        result = actions.execute(
            ['set-chord-in-progression', 'c-major-pop', 0],
            {'button': 'Test'}
        )
        
        assert result is True
        assert len(strummer.notes) > 0
    
    def test_increment_chord_in_progression(self):
        """Test incrementing through progression."""
        strummer = Strummer()
        config = MidiStrummerConfig()
        config.strummer.strumming.lower_note_spread = 0
        config.strummer.strumming.upper_note_spread = 0
        
        actions = Actions(config=config, strummer=strummer)
        
        # First set to index 0
        actions.execute(
            ['set-chord-in-progression', 'c-major-pop', 0],
            {'button': 'Test'}
        )
        first_notes = list(strummer.notes)
        
        # Increment by 1
        actions.execute(
            ['increment-chord-in-progression', 'c-major-pop', 1],
            {'button': 'Test'}
        )
        second_notes = list(strummer.notes)
        
        # Notes should be different (different chord)
        assert first_notes != second_notes
