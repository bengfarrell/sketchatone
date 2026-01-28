#!/usr/bin/env python3
"""
Strummer Server CLI

A CLI tool that creates WebSocket and HTTP servers for tablet and strum events.
Mirrors the TypeScript server.ts implementation.

Usage:
    python -m sketchatone.cli.server
    python -m sketchatone.cli.server --poll 2000
    python -m sketchatone.cli.server --ws-port 8081 --http-port 3000 --throttle 100
"""

import argparse
import asyncio
import json
import sys
import os
import time
import mimetypes
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Set, Callable
from urllib.parse import unquote

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone.strummer.strummer import Strummer
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
from sketchatone.models.note import Note, NoteObject

# Import blankslate's TabletReaderBase
try:
    from blankslate.cli.tablet_reader_base import TabletReaderBase, Colors, colored
    from blankslate.utils.finddevice import find_config_for_device
except ImportError:
    print("Error: blankslate package not found.")
    print("Make sure blankslate is installed: pip install -e ../blankslate/python")
    sys.exit(1)

# Import websockets
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:
    print("Error: websockets package not found.")
    print("Make sure websockets is installed: pip install websockets")
    sys.exit(1)

# Default config directory (relative to python/ directory)
DEFAULT_CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '..', 'public', 'configs')

# MIME types for HTTP server
MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
}


@dataclass
class TabletEventData:
    """Tablet event data structure"""
    x: float = 0.0
    y: float = 0.0
    pressure: float = 0.0
    state: str = 'unknown'
    tiltX: float = 0.0
    tiltY: float = 0.0
    tiltXY: float = 0.0
    primaryButtonPressed: bool = False
    secondaryButtonPressed: bool = False
    # Tablet hardware buttons
    tabletButtons: int = 0
    button1: bool = False
    button2: bool = False
    button3: bool = False
    button4: bool = False
    button5: bool = False
    button6: bool = False
    button7: bool = False
    button8: bool = False


@dataclass
class StrumNoteEventData:
    """Individual strum note data"""
    note: int
    velocity: int
    name: str
    octave: int
    duration: float


@dataclass
class StrumEventData:
    """Strum event data structure"""
    type: str  # 'strum', 'mute', etc.
    notes: List[StrumNoteEventData] = field(default_factory=list)
    velocity: int = 0
    x: float = 0.0
    pressure: float = 0.0


@dataclass
class CombinedEventData:
    """Combined tablet + strum event data"""
    tablet: Optional[TabletEventData] = None
    strum: Optional[StrumEventData] = None


class StrummerEventBus:
    """
    Throttled event emitter for strummer events.

    Uses a buffer-based approach where:
    - Tablet data overwrites previous data (latest wins)
    - Strum data is preserved until the buffer is sent
    - Buffer is flushed at regular intervals (throttleMs)
    - Only sends if new data has arrived since last flush
    """

    def __init__(self, throttle_ms: int = 150):
        self.throttle_ms = throttle_ms
        self._buffer: CombinedEventData = CombinedEventData()
        self._listeners: List[Callable[[CombinedEventData], None]] = []
        self._interval_task: Optional[asyncio.Task] = None
        self._paused = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._has_new_data = False  # Track if new data has arrived since last flush

    def set_throttle(self, throttle_ms: int) -> None:
        """Update the throttle interval"""
        self.throttle_ms = throttle_ms

    def emit_tablet_event(self, data: TabletEventData) -> None:
        """Add tablet event to buffer (overwrites previous)"""
        self._buffer.tablet = data
        self._has_new_data = True

    def emit_strum_event(self, data: StrumEventData) -> None:
        """Add strum event to buffer (preserved until flush)"""
        self._buffer.strum = data
        self._has_new_data = True

    def on_combined_event(self, callback: Callable[[CombinedEventData], None]) -> None:
        """Register a listener for combined events"""
        self._listeners.append(callback)

    def off_combined_event(self, callback: Callable[[CombinedEventData], None]) -> None:
        """Remove a listener"""
        if callback in self._listeners:
            self._listeners.remove(callback)

    def pause(self) -> None:
        """Pause event emission"""
        self._paused = True

    def resume(self) -> None:
        """Resume event emission"""
        self._paused = False

    def flush(self) -> None:
        """Flush the buffer and emit combined event. Only sends if new data arrived."""
        if self._paused:
            return

        # Only emit if there's new data since last flush
        if not self._has_new_data:
            return

        if self._buffer.tablet is not None or self._buffer.strum is not None:
            for listener in self._listeners:
                try:
                    listener(self._buffer)
                except Exception as e:
                    print(colored(f'Error in event listener: {e}', Colors.RED))

            # Clear strum data after flush (tablet data persists)
            self._buffer.strum = None

        # Reset the new data flag
        self._has_new_data = False

    async def _flush_loop(self) -> None:
        """Background task that flushes buffer at regular intervals"""
        while True:
            await asyncio.sleep(self.throttle_ms / 1000.0)
            self.flush()

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start the flush interval"""
        self._loop = loop
        if self._interval_task is None:
            self._interval_task = loop.create_task(self._flush_loop())

    def cleanup(self) -> None:
        """Stop the flush interval and clear listeners"""
        if self._interval_task is not None:
            self._interval_task.cancel()
            self._interval_task = None
        self._listeners.clear()


def _poll_for_device(search_dir: str, poll_ms: int) -> str:
    """
    Poll for a device connection indefinitely.

    Args:
        search_dir: Directory to search for config files
        poll_ms: Poll interval in milliseconds

    Returns:
        Config file path when device is found
    """
    print(colored(f'No tablet device found. Waiting for device to be connected...', Colors.YELLOW))
    print(colored(f'Poll interval: {poll_ms}ms', Colors.GRAY))
    print(colored('Press Ctrl+C to exit.', Colors.GRAY))

    while True:
        found_config = find_config_for_device(search_dir)
        if found_config:
            print(colored(f'Device connected! Using config: {found_config}', Colors.GREEN))
            return found_config
        time.sleep(poll_ms / 1000.0)


def _exit_no_device(search_dir: str) -> None:
    """Exit with error message when no device is found."""
    print(colored(f'Error: No matching tablet config found in: {search_dir}', Colors.RED))
    print(colored('Use --poll <ms> to wait for a device to be connected.', Colors.GRAY))
    sys.exit(1)


def resolve_config_path(config_arg: str | None, default_dir: str = DEFAULT_CONFIG_DIR, poll_ms: int | None = None) -> tuple[str | None, str]:
    """
    Resolve config path - if it's a directory or None, search for matching config.

    Args:
        config_arg: Config path argument (file, directory, or None)
        default_dir: Default directory to search if config_arg is None
        poll_ms: If set, return None for config path to indicate polling should happen later

    Returns:
        Tuple of (config_file_path or None, search_directory)
        If config_file_path is None, the server should poll for device in background

    Raises:
        SystemExit: If no matching config is found and poll_ms is not set
    """
    # If no config provided, use default directory
    if config_arg is None:
        search_dir = os.path.abspath(default_dir)
        found_config = find_config_for_device(search_dir)
        if found_config:
            return found_config, search_dir
        elif poll_ms is not None:
            # Return None to indicate polling should happen in background
            return None, search_dir
        else:
            _exit_no_device(search_dir)

    # If it's a file with .json extension, use it directly
    if config_arg.endswith('.json'):
        if not os.path.exists(config_arg):
            print(colored(f'Error: Config file not found: {config_arg}', Colors.RED))
            sys.exit(1)
        return config_arg, os.path.dirname(os.path.abspath(config_arg))

    # Otherwise treat as directory
    search_dir = os.path.abspath(config_arg)
    if not os.path.isdir(search_dir):
        print(colored(f'Error: Path is not a file or directory: {config_arg}', Colors.RED))
        sys.exit(1)

    found_config = find_config_for_device(search_dir)
    if found_config:
        return found_config, search_dir
    elif poll_ms is not None:
        # Return None to indicate polling should happen in background
        return None, search_dir
    else:
        _exit_no_device(search_dir)


class StrummerWebSocketServer(TabletReaderBase):
    """
    WebSocket server that broadcasts tablet and strum events.
    Extends TabletReaderBase for HID device access.
    """

    def __init__(
        self,
        tablet_config_path: Optional[str],
        strummer_config_path: Optional[str] = None,
        ws_port: int = 8081,
        http_port: Optional[int] = None,
        throttle_ms: int = 150,
        poll_ms: Optional[int] = None,
        search_dir: Optional[str] = None
    ):
        # Only call parent init if we have a config path
        # Otherwise we'll initialize later when device is found
        self._tablet_initialized = tablet_config_path is not None
        if tablet_config_path:
            super().__init__(tablet_config_path)

        self.ws_port = ws_port
        self.http_port = http_port
        self.poll_ms = poll_ms
        self.search_dir = search_dir or DEFAULT_CONFIG_DIR

        # Determine public directory for HTTP server
        # __file__ is python/sketchatone/cli/server.py
        # Go up 4 levels to project root, then into dist/public
        self.public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'dist', 'public')
        self.clients: Set[WebSocketServerProtocol] = set()
        self.server: Optional[websockets.WebSocketServer] = None
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None

        # Create event bus
        self.event_bus = StrummerEventBus(throttle_ms)

        # Load config
        if strummer_config_path:
            self.config = MidiStrummerConfig.from_json_file(strummer_config_path)
        else:
            self.config = MidiStrummerConfig()

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)

        # Set up notes
        self._setup_notes()

        # Register event bus listener
        self.event_bus.on_combined_event(self._broadcast_combined_event)
    
    def _setup_notes(self) -> None:
        """Set up notes from config"""
        base_notes = []

        # If chord is specified, parse it
        if self.config.chord:
            base_notes = Note.parse_chord(self.config.chord)
        else:
            # Parse individual note strings (e.g., "C4", "E4", "G4")
            for note_str in self.config.notes:
                base_notes.append(Note.parse_notation(note_str))

        # Apply spread to both chord and initial notes
        notes = Note.fill_note_spread(
            base_notes,
            self.config.lower_spread,
            self.config.upper_spread
        )

        self.strummer.notes = notes

    async def start(self) -> None:
        """Start the reader - required by TabletReaderBase abstract method"""
        # This is called by the parent class's start_sync method
        # We just need to call the parent's initialize_reader
        await self.initialize_reader()

    async def _handle_http_request(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming HTTP request for static file serving"""
        try:
            # Read request line
            request_line = await reader.readline()
            if not request_line:
                return

            request_text = request_line.decode('utf-8', errors='ignore')
            parts = request_text.strip().split(' ')
            if len(parts) < 2:
                return

            method, path = parts[0], parts[1]

            # Read headers (we don't need them but must consume them)
            while True:
                line = await reader.readline()
                if line == b'\r\n' or line == b'\n' or not line:
                    break

            # Only handle GET requests
            if method != 'GET':
                response = b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
                return

            # Parse path
            url_path = path.split('?')[0]  # Remove query string
            if url_path == '/':
                url_path = '/index.html'

            # Security: prevent directory traversal
            if '..' in url_path:
                response = b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
                return

            # Build file path
            file_path = os.path.join(self.public_dir, url_path.lstrip('/'))

            if os.path.isfile(file_path):
                # Get MIME type
                ext = os.path.splitext(file_path)[1].lower()
                content_type = MIME_TYPES.get(ext, 'application/octet-stream')

                # Read and serve file
                with open(file_path, 'rb') as f:
                    content = f.read()

                response_headers = f'HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {len(content)}\r\n\r\n'
                writer.write(response_headers.encode('utf-8'))
                writer.write(content)
            else:
                # 404 Not Found
                body = b'Not Found'
                response = f'HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n'
                writer.write(response.encode('utf-8'))
                writer.write(body)

            await writer.drain()
        except Exception as e:
            try:
                response = b'HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
            except:
                pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass

    def _broadcast_combined_event(self, data: CombinedEventData) -> None:
        """Broadcast combined event to all connected clients"""
        if not self.clients:
            return

        # Build message - format matches Node.js server
        # Tablet data is spread at top level, strum is optional nested object
        message: Dict[str, Any] = {
            'type': 'tablet-data',
            'timestamp': int(time.time() * 1000)
        }

        if data.tablet:
            message['x'] = data.tablet.x
            message['y'] = data.tablet.y
            message['pressure'] = data.tablet.pressure
            message['state'] = data.tablet.state
            message['tiltX'] = data.tablet.tiltX
            message['tiltY'] = data.tablet.tiltY
            message['tiltXY'] = data.tablet.tiltXY
            message['primaryButtonPressed'] = data.tablet.primaryButtonPressed
            message['secondaryButtonPressed'] = data.tablet.secondaryButtonPressed
            # Tablet hardware buttons
            message['tabletButtons'] = data.tablet.tabletButtons
            message['button1'] = data.tablet.button1
            message['button2'] = data.tablet.button2
            message['button3'] = data.tablet.button3
            message['button4'] = data.tablet.button4
            message['button5'] = data.tablet.button5
            message['button6'] = data.tablet.button6
            message['button7'] = data.tablet.button7
            message['button8'] = data.tablet.button8

        if data.strum:
            message['strum'] = {
                'type': data.strum.type,
                'notes': [
                    {
                        'note': {
                            'notation': n.name,
                            'octave': n.octave,
                            'midiNote': n.note
                        },
                        'velocity': n.velocity
                    }
                    for n in data.strum.notes
                ],
                'velocity': data.strum.velocity,
                'timestamp': int(time.time() * 1000)
            }

        # Broadcast to all clients
        self._broadcast(json.dumps(message))
    
    def _broadcast(self, message: str) -> None:
        """Broadcast message to all connected clients"""
        if not self.clients or self._main_loop is None:
            return
        
        # Schedule sends for all clients
        for client in list(self.clients):
            asyncio.run_coroutine_threadsafe(
                self._send_to_client(client, message),
                self._main_loop
            )
    
    async def _send_to_client(self, client: WebSocketServerProtocol, message: str) -> None:
        """Send message to a specific client"""
        try:
            await client.send(message)
        except websockets.exceptions.ConnectionClosed:
            self.clients.discard(client)
    
    def broadcast_status(self, connected: bool, device_name: Optional[str] = None) -> None:
        """Broadcast device status to all clients"""
        import time
        status_str = 'connected' if connected else 'disconnected'
        message_text = f'Tablet {"connected" if connected else "disconnected"}'
        if device_name:
            message_text = f'{device_name} {status_str}'

        message = {
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }
        self._broadcast(json.dumps(message))
    
    def _get_config_data(self) -> Dict[str, Any]:
        """Get config data in the format expected by the webapp"""
        return {
            'throttleMs': self.event_bus.throttle_ms,
            'notes': [
                {'notation': n.notation, 'octave': n.octave}
                for n in self.strummer.notes
            ],
            'config': self.config.to_dict()
        }

    def broadcast_config(self) -> None:
        """Broadcast current config to all clients"""
        message = {
            'type': 'config',
            'data': self._get_config_data()
        }
        self._broadcast(json.dumps(message))
    
    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a WebSocket client connection"""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(colored(f'Client connected: {client_addr}', Colors.GREEN))
        
        # Resume event bus when first client connects
        if len(self.clients) == 1:
            self.event_bus.resume()
        
        # Send initial config
        await websocket.send(json.dumps({
            'type': 'config',
            'data': self._get_config_data()
        }))
        
        # Send initial status (matching Node.js format)
        import time
        device_name = self.device_name if hasattr(self, 'device_name') else None
        connected = self.is_running
        status_str = 'connected' if connected else 'disconnected'
        message_text = 'Tablet connected' if connected else 'Waiting for tablet...'
        if device_name and connected:
            message_text = f'{device_name} connected'

        await websocket.send(json.dumps({
            'type': 'status',
            'status': status_str,
            'deviceConnected': connected,
            'message': message_text,
            'timestamp': int(time.time() * 1000)
        }))
        
        try:
            async for message in websocket:
                await self._handle_client_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(colored(f'Client disconnected: {client_addr}', Colors.YELLOW))
            
            # Pause event bus when no clients connected
            if len(self.clients) == 0:
                self.event_bus.pause()
    
    async def _handle_client_message(self, websocket: WebSocketServerProtocol, message: str) -> None:
        """Handle incoming client message"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'set-throttle':
                # Support both 'throttleMs' (webapp format) and 'throttle' (legacy)
                throttle = data.get('throttleMs', data.get('throttle', 150))
                self.event_bus.set_throttle(throttle)
                print(colored(f'Throttle updated to {throttle}ms', Colors.CYAN))
            
            elif msg_type == 'update-config':
                # Handle path-based config updates (like Node.js server)
                path = data.get('path')
                value = data.get('value')
                if path is not None:
                    self._handle_config_update(path, value)
                else:
                    # Legacy: full config object update
                    config_data = data.get('config', {})
                    self._update_config(config_data)
                # Broadcast updated config to all clients
                self.broadcast_config()

            else:
                print(colored(f'Unknown message type: {msg_type}', Colors.YELLOW))
        
        except json.JSONDecodeError:
            print(colored(f'Invalid JSON message received', Colors.RED))
    
    def _update_config(self, config_data: Dict[str, Any]) -> None:
        """Update configuration from client data"""
        # Update basic settings
        if 'velocityScale' in config_data:
            self.config.velocity_scale = config_data['velocityScale']
        if 'pressureThreshold' in config_data:
            self.config.pressure_threshold = config_data['pressureThreshold']
        if 'defaultVelocity' in config_data:
            self.config.default_velocity = config_data['defaultVelocity']
        if 'noteDuration' in config_data:
            self.config.note_duration = config_data['noteDuration']
        
        # Update notes if provided
        if 'notes' in config_data:
            self.config.notes = []
            for note_data in config_data['notes']:
                from sketchatone.models.midi_strummer_config import NoteConfig
                note_config = NoteConfig(
                    name=note_data.get('name', 'C'),
                    octave=note_data.get('octave', 4),
                    velocity=note_data.get('velocity'),
                    duration=note_data.get('duration')
                )
                self.config.notes.append(note_config)
        
        # Reconfigure strummer
        self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)
        self._setup_notes()

        print(colored('Config updated from client', Colors.GREEN))

    def _handle_config_update(self, path: str, value: Any) -> None:
        """
        Handle a path-based config update from a client.
        Updates the config and re-applies settings as needed.

        Args:
            path: Dot-notation path to the config property (e.g., 'strummer.strumming.upperNoteSpread')
            value: The new value for the property
        """
        try:
            # Set the config value using the path
            self._set_config_value(path, value)

            # Re-apply strummer settings if relevant
            if path.startswith('strummer.strumming.'):
                self.strummer.configure(self.config.velocity_scale, self.config.pressure_threshold)

            # Re-setup notes if chord or note spread changed
            if 'chord' in path.lower() or 'spread' in path.lower() or 'initialNotes' in path:
                self._setup_notes()

            print(colored(f'Config updated: {path} = {value}', Colors.YELLOW))
        except Exception as e:
            print(colored(f'Failed to update config: {path} - {e}', Colors.RED))

    def _set_config_value(self, path: str, value: Any) -> None:
        """
        Set a config value using dot-notation path.

        Args:
            path: Dot-notation path (e.g., 'strummer.strumming.upperNoteSpread')
            value: The value to set
        """
        parts = path.split('.')

        # Navigate to the parent object
        current: Any = self.config
        for i, part in enumerate(parts[:-1]):
            # Convert camelCase to snake_case for Python attribute access
            snake_part = self._camel_to_snake(part)
            if hasattr(current, snake_part):
                current = getattr(current, snake_part)
            elif hasattr(current, part):
                current = getattr(current, part)
            elif isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, dict) and snake_part in current:
                current = current[snake_part]
            else:
                raise ValueError(f"Invalid path: {path} (failed at '{part}')")

        # Set the value on the final attribute
        last_part = parts[-1]
        snake_last = self._camel_to_snake(last_part)

        if hasattr(current, snake_last):
            setattr(current, snake_last, value)
        elif hasattr(current, last_part):
            setattr(current, last_part, value)
        elif isinstance(current, dict):
            # Try snake_case first, then camelCase
            if snake_last in current:
                current[snake_last] = value
            else:
                current[last_part] = value
        else:
            raise ValueError(f"Cannot set value at path: {path}")

    def _camel_to_snake(self, name: str) -> str:
        """Convert camelCase to snake_case"""
        import re
        # Insert underscore before uppercase letters and convert to lowercase
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def handle_packet(self, data: bytes) -> None:
        """Handle incoming HID packet"""
        try:
            # Process the data using the config
            events = self.process_packet(data)

            # Extract normalized values
            x = float(events.get('x', 0))
            y = float(events.get('y', 0))
            pressure = float(events.get('pressure', 0))
            state = str(events.get('state', 'unknown'))
            tilt_x = float(events.get('tiltX', 0))
            tilt_y = float(events.get('tiltY', 0))
            # Calculate combined tilt
            tilt_xy = (tilt_x + tilt_y) / 2.0 if (tilt_x != 0 or tilt_y != 0) else 0.0
            tilt_xy = max(-1.0, min(1.0, tilt_xy))
            primary_button = bool(events.get('primaryButton') or events.get('primaryButtonPressed'))
            secondary_button = bool(events.get('secondaryButton') or events.get('secondaryButtonPressed'))

            # Extract tablet hardware buttons
            tablet_buttons = int(events.get('tabletButtons', 0))
            button1 = bool(events.get('button1'))
            button2 = bool(events.get('button2'))
            button3 = bool(events.get('button3'))
            button4 = bool(events.get('button4'))
            button5 = bool(events.get('button5'))
            button6 = bool(events.get('button6'))
            button7 = bool(events.get('button7'))
            button8 = bool(events.get('button8'))

            # Create tablet event data
            tablet_data = TabletEventData(
                x=x, y=y, pressure=pressure, state=state,
                tiltX=tilt_x, tiltY=tilt_y, tiltXY=tilt_xy,
                primaryButtonPressed=primary_button,
                secondaryButtonPressed=secondary_button,
                tabletButtons=tablet_buttons,
                button1=button1, button2=button2, button3=button3, button4=button4,
                button5=button5, button6=button6, button7=button7, button8=button8
            )
            self.event_bus.emit_tablet_event(tablet_data)
            
            # Update strummer bounds (use normalized 0-1 range)
            self.strummer.update_bounds(1.0, 1.0)
            
            # Process strum
            event = self.strummer.strum(x, pressure)
            
            if event:
                # Create strum event data
                # event is a dict: {'type': 'strum'|'release', 'notes': [{'note': NoteObject, 'velocity': int}], ...}
                strum_notes = []
                event_notes = event.get('notes', [])
                if event_notes:
                    for note_data in event_notes:
                        note_obj = note_data['note']  # This is a NoteObject
                        strum_notes.append(StrumNoteEventData(
                            note=note_obj.to_midi(),
                            velocity=note_data['velocity'],
                            name=note_obj.notation,
                            octave=note_obj.octave,
                            duration=0  # Duration not provided by strummer
                        ))

                strum_data = StrumEventData(
                    type=event.get('type', 'strum'),
                    notes=strum_notes,
                    velocity=event.get('velocity', strum_notes[0].velocity if strum_notes else 0),
                    x=x,
                    pressure=pressure
                )
                self.event_bus.emit_strum_event(strum_data)

        except Exception as e:
            print(colored(f'Error processing packet: {e}', Colors.RED))
    
    def handle_device_disconnect(self) -> None:
        """Handle device disconnection"""
        super().handle_device_disconnect()
        self.broadcast_status(False)
        print(colored('Device disconnected', Colors.YELLOW))
        
        # If poll_ms is set, attempt to reconnect
        if self.poll_ms is not None:
            self._attempt_reconnect()
    
    def _attempt_reconnect(self) -> None:
        """Attempt to reconnect to device"""
        if self.poll_ms is None:
            return
        
        print(colored(f'Attempting to reconnect (polling every {self.poll_ms}ms)...', Colors.YELLOW))
        
        while not self.is_running:
            time.sleep(self.poll_ms / 1000.0)
            try:
                # Try to find and connect to device
                search_dir = os.path.dirname(self.config_path) if hasattr(self, 'config_path') else DEFAULT_CONFIG_DIR
                found_config = find_config_for_device(search_dir)
                if found_config:
                    self.reconnect()
                    if self.is_running:
                        print(colored('Device reconnected!', Colors.GREEN))
                        self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
                        break
            except Exception as e:
                pass  # Continue polling
    
    async def run_server(self) -> None:
        """Run the WebSocket and HTTP servers"""
        self._main_loop = asyncio.get_event_loop()
        http_server = None

        # Start event bus
        self.event_bus.start(self._main_loop)

        # Pause event bus initially (no clients)
        self.event_bus.pause()

        # Start HTTP server if port is configured
        if self.http_port:
            http_server = await asyncio.start_server(
                self._handle_http_request,
                "0.0.0.0",
                self.http_port
            )
            print(colored(f'HTTP server started on http://0.0.0.0:{self.http_port}', Colors.CYAN))
            print(colored(f'Serving files from: {self.public_dir}', Colors.GRAY))

        # Start WebSocket server
        self.server = await websockets.serve(
            self._handle_client,
            "0.0.0.0",
            self.ws_port
        )

        print(colored(f'WebSocket server started on ws://0.0.0.0:{self.ws_port}', Colors.CYAN))
        print(colored('Press Ctrl+C to stop', Colors.GRAY))

        # Start reading tablet data in a separate thread
        import threading
        tablet_thread = threading.Thread(target=self._run_tablet_reader, daemon=True)
        tablet_thread.start()

        # Keep server running
        try:
            await asyncio.Future()  # Run forever
        except asyncio.CancelledError:
            pass
        finally:
            self.event_bus.cleanup()
            if http_server:
                http_server.close()
                await http_server.wait_closed()
            if self.server:
                self.server.close()
                await self.server.wait_closed()

    def _run_tablet_reader(self) -> None:
        """Run tablet reader in a separate thread"""
        # If tablet wasn't initialized (no device found at startup), poll for it first
        if not self._tablet_initialized:
            print(colored('Tablet not initialized at startup, starting poll...', Colors.YELLOW))
            self._poll_and_initialize_tablet()
            if not self._tablet_initialized:
                print(colored('Failed to initialize tablet after polling', Colors.RED))
                return  # Still no device, give up

        print(colored('Starting tablet reader...', Colors.CYAN))
        try:
            # Initialize the HID reader
            self.initialize_reader_sync()

            if not self.reader:
                raise RuntimeError('Reader not initialized')

            # Start reading data
            if hasattr(self.reader, 'start_reading'):
                self.reader.start_reading(lambda data: self.handle_packet(data))

            self.is_running = True
            self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
            print(colored('✓ Tablet reader started', Colors.GREEN))

            # Keep thread alive while running
            while self.is_running:
                time.sleep(0.1)

        except Exception as e:
            print(colored(f'Tablet reader error: {e}', Colors.RED))
            import traceback
            traceback.print_exc()
            if self.poll_ms is not None:
                self._attempt_reconnect()

    def _poll_and_initialize_tablet(self) -> None:
        """Poll for device and initialize tablet reader when found"""
        if self.poll_ms is None:
            return

        print(colored('Waiting for tablet device to be connected...', Colors.YELLOW))
        print(colored(f'Poll interval: {self.poll_ms}ms', Colors.GRAY))

        while True:
            found_config = find_config_for_device(self.search_dir)
            if found_config:
                print(colored(f'Device connected! Using config: {found_config}', Colors.GREEN))
                try:
                    # Initialize the tablet reader with the found config
                    TabletReaderBase.__init__(self, found_config)
                    self._tablet_initialized = True
                    self.broadcast_status(True, self.device_name if hasattr(self, 'device_name') else None)
                    print(colored('Tablet reader initialized successfully', Colors.GREEN))
                    return
                except Exception as e:
                    print(colored(f'Failed to initialize tablet reader: {e}', Colors.RED))
                    # Continue polling
            time.sleep(self.poll_ms / 1000.0)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Strummer WebSocket Server - broadcasts tablet and strum events via WebSocket',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '-c', '--config',
        dest='tablet_config',
        metavar='PATH',
        help='Tablet config file or directory (auto-detects device if directory or not specified)'
    )
    
    parser.add_argument(
        '-s', '--strummer-config',
        dest='strummer_config',
        metavar='PATH',
        help='Strummer/MIDI config file path'
    )
    
    parser.add_argument(
        '--ws-port',
        type=int,
        default=8081,
        help='WebSocket server port (default: 8081)'
    )

    parser.add_argument(
        '--http-port',
        type=int,
        help='HTTP server port for serving webapps (optional)'
    )
    
    parser.add_argument(
        '-t', '--throttle',
        type=int,
        default=150,
        metavar='MS',
        help='Event throttle interval in milliseconds (default: 150)'
    )
    
    parser.add_argument(
        '--poll',
        type=int,
        metavar='MS',
        help='Poll interval in milliseconds for waiting for device. If not set, quit if no device found.'
    )
    
    args = parser.parse_args()

    # Load strummer config early to get server settings (CLI args take precedence)
    strummer_config = None
    if args.strummer_config:
        strummer_config = MidiStrummerConfig.from_json_file(args.strummer_config)

    # Resolve effective server settings (CLI args take precedence over config file)
    effective_ws_port = args.ws_port if args.ws_port != 8081 else (
        strummer_config.ws_port if strummer_config and strummer_config.ws_port else 8081
    )
    effective_http_port = args.http_port or (
        strummer_config.http_port if strummer_config else None
    )
    effective_throttle = args.throttle if args.throttle != 150 else (
        strummer_config.ws_message_throttle if strummer_config else 150
    )
    effective_poll = args.poll or (
        strummer_config.device_finding_poll_interval if strummer_config else None
    )

    # Resolve tablet config path (returns tuple: config_path or None, search_dir)
    tablet_config_path, search_dir = resolve_config_path(args.tablet_config, poll_ms=effective_poll)

    print(colored('=== Strummer WebSocket Server ===', Colors.CYAN))
    if tablet_config_path:
        print(colored(f'Tablet config: {tablet_config_path}', Colors.GRAY))
    else:
        print(colored(f'Tablet config: (waiting for device)', Colors.YELLOW))
        print(colored(f'Search directory: {search_dir}', Colors.GRAY))
    if args.strummer_config:
        print(colored(f'Strummer config: {args.strummer_config}', Colors.GRAY))
    print(colored(f'WebSocket port: {effective_ws_port}', Colors.GRAY))
    if effective_http_port:
        print(colored(f'HTTP port: {effective_http_port}', Colors.GRAY))
    print(colored(f'Throttle: {effective_throttle}ms', Colors.GRAY))
    if effective_poll:
        print(colored(f'Poll interval: {effective_poll}ms', Colors.GRAY))
    print()

    # Create and run server
    server = StrummerWebSocketServer(
        tablet_config_path=tablet_config_path,
        strummer_config_path=args.strummer_config,
        ws_port=effective_ws_port,
        http_port=effective_http_port,
        throttle_ms=effective_throttle,
        poll_ms=effective_poll,
        search_dir=search_dir
    )

    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        print(colored('\nShutting down...', Colors.YELLOW))
    finally:
        if server._tablet_initialized:
            server.stop_sync()


if __name__ == '__main__':
    main()
