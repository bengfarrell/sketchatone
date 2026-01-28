"""
Tests for the EventEmitter class.

Tests for the EventEmitter class including:
- Event registration
- Event emission
- Event removal
- Once listeners
- Listener count
"""

import pytest
from unittest.mock import Mock

from sketchatone.utils.event_emitter import EventEmitter


class TestEventEmitterBasics:
    """Test basic EventEmitter functionality."""
    
    def test_create_emitter(self):
        """Test creating an EventEmitter."""
        emitter = EventEmitter()
        assert emitter is not None
        assert hasattr(emitter, '_callbacks')
    
    def test_on_registers_callback(self):
        """Test that on() registers a callback."""
        emitter = EventEmitter()
        
        def callback():
            pass
        
        emitter.on('test', callback)
        assert emitter.listener_count('test') == 1
    
    def test_on_as_decorator(self):
        """Test using on() as a decorator."""
        emitter = EventEmitter()
        
        @emitter.on('test')
        def callback():
            pass
        
        assert emitter.listener_count('test') == 1
    
    def test_emit_calls_callback(self):
        """Test that emit() calls registered callbacks."""
        emitter = EventEmitter()
        called = []
        
        def callback(data):
            called.append(data)
        
        emitter.on('test', callback)
        emitter.emit('test', 'hello')
        
        assert len(called) == 1
        assert called[0] == 'hello'
    
    def test_emit_with_multiple_args(self):
        """Test emit with multiple arguments."""
        emitter = EventEmitter()
        called = []
        
        def callback(a, b, c):
            called.append((a, b, c))
        
        emitter.on('test', callback)
        emitter.emit('test', 1, 2, 3)
        
        assert len(called) == 1
        assert called[0] == (1, 2, 3)
    
    def test_emit_with_kwargs(self):
        """Test emit with keyword arguments."""
        emitter = EventEmitter()
        called = []
        
        def callback(name=None, value=None):
            called.append({'name': name, 'value': value})
        
        emitter.on('test', callback)
        emitter.emit('test', name='foo', value=42)
        
        assert len(called) == 1
        assert called[0] == {'name': 'foo', 'value': 42}


class TestEventEmitterMultipleListeners:
    """Test EventEmitter with multiple listeners."""
    
    def test_multiple_listeners_same_event(self):
        """Test multiple listeners for the same event."""
        emitter = EventEmitter()
        called = []
        
        def callback1():
            called.append('callback1')
        
        def callback2():
            called.append('callback2')
        
        emitter.on('test', callback1)
        emitter.on('test', callback2)
        emitter.emit('test')
        
        assert len(called) == 2
        assert 'callback1' in called
        assert 'callback2' in called
    
    def test_different_events(self):
        """Test listeners for different events."""
        emitter = EventEmitter()
        called = []
        
        def callback1():
            called.append('event1')
        
        def callback2():
            called.append('event2')
        
        emitter.on('event1', callback1)
        emitter.on('event2', callback2)
        
        emitter.emit('event1')
        assert called == ['event1']
        
        emitter.emit('event2')
        assert called == ['event1', 'event2']


class TestEventEmitterOff:
    """Test EventEmitter off() functionality."""
    
    def test_off_removes_callback(self):
        """Test that off() removes a callback."""
        emitter = EventEmitter()
        called = []
        
        def callback():
            called.append('called')
        
        emitter.on('test', callback)
        emitter.off('test', callback)
        emitter.emit('test')
        
        assert len(called) == 0
    
    def test_off_only_removes_specified_callback(self):
        """Test that off() only removes the specified callback."""
        emitter = EventEmitter()
        called = []
        
        def callback1():
            called.append('callback1')
        
        def callback2():
            called.append('callback2')
        
        emitter.on('test', callback1)
        emitter.on('test', callback2)
        emitter.off('test', callback1)
        emitter.emit('test')
        
        assert called == ['callback2']


class TestEventEmitterOnce:
    """Test EventEmitter once() functionality."""
    
    def test_once_fires_only_once(self):
        """Test that once() callback fires only once."""
        emitter = EventEmitter()
        called = []
        
        def callback():
            called.append('called')
        
        emitter.once('test', callback)
        emitter.emit('test')
        emitter.emit('test')
        emitter.emit('test')
        
        assert len(called) == 1
    
    def test_once_as_decorator(self):
        """Test using once() as a decorator."""
        emitter = EventEmitter()
        called = []
        
        @emitter.once('test')
        def callback():
            called.append('called')
        
        emitter.emit('test')
        emitter.emit('test')
        
        assert len(called) == 1


class TestEventEmitterClear:
    """Test EventEmitter clear() functionality."""
    
    def test_clear_specific_event(self):
        """Test clearing callbacks for a specific event."""
        emitter = EventEmitter()
        called = []
        
        def callback1():
            called.append('event1')
        
        def callback2():
            called.append('event2')
        
        emitter.on('event1', callback1)
        emitter.on('event2', callback2)
        
        emitter.clear('event1')
        
        emitter.emit('event1')
        emitter.emit('event2')
        
        assert called == ['event2']
    
    def test_clear_all_events(self):
        """Test clearing all callbacks."""
        emitter = EventEmitter()
        called = []
        
        def callback1():
            called.append('event1')
        
        def callback2():
            called.append('event2')
        
        emitter.on('event1', callback1)
        emitter.on('event2', callback2)
        
        emitter.clear()
        
        emitter.emit('event1')
        emitter.emit('event2')
        
        assert called == []


class TestEventEmitterListenerCount:
    """Test EventEmitter listener_count() functionality."""
    
    def test_listener_count_zero(self):
        """Test listener count for event with no listeners."""
        emitter = EventEmitter()
        assert emitter.listener_count('test') == 0
    
    def test_listener_count_after_add(self):
        """Test listener count after adding listeners."""
        emitter = EventEmitter()
        
        def callback():
            pass
        
        emitter.on('test', callback)
        assert emitter.listener_count('test') == 1
        
        def callback2():
            pass
        
        emitter.on('test', callback2)
        assert emitter.listener_count('test') == 2
    
    def test_listener_count_after_remove(self):
        """Test listener count after removing listeners."""
        emitter = EventEmitter()
        
        def callback():
            pass
        
        emitter.on('test', callback)
        emitter.off('test', callback)
        assert emitter.listener_count('test') == 0


class TestEventEmitterEmitNoListeners:
    """Test EventEmitter emit() with no listeners."""
    
    def test_emit_no_listeners(self):
        """Test that emit() with no listeners doesn't raise."""
        emitter = EventEmitter()
        # Should not raise
        emitter.emit('nonexistent')
    
    def test_emit_after_clear(self):
        """Test emit after clearing listeners."""
        emitter = EventEmitter()
        
        def callback():
            pass
        
        emitter.on('test', callback)
        emitter.clear('test')
        # Should not raise
        emitter.emit('test')
