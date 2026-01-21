"""
Event Emitter

Pythonic event emitter using callback lists.
Ported from midi-strummer/server/eventlistener.py
"""

from typing import Callable, Dict, List, Any
from collections import defaultdict
from weakref import WeakMethod, ref
import inspect


class EventEmitter:
    """
    Pythonic event emitter using callback lists.
    
    Example:
        emitter = EventEmitter()
        
        # Register callback
        emitter.on('note', lambda event: print(event))
        
        # Or use as decorator
        @emitter.on('note')
        def handle_note(event):
            print(event)
        
        # Emit event
        emitter.emit('note', event_data)
    """
    
    def __init__(self):
        # Use weak references to prevent memory leaks
        self._callbacks: Dict[str, List[Any]] = defaultdict(list)
    
    def on(self, event_type: str, callback: Callable = None) -> Callable:
        """
        Register an event callback.
        
        Can be used as a function call or decorator:
            emitter.on('note', my_function)
            
            @emitter.on('note')
            def my_function():
                pass
        
        Args:
            event_type: The type of event to listen for
            callback: Optional callback function
            
        Returns:
            The callback function (useful for decorator pattern)
        """
        def decorator(func: Callable) -> Callable:
            # Use weak references for methods to avoid memory leaks
            if inspect.ismethod(func):
                self._callbacks[event_type].append(WeakMethod(func, self._cleanup_dead_ref))
            else:
                self._callbacks[event_type].append(ref(func, self._cleanup_dead_ref))
            return func
        
        # Support both decorator and direct call patterns
        if callback is None:
            return decorator
        else:
            return decorator(callback)
    
    def once(self, event_type: str, callback: Callable = None) -> Callable:
        """
        Register a callback that only fires once.
        
        Args:
            event_type: The type of event to listen for
            callback: Optional callback function
            
        Returns:
            The callback function
        """
        def decorator(func: Callable) -> Callable:
            def wrapper(*args, **kwargs):
                self.off(event_type, wrapper)
                return func(*args, **kwargs)
            
            self.on(event_type, wrapper)
            return func
        
        if callback is None:
            return decorator
        else:
            return decorator(callback)
    
    def off(self, event_type: str, callback: Callable) -> None:
        """
        Unregister an event callback.
        
        Args:
            event_type: The type of event
            callback: The callback function to remove
        """
        callbacks = self._callbacks.get(event_type, [])
        # Handle both direct references and weak references
        callbacks_to_remove = []
        for cb in callbacks:
            # Handle weak references
            if isinstance(cb, (WeakMethod, ref)):
                if cb() == callback:
                    callbacks_to_remove.append(cb)
            elif cb == callback:
                callbacks_to_remove.append(cb)
        
        for cb in callbacks_to_remove:
            callbacks.remove(cb)
    
    def emit(self, event_type: str, *args, **kwargs) -> None:
        """
        Emit an event, calling all registered callbacks.
        
        Args:
            event_type: The type of event to emit
            *args: Positional arguments to pass to callbacks
            **kwargs: Keyword arguments to pass to callbacks
        """
        callbacks = self._callbacks.get(event_type, []).copy()
        for cb in callbacks:
            # Dereference weak references
            if isinstance(cb, (WeakMethod, ref)):
                callback = cb()
                if callback is not None:
                    callback(*args, **kwargs)
            else:
                cb(*args, **kwargs)
    
    def _cleanup_dead_ref(self, weak_ref):
        """Clean up dead weak references."""
        for event_type, callbacks in self._callbacks.items():
            if weak_ref in callbacks:
                callbacks.remove(weak_ref)
    
    def clear(self, event_type: str = None) -> None:
        """
        Clear all callbacks for an event type, or all callbacks if no type specified.
        
        Args:
            event_type: Optional event type to clear. If None, clears all.
        """
        if event_type:
            self._callbacks[event_type].clear()
        else:
            self._callbacks.clear()
    
    def listener_count(self, event_type: str) -> int:
        """
        Get the number of listeners for an event type.
        
        Args:
            event_type: The event type to check
            
        Returns:
            Number of registered listeners
        """
        return len(self._callbacks.get(event_type, []))
