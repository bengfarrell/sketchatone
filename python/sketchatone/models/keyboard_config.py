"""
Keyboard Input Configuration Model

Configuration for keyboard input that simulates button presses.
Useful for development and testing.
"""

from dataclasses import dataclass, field
from typing import Dict, Any


@dataclass
class KeyboardConfig:
    """
    Keyboard input configuration.

    Keyboard keys are mapped to button IDs to simulate tablet button presses.
    This is useful for:
    - Development and debugging without a tablet
    - Testing button actions
    - Using an external keyboard as an alternative input method

    The presence of this config section enables the keyboard listener.
    To disable, remove the "keyboard" section from config or set mappings to empty.

    Attributes:
        mappings: Map keyboard keys to button IDs (e.g., {"1": "button:1", "2": "button:2"})
    """
    mappings: Dict[str, str] = field(default_factory=dict)

    @property
    def enabled(self) -> bool:
        """Keyboard is enabled if there are any mappings"""
        return bool(self.mappings)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'KeyboardConfig':
        """Create a KeyboardConfig from a dictionary"""
        return cls(
            mappings=data.get('mappings', {})
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'mappings': self.mappings
        }

