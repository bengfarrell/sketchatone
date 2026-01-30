"""
Server Config Model

Configuration model for HTTP/WebSocket server settings.
"""

from dataclasses import dataclass
from typing import Optional, Dict, Any
import json


@dataclass
class ServerConfig:
    """
    Configuration for server settings.

    Attributes:
        device: Path to device config file or directory for auto-detection (None = use default 'devices' folder)
        http_port: HTTP server port for serving webapps (None = disabled)
        ws_port: WebSocket server port (None = disabled)
        ws_message_throttle: WebSocket message throttle interval in milliseconds (default: 150)
        device_finding_poll_interval: Poll interval in milliseconds for waiting for device (None = quit if no device)
    """
    device: Optional[str] = None
    http_port: Optional[int] = None
    ws_port: Optional[int] = None
    ws_message_throttle: int = 150
    device_finding_poll_interval: Optional[int] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ServerConfig':
        """Create a ServerConfig from a dictionary"""
        # Handle both snake_case and camelCase keys
        return cls(
            device=data.get('device'),
            http_port=data.get('http_port', data.get('httpPort')),
            ws_port=data.get('ws_port', data.get('wsPort')),
            ws_message_throttle=data.get('ws_message_throttle', data.get('wsMessageThrottle', 150)),
            device_finding_poll_interval=data.get('device_finding_poll_interval', data.get('deviceFindingPollInterval'))
        )

    @classmethod
    def from_json_file(cls, path: str) -> 'ServerConfig':
        """Load a ServerConfig from a JSON file"""
        with open(path, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        return {
            'device': self.device,
            'httpPort': self.http_port,
            'wsPort': self.ws_port,
            'wsMessageThrottle': self.ws_message_throttle,
            'deviceFindingPollInterval': self.device_finding_poll_interval
        }

    def to_json_file(self, path: str) -> None:
        """Save the config to a JSON file"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
