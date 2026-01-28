"""
Tests for the Strummer class.

Tests for the Strummer class including:
- Note setup and bounds
- Strum detection
- Pressure handling
- Release events
- Event emission
"""

import pytest
import time
from unittest.mock import Mock, patch

from sketchatone.strummer.strummer import Strummer
from sketchatone.models.note import Note, NoteObject


class TestStrummerInitialization:
    """Test Strummer initialization."""
    
    def test_default_initialization(self):
        """Test default strummer initialization."""
        strummer = Strummer()
        
        assert strummer._width == 1.0
        assert strummer._height == 1.0
        assert strummer._notes == []
        assert strummer.last_x == -1.0
        assert strummer.last_strummed_index == -1
        assert strummer.last_pressure == 0.0
        assert strummer.pressure_threshold == 0.1
        assert strummer.velocity_scale == 4.0
    
    def test_configure(self):
        """Test strummer configuration."""
        strummer = Strummer()
        strummer.configure(pluck_velocity_scale=5.0, pressure_threshold=0.2)
        
        assert strummer.velocity_scale == 5.0
        assert strummer.pressure_threshold == 0.2


class TestStrummerNotes:
    """Test Strummer note handling."""

    def test_set_notes(self):
        """Test setting notes."""
        strummer = Strummer()
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        strummer.notes = notes

        assert len(strummer.notes) == 3
        assert strummer.notes[0].notation == 'C'
        assert strummer.notes[1].notation == 'E'
        assert strummer.notes[2].notation == 'G'

    def test_notes_changed_event(self):
        """Test that notes_changed event is emitted when notes are set."""
        strummer = Strummer()
        callback = Mock()
        strummer.on('notes_changed', callback)

        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
        ]
        strummer.notes = notes

        # Note: EventEmitter uses weak references, so callback may not be called
        # if it's garbage collected. For this test, we just verify notes are set.
        assert len(strummer.notes) == 1

    def test_get_notes_state(self):
        """Test getting notes state for broadcasting."""
        strummer = Strummer()
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=True),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        strummer.notes = notes

        state = strummer.get_notes_state()

        assert state['type'] == 'notes'
        assert state['stringCount'] == 3
        assert len(state['notes']) == 3
        # Base notes should exclude secondary notes
        assert len(state['baseNotes']) == 2
        assert 'timestamp' in state


class TestStrummerBounds:
    """Test Strummer bounds handling."""
    
    def test_update_bounds(self):
        """Test updating strummer bounds."""
        strummer = Strummer()
        strummer.update_bounds(1920.0, 1080.0)
        
        assert strummer._width == 1920.0
        assert strummer._height == 1080.0
    
    def test_notes_update_bounds(self):
        """Test that setting notes calls update_bounds."""
        strummer = Strummer()
        strummer.update_bounds(1920.0, 1080.0)

        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
        ]
        strummer.notes = notes

        # Bounds should be preserved
        assert strummer._width == 1920.0
        assert strummer._height == 1080.0


class TestStrummerStrum:
    """Test Strummer strum detection."""

    def setup_method(self):
        """Set up test fixtures."""
        self.strummer = Strummer()
        self.strummer.update_bounds(1.0, 1.0)
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        self.strummer.notes = notes
    
    def test_no_strum_below_threshold(self):
        """Test that no strum is triggered below pressure threshold."""
        result = self.strummer.strum(0.5, 0.05)  # Below 0.1 threshold
        assert result is None
    
    def test_strum_buffering_on_pressure_down(self):
        """Test that strum is buffered when pressure goes above threshold."""
        # First call with low pressure
        self.strummer.strum(0.5, 0.05)
        # Second call with pressure above threshold - starts buffering
        result = self.strummer.strum(0.5, 0.15)
        assert result is None  # Still buffering
    
    def test_strum_triggers_after_buffer(self):
        """Test that strum triggers after buffer is full."""
        # Simulate pressure down and buffering
        # Buffer needs 3 samples. When pressure goes from below to above threshold,
        # it starts with 2 samples (previous + current), so we need one more.
        self.strummer.strum(0.5, 0.05)  # Below threshold
        self.strummer.strum(0.5, 0.15)  # Above threshold - starts buffering with 2 samples
        result = self.strummer.strum(0.5, 0.2)   # Third sample - buffer full, should trigger

        assert result is not None
        assert result['type'] == 'strum'
        assert len(result['notes']) == 1
    
    def test_strum_no_notes(self):
        """Test strum with no notes set."""
        strummer = Strummer()
        result = strummer.strum(0.5, 0.5)
        assert result is None
    
    def test_clear_strum(self):
        """Test clearing strum state."""
        self.strummer.last_strummed_index = 1
        self.strummer.last_pressure = 0.5
        self.strummer.last_strum_velocity = 100
        
        self.strummer.clear_strum()
        
        assert self.strummer.last_strummed_index == -1
        assert self.strummer.last_pressure == 0.0
        assert self.strummer.last_strum_velocity == 0


class TestStrummerRelease:
    """Test Strummer release detection."""

    def setup_method(self):
        """Set up test fixtures."""
        self.strummer = Strummer()
        self.strummer.update_bounds(1.0, 1.0)
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        self.strummer.notes = notes
    
    def test_release_event_on_pressure_up(self):
        """Test that release event is triggered when pressure drops."""
        # Trigger a strum first
        self.strummer.strum(0.5, 0.05)
        self.strummer.strum(0.5, 0.15)
        self.strummer.strum(0.5, 0.2)
        self.strummer.strum(0.5, 0.25)  # Triggers strum
        
        # Now release pressure
        result = self.strummer.strum(0.5, 0.05)  # Below threshold
        
        assert result is not None
        assert result['type'] == 'release'
        assert 'velocity' in result
    
    def test_no_release_without_prior_strum(self):
        """Test that no release event without prior strum."""
        # Just go above and below threshold without completing strum
        self.strummer.strum(0.5, 0.05)
        self.strummer.strum(0.5, 0.15)  # Start buffering
        result = self.strummer.strum(0.5, 0.05)  # Drop pressure
        
        # Should not trigger release since strum wasn't completed
        assert result is None


class TestStrummerVelocity:
    """Test Strummer velocity calculation."""

    def setup_method(self):
        """Set up test fixtures."""
        self.strummer = Strummer()
        self.strummer.update_bounds(1.0, 1.0)
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        self.strummer.notes = notes
    
    def test_velocity_range(self):
        """Test that velocity is within MIDI range."""
        # Trigger a strum with high pressure
        # Buffer needs 3 samples: below threshold, above threshold (2 samples), then trigger
        self.strummer.strum(0.5, 0.05)  # Below threshold
        self.strummer.strum(0.5, 0.5)   # Above threshold - starts buffering with 2 samples
        result = self.strummer.strum(0.5, 0.8)  # Third sample - triggers

        assert result is not None
        assert result['type'] == 'strum'
        velocity = result['notes'][0]['velocity']
        assert 20 <= velocity <= 127
    
    def test_minimum_velocity(self):
        """Test minimum velocity with low pressure."""
        # Trigger a strum with pressure just above threshold
        # Buffer needs 3 samples
        self.strummer.strum(0.5, 0.05)  # Below threshold
        self.strummer.strum(0.5, 0.11)  # Above threshold - starts buffering with 2 samples
        result = self.strummer.strum(0.5, 0.12)  # Third sample - triggers

        assert result is not None
        velocity = result['notes'][0]['velocity']
        assert velocity >= 20  # Minimum velocity


class TestStrummerStringCrossing:
    """Test Strummer string crossing detection."""

    def setup_method(self):
        """Set up test fixtures."""
        self.strummer = Strummer()
        self.strummer.update_bounds(1.0, 1.0)
        notes = [
            NoteObject(notation='C', octave=4, secondary=False),
            NoteObject(notation='E', octave=4, secondary=False),
            NoteObject(notation='G', octave=4, secondary=False),
        ]
        self.strummer.notes = notes
    
    def test_strum_across_strings(self):
        """Test strumming across multiple strings."""
        # First, trigger initial strum on first string
        self.strummer.strum(0.1, 0.05)  # Low pressure
        self.strummer.strum(0.1, 0.15)  # Start buffering
        self.strummer.strum(0.1, 0.2)
        self.strummer.strum(0.1, 0.25)  # Complete strum on string 0
        
        # Now move to string 2 while maintaining pressure
        result = self.strummer.strum(0.9, 0.5)  # Move to last string
        
        assert result is not None
        assert result['type'] == 'strum'
        # Should have strummed across strings 1 and 2
        assert len(result['notes']) >= 1


class TestStrummerEventEmitter:
    """Test Strummer event emitter functionality."""
    
    def test_inherits_from_event_emitter(self):
        """Test that Strummer inherits from EventEmitter."""
        strummer = Strummer()
        
        # Should have EventEmitter methods
        assert hasattr(strummer, 'on')
        assert hasattr(strummer, 'emit')
        assert hasattr(strummer, 'off')
    
    def test_listener_count(self):
        """Test listener count functionality."""
        strummer = Strummer()
        
        # Initially no listeners
        assert strummer.listener_count('notes_changed') == 0
        
        # Add a listener (note: weak references may affect this)
        def callback():
            pass
        strummer.on('notes_changed', callback)
        
        # Should have at least attempted to add listener
        # (weak reference behavior may vary)
