"""
Strummer Config Model

Configuration model for strummer-specific settings.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import json
import os


@dataclass
class StrummerConfig:
    """
    Configuration for the strummer.
    
    Attributes:
        pressure_threshold: Minimum pressure to trigger a strum (0-1)
        velocity_scale: Scale factor for velocity (0-1)
        notes: List of note strings for the strum (e.g., ["C4", "E4", "G4"])
        chord: Optional chord notation (e.g., "Am", "Gmaj7")
        lower_spread: Number of notes to add below the chord
        upper_spread: Number of notes to add above the chord
        strum_direction: Default strum direction ("up" or "down")
        strum_speed: Speed of strum in ms between notes
        sustain_time: How long notes sustain in ms
        channel: MIDI channel (0-15)
    """
    pressure_threshold: float = 0.1
    velocity_scale: float = 1.0
    notes: List[str] = field(default_factory=lambda: ["C4", "E4", "G4", "C5"])
    chord: Optional[str] = None
    lower_spread: int = 0
    upper_spread: int = 0
    strum_direction: str = "down"
    strum_speed: float = 20.0
    sustain_time: float = 500.0
    channel: int = 0
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StrummerConfig':
        """Create a StrummerConfig from a dictionary"""
        return cls(
            pressure_threshold=data.get('pressure_threshold', 0.1),
            velocity_scale=data.get('velocity_scale', 1.0),
            notes=data.get('notes', ["C4", "E4", "G4", "C5"]),
            chord=data.get('chord'),
            lower_spread=data.get('lower_spread', 0),
            upper_spread=data.get('upper_spread', 0),
            strum_direction=data.get('strum_direction', 'down'),
            strum_speed=data.get('strum_speed', 20.0),
            sustain_time=data.get('sustain_time', 500.0),
            channel=data.get('channel', 0)
        )
    
    @classmethod
    def from_json_file(cls, path: str) -> 'StrummerConfig':
        """Load a StrummerConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'pressure_threshold': self.pressure_threshold,
            'velocity_scale': self.velocity_scale,
            'notes': self.notes,
            'chord': self.chord,
            'lower_spread': self.lower_spread,
            'upper_spread': self.upper_spread,
            'strum_direction': self.strum_direction,
            'strum_speed': self.strum_speed,
            'sustain_time': self.sustain_time,
            'channel': self.channel
        }
    
    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
