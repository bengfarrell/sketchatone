"""
Device Buttons Config Model

Persisted list of physical tablet buttons (HID aux codes) and keyboard keys
observed on the device, with an editable name per entry. Auto-discovery is
controlled at runtime by the server's ephemeral ``detecting_device_buttons``
flag (not persisted here).
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any


@dataclass
class DeviceButton:
    """A single physical device button: HID scan code + user-editable name."""
    code: int
    name: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DeviceButton':
        code = data.get('code')
        if not isinstance(code, int):
            raise ValueError(f"DeviceButton.code must be int, got {type(code).__name__}")
        name = data.get('name')
        if not isinstance(name, str) or not name:
            name = f"Button {code}"
        return cls(code=code, name=name)

    def to_dict(self) -> Dict[str, Any]:
        return {'code': self.code, 'name': self.name}


@dataclass
class DeviceKey:
    """A single keyboard key: character + user-editable name.

    Referenced by action rules as ``key:<char>``.
    """
    key: str
    name: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DeviceKey':
        key = data.get('key')
        if not isinstance(key, str) or not key:
            raise ValueError(f"DeviceKey.key must be a non-empty string, got {type(key).__name__}")
        name = data.get('name')
        if not isinstance(name, str) or not name:
            name = f"Key {key.upper()}"
        return cls(key=key, name=name)

    def to_dict(self) -> Dict[str, Any]:
        return {'key': self.key, 'name': self.name}


@dataclass
class DeviceButtonsConfig:
    """
    Configuration for the set of known device buttons and keyboard keys.

    Attributes:
        buttons: Ordered list of known device buttons (HID aux codes).
        keys: Ordered list of known keyboard keys.
    """
    buttons: List[DeviceButton] = field(default_factory=list)
    keys: List[DeviceKey] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DeviceButtonsConfig':
        raw_buttons = data.get('buttons', []) or []
        buttons: List[DeviceButton] = []
        for entry in raw_buttons:
            if isinstance(entry, dict):
                try:
                    buttons.append(DeviceButton.from_dict(entry))
                except ValueError:
                    continue
        raw_keys = data.get('keys', []) or []
        keys: List[DeviceKey] = []
        for entry in raw_keys:
            if isinstance(entry, dict):
                try:
                    keys.append(DeviceKey.from_dict(entry))
                except ValueError:
                    continue
        return cls(buttons=buttons, keys=keys)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'buttons': [b.to_dict() for b in self.buttons],
            'keys': [k.to_dict() for k in self.keys],
        }
