"""
Note Scheduler

A single-threaded scheduler for managing MIDI note-off events.
Uses a priority queue and a single background thread instead of
creating a new thread for each note, which improves performance
during rapid note playback.
"""

import threading
import heapq
import time
from typing import Callable, Dict, Tuple, Optional, Any
from dataclasses import dataclass, field


@dataclass(order=True)
class ScheduledEvent:
    """A scheduled event with a timestamp."""
    timestamp: float
    note_key: Tuple[int, Tuple[int, ...]] = field(compare=False)
    callback: Callable[[], None] = field(compare=False)
    cancelled: bool = field(default=False, compare=False)


class NoteScheduler:
    """
    Efficient note-off scheduler using a single background thread.
    
    Instead of creating a new threading.Timer for each note,
    this uses a priority queue and a single thread that sleeps
    until the next event is due.
    
    Example:
        scheduler = NoteScheduler()
        scheduler.start()
        
        # Schedule a note-off in 0.5 seconds
        scheduler.schedule(note_key, 0.5, lambda: send_note_off(note))
        
        # Cancel if the same note is played again
        scheduler.cancel(note_key)
        
        scheduler.stop()
    """
    
    def __init__(self):
        self._events: list = []  # heap of ScheduledEvent
        self._event_map: Dict[Tuple[int, Tuple[int, ...]], ScheduledEvent] = {}
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._running = False
        self._thread: Optional[threading.Thread] = None
    
    def start(self) -> None:
        """Start the scheduler background thread."""
        if self._running:
            return
        
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
    
    def stop(self) -> None:
        """Stop the scheduler and cancel all pending events."""
        with self._condition:
            self._running = False
            self._events.clear()
            self._event_map.clear()
            self._condition.notify_all()
        
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
    
    def schedule(self, note_key: Tuple[int, Tuple[int, ...]], delay: float, 
                 callback: Callable[[], None]) -> None:
        """
        Schedule a callback to run after a delay.
        
        If an event with the same note_key already exists, it is cancelled
        and replaced with the new event.
        
        Args:
            note_key: Unique identifier for the note (midi_note, channels_tuple)
            delay: Delay in seconds before the callback runs
            callback: Function to call when the delay expires
        """
        timestamp = time.time() + delay
        event = ScheduledEvent(timestamp=timestamp, note_key=note_key, callback=callback)
        
        with self._condition:
            # Cancel existing event for this note
            if note_key in self._event_map:
                self._event_map[note_key].cancelled = True
            
            # Add new event
            self._event_map[note_key] = event
            heapq.heappush(self._events, event)
            
            # Wake up the scheduler thread
            self._condition.notify()
    
    def cancel(self, note_key: Tuple[int, Tuple[int, ...]]) -> bool:
        """
        Cancel a scheduled event.
        
        Args:
            note_key: The note key to cancel
            
        Returns:
            True if an event was cancelled, False if no event was found
        """
        with self._condition:
            if note_key in self._event_map:
                self._event_map[note_key].cancelled = True
                del self._event_map[note_key]
                return True
            return False
    
    def cancel_all(self) -> None:
        """Cancel all scheduled events."""
        with self._condition:
            for event in self._event_map.values():
                event.cancelled = True
            self._event_map.clear()
            # Don't clear _events - they'll be skipped when processed
    
    def _run(self) -> None:
        """Background thread that processes scheduled events."""
        while self._running:
            with self._condition:
                # Clean up cancelled events from the front of the heap
                while self._events and self._events[0].cancelled:
                    heapq.heappop(self._events)
                
                if not self._events:
                    # No events, wait indefinitely for new ones
                    self._condition.wait()
                    continue
                
                # Get the next event
                next_event = self._events[0]
                now = time.time()
                wait_time = next_event.timestamp - now
                
                if wait_time > 0:
                    # Wait until the event is due (or we're notified of a new event)
                    self._condition.wait(timeout=wait_time)
                    continue
                
                # Event is due - pop it
                heapq.heappop(self._events)
                
                # Skip if cancelled
                if next_event.cancelled:
                    continue
                
                # Remove from map if it's still there
                if next_event.note_key in self._event_map:
                    if self._event_map[next_event.note_key] is next_event:
                        del self._event_map[next_event.note_key]
            
            # Execute callback outside the lock
            if not next_event.cancelled:
                try:
                    next_event.callback()
                except Exception as e:
                    # Don't let callback errors crash the scheduler
                    print(f"[NoteScheduler] Callback error: {e}")


# Global scheduler instance (lazy initialization)
_global_scheduler: Optional[NoteScheduler] = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> NoteScheduler:
    """Get the global note scheduler instance, creating it if needed."""
    global _global_scheduler
    
    if _global_scheduler is None:
        with _scheduler_lock:
            if _global_scheduler is None:
                _global_scheduler = NoteScheduler()
                _global_scheduler.start()
    
    return _global_scheduler


def shutdown_scheduler() -> None:
    """Shutdown the global scheduler."""
    global _global_scheduler
    
    with _scheduler_lock:
        if _global_scheduler is not None:
            _global_scheduler.stop()
            _global_scheduler = None
