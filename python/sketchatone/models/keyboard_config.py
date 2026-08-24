"""
Keyboard Input Configuration Model

The global keyboard listener emits ``key:<char>`` events directly; per-key
labels live under ``device_buttons.keys``. This section only gates whether
the listener runs at all.
"""

from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class KeyboardConfig:
    """
    Keyboard input configuration.

    Attributes:
        enabled: When True, the global keyboard listener starts with the server.
    """
    enabled: bool = True

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'KeyboardConfig':
        return cls(enabled=bool(data.get('enabled', True)))

    def to_dict(self) -> Dict[str, Any]:
        return {'enabled': self.enabled}

