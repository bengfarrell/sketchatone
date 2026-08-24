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

from __future__ import annotations

import argparse
import asyncio
import errno
import json
import math
import re
import signal
import socket
import sys
import os
import time
import threading
import mimetypes
import ssl
import logging
import subprocess
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Set, Callable, Union
from urllib.parse import unquote


_PORT_NAME_SUFFIX_RE = re.compile(r'\s+\d+:\d+\s*$')


def _normalize_midi_port_name(name: str) -> str:
    """Normalize an ALSA/CoreMIDI port name for loopback comparison.

    ALSA emits ``"Client:Port NN:MM"`` (e.g. ``"Sketchatone:Sketchatone 128:0"``)
    for both our output and the corresponding input alias; stripping the
    trailing sequencer numeric suffix and lowercasing collapses the two
    onto the same key. Also catches the classic ``"Midi Through"``
    two-way port pair when routed to itself.
    """
    if not name:
        return ''
    stripped = _PORT_NAME_SUFFIX_RE.sub('', name)
    return re.sub(r'\s+', ' ', stripped).strip().lower()


def get_local_ip() -> Optional[str]:
    """Get the local network IP address (for LAN access)."""
    try:
        # Create a socket to determine the local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def generate_self_signed_cert(cert_file: str, key_file: str) -> bool:
    """
    Generate a self-signed SSL certificate for HTTPS support.
    Used for captive portal detection on Android 10+.

    Returns True if certificate was generated or already exists.
    """
    # Check if certificate already exists
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return True

    try:
        # Try to import cryptography for certificate generation
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        from datetime import datetime, timedelta
        import ipaddress

        # Generate private key
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )

        # Create certificate
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "CA"),
            x509.NameAttribute(NameOID.LOCALITY_NAME, "Local"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Sketchatone"),
            x509.NameAttribute(NameOID.COMMON_NAME, "sketchatone.local"),
        ])

        # Generate timestamps
        from datetime import timezone
        now = datetime.now(timezone.utc)

        cert = x509.CertificateBuilder().subject_name(
            subject
        ).issuer_name(
            issuer
        ).public_key(
            private_key.public_key()
        ).serial_number(
            x509.random_serial_number()
        ).not_valid_before(
            now
        ).not_valid_after(
            now + timedelta(days=3650)  # Valid for 10 years
        ).add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName("sketchatone.local"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            ]),
            critical=False,
        ).sign(private_key, hashes.SHA256())

        # Ensure directory exists
        cert_dir = os.path.dirname(cert_file)
        if cert_dir and not os.path.exists(cert_dir):
            os.makedirs(cert_dir, mode=0o755)

        # Write certificate
        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        # Write private key
        with open(key_file, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            ))

        # Set appropriate permissions (readable only by owner)
        os.chmod(key_file, 0o600)
        os.chmod(cert_file, 0o644)

        return True

    except ImportError:
        print("Warning: cryptography package not found. HTTPS will not be available.")
        print("Install with: pip install cryptography")
        return False
    except Exception as e:
        print(f"Warning: Failed to generate SSL certificate: {e}")
        return False


# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sketchatone import __version__ as SKETCHATONE_VERSION
from sketchatone.strummer.strummer import Strummer
from sketchatone.strummer.slider import Slider
from sketchatone.strummer.actions import Actions
from sketchatone.models.midi_strummer_config import MidiStrummerConfig
from sketchatone.models.note import Note, NoteObject
from sketchatone.strummer.midi_input_mapper import map_midi_input_to_strummer_notes
from sketchatone.midi.bridge import MidiStrummerBridge
from sketchatone.midi.protocol import MidiBackendProtocol
from sketchatone.midi.rtmidi_input import RtMidiInput, MidiInputNoteEvent
from sketchatone.midi.jack_input import JackMidiInput
from sketchatone.utils.keyboard_listener import KeyboardListener

from sketchatone.tablet.tablet_client import TabletClient, wait_for_device
from sketchatone.tablet.otd.config_loader import ConfigIndex
from sketchatone.tablet.server.event_adapter import TabletEvent
from sketchatone.cli._ansi import Colors, colored

# Import websockets
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:
    print("Error: websockets package not found.")
    print("Make sure websockets is installed: pip install websockets")
    sys.exit(1)

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
    # Auxiliary hardware buttons - raw HID scan codes currently held
    auxCodes: List[int] = field(default_factory=list)
    # Normalized keyboard characters currently held (source of `key:<char>` events)
    pressedKeys: List[str] = field(default_factory=list)


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

    Thread-safe: emit methods can be called from any thread,
    flush is called from the asyncio event loop.
    """

    def __init__(self, throttle_ms: int = 150):
        import threading
        self.throttle_ms = throttle_ms
        self._buffer: CombinedEventData = CombinedEventData()
        self._listeners: List[Callable[[CombinedEventData], None]] = []
        self._interval_task: Optional[asyncio.Task] = None
        self._paused = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._has_new_data = False  # Track if new data has arrived since last flush
        self._lock = threading.Lock()  # Thread safety for buffer access

    def set_throttle(self, throttle_ms: int) -> None:
        """Update the throttle interval"""
        self.throttle_ms = throttle_ms

    def emit_tablet_event(self, data: TabletEventData) -> None:
        """Add tablet event to buffer (overwrites previous)"""
        with self._lock:
            self._buffer.tablet = data
            self._has_new_data = True

    def emit_strum_event(self, data: StrumEventData) -> None:
        """Add strum event to buffer (preserved until flush)"""
        with self._lock:
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

    def flush(self) -> Optional[CombinedEventData]:
        """
        Flush the buffer and return data for emission. Only returns if new data arrived.
        Returns the buffer copy, or None if no data to emit.
        """
        if self._paused:
            return None

        # Atomically check and get buffer data
        with self._lock:
            if not self._has_new_data:
                return None

            # Copy the buffer data for emission
            buffer_copy = CombinedEventData(
                tablet=self._buffer.tablet,
                strum=self._buffer.strum
            )
            # Clear strum data after flush (tablet data persists)
            self._buffer.strum = None
            # Reset the new data flag
            self._has_new_data = False

        return buffer_copy

    async def _flush_loop(self) -> None:
        """Background task that flushes buffer at regular intervals"""
        while True:
            await asyncio.sleep(self.throttle_ms / 1000.0)

            # Get buffer data
            buffer_copy = self.flush()
            if buffer_copy is None:
                continue

            # Emit to listeners - collect any async tasks
            if buffer_copy.tablet is not None or buffer_copy.strum is not None:
                for listener in self._listeners:
                    try:
                        result = listener(buffer_copy)
                        # If listener returns a coroutine, await it
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        print(colored(f'Error in event listener: {e}', Colors.RED))

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


class _PerfBucket:
    """One named timing series: count, running total, max, and a bounded
    ring of recent samples for percentile calculation. Not thread-safe on
    its own; access is serialised by ``_PerfCollector._lock``."""

    __slots__ = ('name', 'count', 'total_ms', 'max_ms', 'samples')

    def __init__(self, name: str) -> None:
        self.name = name
        self.count = 0
        self.total_ms = 0.0
        self.max_ms = 0.0
        self.samples: List[float] = []

    def record(self, dur_ms: float) -> None:
        self.count += 1
        self.total_ms += dur_ms
        if dur_ms > self.max_ms:
            self.max_ms = dur_ms
        self.samples.append(dur_ms)
        if len(self.samples) > 512:
            del self.samples[:256]

    def snapshot_and_reset(self) -> Optional[tuple]:
        if self.count == 0:
            return None
        ordered = sorted(self.samples)
        n = len(ordered)
        p50 = ordered[n // 2]
        p95 = ordered[min(n - 1, int(n * 0.95))]
        result = (self.count, self.total_ms / self.count, p50, p95, self.max_ms)
        self.count = 0
        self.total_ms = 0.0
        self.max_ms = 0.0
        self.samples.clear()
        return result


class _PerfCollector:
    """Thread-safe bucketed timing recorder with periodic stdout summary.

    Enabled via ``SKETCHATONE_STRUM_PERF=1``. The hot path pays a lock +
    dict lookup per record. A daemon thread prints a per-interval summary
    so the log formatting never fires from an audio-critical thread.
    """

    def __init__(self, enabled: bool, interval_s: float = 2.0) -> None:
        self.enabled = enabled
        self.interval_s = interval_s
        self._buckets: Dict[str, _PerfBucket] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if not self.enabled or self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name='sketchatone-perf', daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def mark_now(self, name: str, start: float) -> None:
        """Record elapsed ms between ``start`` (from ``time.perf_counter()``)
        and now. No-op when disabled so call sites can be unconditional."""
        if not self.enabled:
            return
        dur_ms = (time.perf_counter() - start) * 1000.0
        with self._lock:
            bucket = self._buckets.get(name)
            if bucket is None:
                bucket = _PerfBucket(name)
                self._buckets[name] = bucket
            bucket.record(dur_ms)

    def record_ms(self, name: str, dur_ms: float) -> None:
        """Record a pre-computed duration in ms. Used when the caller
        already has a delta (e.g. GC pause between callback invocations)."""
        if not self.enabled:
            return
        with self._lock:
            bucket = self._buckets.get(name)
            if bucket is None:
                bucket = _PerfBucket(name)
                self._buckets[name] = bucket
            bucket.record(dur_ms)

    # Bucket edges for the gap histogram, in ms. Chosen to spotlight
    # the interesting range for a ~250Hz pen (nominal 4ms cadence): a
    # single stall of 20ms is a dropped strum, 50ms is audible, 100ms
    # is a clear hitch. Values above the last edge fall into ">200".
    _HIST_EDGES_MS = (4.0, 8.0, 16.0, 32.0, 50.0, 100.0, 200.0)
    _HIST_BUCKETS = ('gap', 'read_gap')

    def _histogram(self, samples: List[float]) -> str:
        edges = self._HIST_EDGES_MS
        counts = [0] * (len(edges) + 1)
        for s in samples:
            placed = False
            for i, edge in enumerate(edges):
                if s < edge:
                    counts[i] += 1
                    placed = True
                    break
            if not placed:
                counts[-1] += 1
        parts = []
        prev = 0.0
        for i, edge in enumerate(edges):
            parts.append(f'<{edge:g}:{counts[i]}')
            prev = edge
        parts.append(f'>={edges[-1]:g}:{counts[-1]}')
        return ' '.join(parts)

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            self._flush()

    def _flush(self) -> None:
        with self._lock:
            snapshots = []
            hist_samples: Dict[str, List[float]] = {}
            for name, bucket in self._buckets.items():
                # Grab a copy of the samples for the histogram BEFORE we
                # reset the bucket in snapshot_and_reset.
                if any(name.endswith(suffix) for suffix in self._HIST_BUCKETS):
                    hist_samples[name] = list(bucket.samples)
                snap = bucket.snapshot_and_reset()
                if snap is not None:
                    snapshots.append((name, snap))
        if not snapshots:
            return
        snapshots.sort(key=lambda t: t[1][4], reverse=True)
        lines = ['[PERF] ---- summary ----']
        for name, (count, avg, p50, p95, max_ms) in snapshots:
            lines.append(
                f'[PERF]   {name:<22} n={count:>4}  '
                f'avg={avg:6.2f}  p50={p50:6.2f}  '
                f'p95={p95:6.2f}  max={max_ms:6.2f}  ms'
            )
        for name, samples in hist_samples.items():
            if samples:
                lines.append(f'[PERF]   {name:<22} hist(ms): {self._histogram(samples)}')
        print('\n'.join(lines))


class StrummerWebSocketServer:
    """
    WebSocket server that broadcasts tablet and strum events.
    Uses TabletClient composition for HID device access.
    """

    def __init__(
        self,
        strummer_config_path: Optional[str] = None,
        ws_port: int = 8081,
        wss_port: Optional[int] = None,
        http_port: Optional[int] = None,
        https_port: Optional[int] = None,
        throttle_ms: int = 150,
        poll_ms: Optional[int] = None,
        dev_mode: bool = False,
        # MIDI options
        use_jack: Optional[bool] = None,
        midi_channel: Optional[int] = None,
        midi_port: Optional[Union[str, int]] = None,
        note_duration: Optional[float] = None,
        jack_client_name: Optional[str] = None,
        jack_auto_connect: Optional[str] = None
    ):
        self.ws_port = ws_port
        self.wss_port = wss_port
        self.http_port = http_port
        self.https_port = https_port
        self.poll_ms = poll_ms
        self.dev_mode = dev_mode

        # ---- Perf instrumentation ----------------------------------------
        # Initialised first so callbacks fired during the rest of __init__
        # (notably ``_setup_notes`` -> ``notes_changed`` -> ``broadcast_config``)
        # can dereference ``self._perf`` safely. Enabled via
        # ``SKETCHATONE_STRUM_PERF=1``; off by default so the hot per-sample
        # path stays branch-cheap in production. A daemon thread prints a
        # rolling summary every ``interval_s`` seconds so log formatting
        # never fires from the pen HID / audio-critical threads.
        _perf_enabled = os.environ.get('SKETCHATONE_STRUM_PERF') == '1'
        _perf_interval_ms = float(
            os.environ.get('SKETCHATONE_STRUM_PERF_INTERVAL_MS', '2000')
        )
        self._perf = _PerfCollector(_perf_enabled, _perf_interval_ms / 1000.0)
        # Wall-clock of the previous on_tablet_event call, used to compute
        # the inter-sample gap on the pen reader thread.
        self._perf_last_event_ts: float = 0.0
        # GC pause tracker: gc.callbacks fires ('start', ...) and ('stop', ...)
        # around every collection. Recording ``stop - start`` per generation
        # tells us whether Python's stop-the-world sweeps are the cause of
        # the multi-tens-of-ms gaps in the pen HID reader thread.
        self._perf_gc_start_ts: float = 0.0
        if _perf_enabled:
            import gc as _gc

            def _gc_perf_cb(phase: str, info: dict) -> None:
                if phase == 'start':
                    self._perf_gc_start_ts = time.perf_counter()
                elif phase == 'stop' and self._perf_gc_start_ts > 0.0:
                    dur_ms = (time.perf_counter() - self._perf_gc_start_ts) * 1000.0
                    gen = info.get('generation', -1)
                    self._perf.record_ms(f'gc.pause.gen{gen}', dur_ms)
                    self._perf_gc_start_ts = 0.0

            _gc.callbacks.append(_gc_perf_cb)
            print(colored(
                f'[PERF] Strum perf instrumentation on '
                f'(summary every {_perf_interval_ms:.0f}ms)',
                Colors.CYAN,
            ))
        self._perf.start()

        # ---- GC tuning ---------------------------------------------------
        # Python 3.9 defaults to (700, 10, 10); with steady WS broadcast +
        # tablet event allocations, gen-1/gen-2 sweeps fire often enough to
        # freeze every thread for 60-110 ms mid-strum, which was the audible
        # hitch. Two-part mitigation:
        #   1. Raise thresholds so higher generations rarely trigger on
        #      their own timing.
        #   2. Drive a cooperative idle-time collector (below) that runs
        #      ``gc.collect(0/1)`` only when there has been no strum activity
        #      for a short window, so any collection cost is absorbed while
        #      no MIDI is sounding.
        # Overridable via env for A/B testing:
        #   SKETCHATONE_GC_DISABLE=1     - turn auto GC off entirely
        #   SKETCHATONE_GC_THRESHOLDS=a,b,c - custom (gen0,gen1,gen2) thresholds
        #   SKETCHATONE_GC_IDLE_DISABLE=1 - skip the idle scheduler
        import gc as _gc
        self._gc = _gc
        # Wall-clock (perf_counter) of the last strum activity. The idle GC
        # scheduler uses this as the "safe to sweep" gate.
        self._last_strum_activity_ts: float = 0.0
        if os.environ.get('SKETCHATONE_GC_DISABLE') == '1':
            _gc.disable()
            print(colored('[PERF] gc.disable() - auto GC off', Colors.CYAN))
        else:
            _gc_thresholds = os.environ.get('SKETCHATONE_GC_THRESHOLDS', '10000,500,50')
            try:
                _t0s = tuple(int(x) for x in _gc_thresholds.split(','))
                if len(_t0s) == 3:
                    _gc.set_threshold(*_t0s)
                    if _perf_enabled:
                        print(colored(
                            f'[PERF] gc.set_threshold{_t0s}', Colors.CYAN,
                        ))
            except ValueError:
                print(colored(
                    f'[PERF] ignored SKETCHATONE_GC_THRESHOLDS={_gc_thresholds!r}',
                    Colors.YELLOW,
                ))
        # Idle GC scheduler thread. Wakes every ~150 ms; if no strum has
        # happened in the last ``idle_after_ms`` and no collection has run
        # recently, it kicks a gen-0 or (less often) gen-1 collect. This
        # keeps the young-generation working set small so the next scheduled
        # sweep during active play is cheap or unnecessary.
        self._gc_idle_stop = threading.Event()
        self._gc_idle_thread: Optional[threading.Thread] = None
        if os.environ.get('SKETCHATONE_GC_IDLE_DISABLE') != '1' \
                and os.environ.get('SKETCHATONE_GC_DISABLE') != '1':
            self._gc_idle_thread = threading.Thread(
                target=self._gc_idle_loop, name='sketchatone-gc-idle', daemon=True,
            )
            self._gc_idle_thread.start()
            if _perf_enabled:
                print(colored('[PERF] idle GC scheduler on', Colors.CYAN))

        # TabletClient composition (initialized when a device is discovered)
        self.tablet_client: Optional[TabletClient] = None

        # Determine public directory for HTTP server
        # Check environment variable first (for packaged apps), then fall back to relative path
        # __file__ is python/sketchatone/cli/server.py
        # Go up 4 levels to project root, then into dist/public
        self.public_dir = os.environ.get('SKETCHATONE_PUBLIC_DIR') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'dist', 'public'
        )
        self.clients: Set[WebSocketServerProtocol] = set()
        # Ephemeral (per-server-run) flag: when True, aux codes we haven't seen
        # before are auto-appended to device_buttons.buttons. Toggled by clients
        # via the 'set-button-detection' message; never persisted.
        self.detecting_device_buttons: bool = False
        self.server: Optional[websockets.WebSocketServer] = None
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None
        self._http_server = None
        self._https_server = None
        self._ws_server = None
        self._wss_server = None

        # SSL certificate paths (for HTTPS)
        # Store in user's home directory or /opt/sketchatone for system installs
        if os.path.exists('/opt/sketchatone'):
            ssl_dir = '/opt/sketchatone/ssl'
        else:
            ssl_dir = os.path.expanduser('~/.sketchatone/ssl')
        self.ssl_cert_file = os.path.join(ssl_dir, 'cert.pem')
        self.ssl_key_file = os.path.join(ssl_dir, 'key.pem')

        # Create event bus
        self.event_bus = StrummerEventBus(throttle_ms)

        # Store the config path for saving later
        self.strummer_config_path = strummer_config_path

        # Extract config directory and filename
        if strummer_config_path:
            self.strummer_config_dir = os.path.dirname(os.path.abspath(strummer_config_path))
            self.current_config_name = os.path.basename(strummer_config_path)
        else:
            # Set default config directory when no config file specified
            self.strummer_config_dir = os.path.join(self.public_dir, 'configs')
            # Try to load default.json if it exists
            default_config_path = os.path.join(self.strummer_config_dir, 'default.json')
            if os.path.exists(default_config_path):
                self.strummer_config_path = default_config_path
                self.current_config_name = 'default.json'
            else:
                self.current_config_name = None

        # Load config
        if self.strummer_config_path:
            self.config = MidiStrummerConfig.from_json_file(self.strummer_config_path)
        else:
            self.config = MidiStrummerConfig()

        # Apply CLI overrides for MIDI settings
        if use_jack is not None:
            self.config.midi.midi_output_backend = "jack" if use_jack else "rtmidi"
        if midi_channel is not None:
            self.config.strummer.strumming.midi_channel = midi_channel
        if midi_port is not None:
            self.config.midi.midi_output_id = midi_port
        if note_duration is not None:
            self.config.midi.default_note_duration = note_duration
        if jack_client_name is not None:
            self.config.midi.jack_client_name = jack_client_name
        if jack_auto_connect is not None:
            self.config.midi.jack_auto_connect = jack_auto_connect

        # Create strummer
        self.strummer = Strummer()
        self.strummer.configure(self.config.pressure_threshold, self.config.strummer.strumming.pressure_buffer_size)

        # Create slider (trombone-style controller); notes are kept in sync with the strummer
        self.slider = Slider()
        self.slider.configure(
            self.config.strummer.slide.pressure_threshold,
            self.config.strummer.slide.max_bend_semitones
        )

        # Slide state: currently held note + channel (for routing slide_update/slide_off MIDI)
        self.slide_active_note: Optional[NoteObject] = None
        self.slide_active_channel: Optional[int] = None
        # Last modulation value sent (aftertouch / CC) for dedup; reset on slide_off
        self.last_slide_modulation_value: Optional[int] = None

        # Listen for notes_changed events to broadcast config updates
        # Store the callback as an instance method to prevent garbage collection
        self.strummer.on('notes_changed', self._on_strummer_notes_changed)

        # Set up notes
        self._setup_notes()

        # MIDI backend and bridge
        self.backend: Optional[MidiBackendProtocol] = None
        self.bridge: Optional[MidiStrummerBridge] = None
        self.notes_played = 0

        # MIDI input (for external keyboards)
        # Uses JackMidiInput when JACK backend is active, otherwise RtMidiInput
        self.midi_input: Optional[Union[RtMidiInput, JackMidiInput]] = None
        self._midi_input_debounce_timer: Optional[threading.Timer] = None

        # Running state - set to True when tablet reader starts
        self.is_running = False

        # Create Actions handler for stylus buttons
        # Pass the actual config object so Actions can access live values
        # (e.g., lower_spread/upper_spread that may be updated via UI)
        self.actions = Actions(
            config=self.config,
            strummer=self.strummer,
            chord_progressions=self.config.strummer.chord_progressions
        )

        # Configure action rules so button-to-action mapping works
        self.actions.set_action_rules_config(self.config.strummer.action_rules)

        # Listen for action events to broadcast to clients
        self.actions.on('action_executed', self._broadcast_action_event)

        # Execute any startup rules defined in the config
        self.actions.execute_startup_rules()

        # Initialize keyboard listener if enabled. Emits raw key names; the server
        # gates learning through `detecting_device_buttons` and dispatches actions
        # as `key:<char>` button events. Known tablet VID/PIDs are handed to the
        # listener so it can skip Linux evdev keyboard interfaces that actually
        # belong to a tablet - those express keys arrive through the tablet's
        # hidraw aux path (as `code:<int>`), keeping IDs identical to macOS.
        self.keyboard_button_states: Dict[str, bool] = {}
        self.keyboard_listener: Optional[KeyboardListener] = None
        if self.config.keyboard.enabled:
            try:
                tablet_vid_pids = set(ConfigIndex.from_vendored().all_vid_pid_pairs())
            except Exception as e:
                print(colored(f'⚠ Failed to load tablet VID/PID index: {e}', Colors.YELLOW))
                tablet_vid_pids = set()
            self.keyboard_listener = KeyboardListener(
                enabled=self.config.keyboard.enabled,
                on_key_press=self._handle_keyboard_key_press,
                on_key_release=self._handle_keyboard_key_release,
                tablet_vid_pids=tablet_vid_pids,
            )

        # State tracking for stylus buttons
        self.button_state = {
            'primaryButtonPressed': False,
            'secondaryButtonPressed': False,
        }

        # State tracking for auxiliary hardware buttons - previous HID scan codes
        self.prev_aux_codes: Set[int] = set()

        # State tracking for note repeater
        self.repeater_state = {
            'notes': [],
            'last_repeat_time': 0.0,
            'is_holding': False,
        }

        # State tracking for strum release feature
        self.strum_start_time: float = 0.0

        # Register event bus listener
        self.event_bus.on_combined_event(self._broadcast_combined_event)

        # One-shot startup sweep: after all imports, config loading, and
        # wiring, a lot of transient objects have been promoted to gen-2.
        # Draining them now (while still on the main thread, before the
        # tablet reader starts) means the first idle sweep the scheduler
        # runs isn't the 200-300 ms catch-up sweep we observed.
        if os.environ.get('SKETCHATONE_GC_DISABLE') != '1':
            try:
                self._gc.collect(2)
            except Exception:
                pass

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
        self.slider.notes = notes

    def _get_control_value(self, control: str, events: Dict[str, Any]) -> Optional[float]:
        """
        Get the control input value based on the control type.

        Args:
            control: Control source type ("pressure", "tiltX", "tiltY", "tiltXY", "xaxis", "yaxis", "velocity", "none")
            events: Dictionary of event values from the tablet

        Returns:
            Normalized control value (0.0 to 1.0), or None if control is "none"
        """
        if control == "none":
            return None
        elif control == "pressure":
            return float(events.get('pressure', 0))
        elif control == "tiltX":
            # tiltX is -1 to 1, normalize to 0-1
            return (float(events.get('tiltX', 0)) + 1.0) / 2.0
        elif control == "tiltY":
            # tiltY is -1 to 1, normalize to 0-1
            return (float(events.get('tiltY', 0)) + 1.0) / 2.0
        elif control == "tiltXY":
            # tiltXY is -1 to 1, normalize to 0-1
            return (float(events.get('tiltXY', 0)) + 1.0) / 2.0
        elif control == "xaxis":
            return float(events.get('x', 0.5))
        elif control == "yaxis":
            return float(events.get('y', 0.5))
        elif control == "velocity":
            # Use pressure velocity if available
            return float(events.get('pressureVelocity', events.get('pressure', 0)))
        else:
            return None

    def _setup_midi(self) -> bool:
        """Initialize MIDI backend and bridge"""
        try:
            # Get inter-message delay with backward compatibility
            delay = getattr(self.config.midi, 'midi_inter_message_delay', None)
            if delay is None:
                # Backward compatibility: check old name
                delay = getattr(self.config.midi, 'rtmidi_inter_message_delay', 0.0)
            delay = delay or 0.0

            if self.config.midi_output_backend == "jack":
                from sketchatone.midi.jack_backend import JackMidiBackend
                self.backend = JackMidiBackend(
                    channel=self.config.channel,
                    client_name=self.config.jack_client_name,
                    auto_connect=self.config.jack_auto_connect,
                    inter_message_delay=delay
                )
            else:
                from sketchatone.midi.rtmidi_backend import RtMidiBackend
                self.backend = RtMidiBackend(
                    channel=self.config.channel,
                    inter_message_delay=delay,
                )

            # Connect backend
            port = self.config.midi_output_id
            if not self.backend.connect(port):
                print(colored('Failed to connect MIDI backend', Colors.RED))
                return False

            # Create bridge
            self.bridge = MidiStrummerBridge(
                self.strummer,
                self.backend,
                note_duration=self.config.note_duration,
                auto_connect=False  # We'll handle events manually
            )

            return True

        except ImportError as e:
            print(colored(f'MIDI backend not available: {e}', Colors.RED))
            return False

    def _print_midi_config(self) -> None:
        """Print MIDI configuration info"""
        print(colored('MIDI Config:', Colors.WHITE, bold=True))
        print(colored('  Backend: ', Colors.CYAN) +
              colored(self.config.midi_output_backend, Colors.WHITE))
        # Display channel as 1-16 for users (internally stored as 0-15)
        channel_display = str(self.config.channel + 1) if self.config.channel is not None else '1 (default)'
        print(colored('  Channel: ', Colors.CYAN) +
              colored(channel_display, Colors.WHITE))
        if self.config.midi_output_id is not None:
            print(colored('  Output Port: ', Colors.CYAN) +
                  colored(str(self.config.midi_output_id), Colors.WHITE))
        print(colored('  Note Duration: ', Colors.CYAN) +
              colored(f'{self.config.note_duration}s', Colors.WHITE))
        if self.config.midi_output_backend == "jack":
            print(colored('  JACK Client: ', Colors.CYAN) +
                  colored(self.config.jack_client_name, Colors.WHITE))
            if self.config.jack_auto_connect:
                print(colored('  JACK Auto-connect: ', Colors.CYAN) +
                      colored(self.config.jack_auto_connect, Colors.WHITE))

    def _register_midi_input_callback(self) -> None:
        """Register the MIDI input note callback. Can be called multiple times to re-register after reconnection."""
        if not self.midi_input:
            return

        # Listen for note events with debounce logic
        def on_midi_note(event: MidiInputNoteEvent) -> None:
            # Broadcast MIDI input event to all clients (for UI display)
            self._broadcast_midi_input(event)

            # Clear any pending debounce timer
            if self._midi_input_debounce_timer:
                self._midi_input_debounce_timer.cancel()
                self._midi_input_debounce_timer = None

            if event.get('added'):
                # Note was added - update immediately
                self._update_notes_from_midi_input(event['notes'])
            elif event.get('removed'):
                # Note was removed - debounce to handle rapid releases
                def debounced_update():
                    self._midi_input_debounce_timer = None
                    # Only update if there are still notes held
                    # If all notes released, keep the last chord
                    if self.midi_input and len(self.midi_input.notes) > 0:
                        self._update_notes_from_midi_input(self.midi_input.notes)

                self._midi_input_debounce_timer = threading.Timer(0.1, debounced_update)
                self._midi_input_debounce_timer.daemon = True
                self._midi_input_debounce_timer.start()

        self.midi_input.on_note(on_midi_note)
        print(colored('[MIDI Input] Callback registered', Colors.GRAY))

    def _setup_midi_input(self) -> bool:
        """
        Initialize MIDI input for external keyboard.
        Supports multiple connection modes:
        - Array of port IDs: Connect to specific selected ports
        - Empty array: No connection (user has disabled all inputs)
        - None (legacy): Connect to all available ports with exclusions
        - Single value (legacy): Connect to specific port

        Uses JackMidiInput when JACK backend is active, otherwise RtMidiInput.
        """
        try:
            # Use JACK MIDI input when JACK backend is active
            if self.config.midi_output_backend == "jack":
                self.midi_input = JackMidiInput()
                print(colored('[MIDI Input] Using JACK MIDI input', Colors.GRAY))
            else:
                self.midi_input = RtMidiInput()
                print(colored('[MIDI Input] Using RtMidi (ALSA) input', Colors.GRAY))

            input_port = self.config.midi.midi_input_id

            connected = False

            if isinstance(input_port, list):
                # Array of port IDs - connect to multiple specific ports
                if len(input_port) == 0:
                    # Empty array = user explicitly disabled all inputs
                    print(colored('[MIDI Input] No ports selected - staying disconnected', Colors.YELLOW))
                    connected = False
                else:
                    # Connect to selected ports
                    print(colored(f'[MIDI Input] Connecting to selected ports: {input_port}', Colors.CYAN))
                    exclude_ports = list(self.config.midi.midi_input_exclude)
                    connected = self.midi_input.connect_multiple(input_port, exclude_ports=exclude_ports)
            elif input_port is None or input_port == '':
                # Legacy: Auto-connect to all MIDI sources, excluding ports that could cause feedback
                exclude_ports: List[str] = list(self.config.midi.midi_input_exclude)
                print(colored(f'[MIDI Input] Connecting to all ports, excluding: {", ".join(exclude_ports)}', Colors.GRAY))
                connected = self.midi_input.connect_all(exclude_ports=exclude_ports)
            else:
                # Legacy: Single port mode - restore from saved config
                print(colored(f'[MIDI Input] Restoring saved port: {input_port}', Colors.CYAN))
                connected = self.midi_input.connect(input_port)

            if not connected:
                print(colored('[MIDI Input] No MIDI input ports connected', Colors.YELLOW))
                return False

            # Register note event callback
            self._register_midi_input_callback()

            # Register passthrough callback
            self._register_midi_passthrough()

            return True

        except Exception as e:
            print(colored(f'MIDI input not available: {e}', Colors.RED))
            return False

    def _register_midi_passthrough(self) -> None:
        """
        Register MIDI passthrough callback to forward MIDI from inputs to outputs.
        """
        if not self.midi_input or not self.backend:
            return

        # Only RtMidiInput supports passthrough callback currently
        if not hasattr(self.midi_input, 'set_passthrough_callback'):
            return

        # Get passthrough connections from config
        passthrough_connections = self.config.midi.midi_passthrough

        if not passthrough_connections:
            # No passthrough configured
            self.midi_input.set_passthrough_callback(None)
            return

        print(colored(f'[MIDI Passthrough] Configuring {len(passthrough_connections)} connection(s)', Colors.CYAN))

        # Create a passthrough callback that forwards MIDI messages
        def passthrough_callback(message: List[int], port_id: int, port_name: str) -> None:
            """Forward MIDI message from input to output if configured"""
            # Check if this input port has any passthrough connections
            for connection in passthrough_connections:
                input_port = connection.get('inputPort')

                # Match by port ID or name
                if input_port == port_id or input_port == port_name:
                    # Forward the MIDI message to the output backend
                    try:
                        if self.backend and self.backend.is_connected:
                            # Send raw MIDI message through the backend
                            # Support both RtMidi and JACK backends
                            if hasattr(self.backend, '_send'):
                                # RtMidi backend - has _send() method
                                with self.backend._send_lock:
                                    self.backend._send(message)
                            elif hasattr(self.backend, '_queue_midi_event'):
                                # JACK backend - uses _queue_midi_event()
                                with self.backend._send_lock:
                                    self.backend._queue_midi_event(bytes(message))
                            else:
                                print(colored('[MIDI Passthrough] Warning: Backend does not support raw MIDI send', Colors.YELLOW))
                    except Exception as e:
                        print(colored(f'[MIDI Passthrough] Error forwarding message: {e}', Colors.RED))

        self.midi_input.set_passthrough_callback(passthrough_callback)
        print(colored('[MIDI Passthrough] Callback registered', Colors.GRAY))

    def _broadcast_midi_input(self, event: MidiInputNoteEvent) -> None:
        """Broadcast MIDI input event to all connected clients"""
        if not self.clients:
            return

        # Get ALL available ports (not just connected ones) for user selection
        available_ports = self.midi_input.get_available_ports() if self.midi_input else []

        # Get currently connected port name
        connected_port = None
        if self.midi_input and self.midi_input.connected_ports:
            connected_port = self.midi_input.connected_ports[0]['name']

        midi_input_message = {
            'type': 'midi-input',
            'notes': event.get('notes', []),
            'added': event.get('added'),
            'removed': event.get('removed'),
            'portName': event.get('port_name'),
            'availablePorts': [
                {'id': p['id'], 'name': p['name']}
                for p in available_ports
            ],
            'connectedPort': connected_port,
        }

        self._broadcast(json.dumps(midi_input_message))



    async def _send_midi_input_status(self, websocket: WebSocketServerProtocol) -> None:
        """Send MIDI input status to a specific client"""
        if not self.midi_input:
            return

        # Get ALL available ports (not just connected ones) for user selection
        available_ports = self.midi_input.get_available_ports()

        # Get currently connected port name
        connected_port = None
        if self.midi_input.connected_ports:
            connected_port = self.midi_input.connected_ports[0]['name']

        midi_input_message = {
            'type': 'midi-input-status',
            'connected': self.midi_input.is_connected,
            'availablePorts': [
                {'id': p['id'], 'name': p['name']}
                for p in available_ports
            ],
            'connectedPort': connected_port,
            'currentNotes': self.midi_input.notes,
        }

        await websocket.send(json.dumps(midi_input_message))

    def _update_notes_from_midi_input(self, note_strings: List[str]) -> None:
        """
        Update strummer notes from MIDI input.

        Routes the held MIDI notes through the configured ``midi.input_mode``
        mapper (direct / majorScale / minorScale / autoScale) and assigns the
        resulting base notes as the strummer's initial_notes. ``_setup_notes()``
        then applies the upper/lower note spread on top.
        """
        if not note_strings:
            return

        midi_notes = [Note.parse_notation(s) for s in note_strings]
        mode = self.config.midi.input_mode
        base_notes = map_midi_input_to_strummer_notes(midi_notes, mode)
        if not base_notes:
            return

        base_note_strings = [f'{n.notation}{n.octave}' for n in base_notes]

        # Update the config's initial_notes
        self.config.strummer.strumming.initial_notes = base_note_strings

        # Clear the chord so that initial_notes are used instead
        self.config.strummer.strumming.chord = None

        # Reconfigure strummer with new notes
        self._setup_notes()

        # Broadcast config change to all connected clients
        self.broadcast_config()

        print(colored(
            f'[MIDI Input {mode}] Held: {", ".join(note_strings)} -> Notes: {", ".join(base_note_strings)}',
            Colors.CYAN,
        ))

    async def _handle_http_request(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming HTTP request for static file serving"""
        peername = None
        try:
            # Get peer info for debugging
            peername = writer.get_extra_info('peername')
            sockname = writer.get_extra_info('sockname')  # Local socket (IP, port)
            ssl_object = writer.get_extra_info('ssl_object')
            is_ssl = ssl_object is not None
            local_port = sockname[1] if sockname else 'unknown'
            print(f"[HTTP{'S' if is_ssl else ''}] Connection from {peername} to port {local_port}, SSL={is_ssl}")

            # Python 3.13 workaround: If SSL is expected but ssl_object is None, there might be an SSL issue
            if local_port == 443 and not is_ssl:
                print(f"[WARNING] Connection to HTTPS port {local_port} but SSL not established!")
                writer.close()
                await writer.wait_closed()
                return

            # Read request line
            request_line = await reader.readline()
            if not request_line:
                print(f"[HTTP{'S' if is_ssl else ''}] Empty request from {peername}")
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

            # Captive portal detection - respond to connectivity checks
            # This prevents phones from using mobile data when connected to the hotspot
            # Common endpoints used by Android, iOS, and other devices
            url_path = path.split('?')[0]  # Remove query string for checking
            if url_path in ('/generate_204', '/gen_204', '/connecttest.txt', '/success.txt'):
                writer.write(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                await writer.drain()
                writer.close()
                return

            # Only handle GET requests
            if method != 'GET':
                response = b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n'
                writer.write(response)
                await writer.drain()
                return

            # Parse path (already done above for captive portal check)
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

    async def _broadcast_combined_event(self, data: CombinedEventData) -> None:
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
            # Auxiliary hardware buttons - raw HID scan codes currently held
            message['auxCodes'] = list(data.tablet.auxCodes)
            if data.tablet.pressedKeys:
                message['pressedKeys'] = list(data.tablet.pressedKeys)

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

        # Broadcast to all clients - await to provide backpressure
        await self._broadcast_to_all_clients(json.dumps(message))
    
    def _broadcast(self, message: str) -> None:
        """Broadcast message to all connected clients"""
        if not self.clients or self._main_loop is None:
            return

        # Check if we're already in the event loop
        try:
            running_loop = asyncio.get_running_loop()
            in_event_loop = running_loop is self._main_loop
        except RuntimeError:
            in_event_loop = False

        if in_event_loop:
            # Already in the event loop, create a single task for all clients
            asyncio.create_task(self._broadcast_to_all_clients(message))
        else:
            # Called from another thread, use run_coroutine_threadsafe
            asyncio.run_coroutine_threadsafe(
                self._broadcast_to_all_clients(message),
                self._main_loop
            )

    async def _broadcast_to_all_clients(self, message: str) -> None:
        """Broadcast message to all clients with proper error handling"""
        if not self.clients:
            return

        # Send to all clients concurrently but wait for completion
        # This provides backpressure - we won't schedule more broadcasts
        # until the current one completes
        clients_to_remove = []

        async def send_with_timeout(client: WebSocketServerProtocol) -> None:
            try:
                await asyncio.wait_for(client.send(message), timeout=1.0)
            except asyncio.TimeoutError:
                clients_to_remove.append(client)
            except websockets.exceptions.ConnectionClosed:
                clients_to_remove.append(client)
            except Exception:
                clients_to_remove.append(client)

        # Send to all clients concurrently
        await asyncio.gather(
            *[send_with_timeout(client) for client in list(self.clients)],
            return_exceptions=True
        )

        # Remove failed clients
        for client in clients_to_remove:
            self.clients.discard(client)

    def _resolve_device_name(self, device_name: Optional[str] = None) -> Optional[str]:
        """Best-effort tablet name, falling back to the attached client's name."""
        if device_name:
            return device_name
        if self.tablet_client is not None:
            return self.tablet_client.capabilities.name
        return None

    def broadcast_status(self, connected: bool, device_name: Optional[str] = None) -> None:
        """Broadcast device status to all clients"""
        import time
        device_name = self._resolve_device_name(device_name)
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
    
    def _list_configs(self) -> List[str]:
        """
        List all available config files in the config directory.
        Only returns .json files that are not in subdirectories.
        """
        if not self.strummer_config_dir:
            return []

        try:
            files = os.listdir(self.strummer_config_dir)
            return [
                f for f in files
                if f.endswith('.json') and os.path.isfile(os.path.join(self.strummer_config_dir, f))
            ]
        except Exception as e:
            print(colored(f'[List Configs] Failed to list configs: {e}', Colors.RED))
            return []

    def _get_config_data(self, is_saved_state: bool = True) -> Dict[str, Any]:
        """Get config data in the format expected by the webapp"""
        # Get device capabilities from the attached TabletClient if available
        device_capabilities = None
        if self.tablet_client is not None:
            caps = self.tablet_client.capabilities
            device_capabilities = {
                'name': caps.name,
                'manufacturer': caps.manufacturer,
                'model': caps.model,
                'maxX': caps.max_x,
                'maxY': caps.max_y,
                'maxPressure': caps.max_pressure,
                'penButtonCount': caps.pen_button_count,
                'auxButtonCount': caps.aux_button_count,
            }

        return {
            'throttleMs': self.event_bus.throttle_ms,
            'notes': [
                {'notation': n.notation, 'octave': n.octave}
                for n in self.strummer.notes
            ],
            'config': self.config.to_dict(),
            'serverVersion': SKETCHATONE_VERSION,
            'deviceCapabilities': device_capabilities,
            'currentConfigName': self.current_config_name,
            'availableConfigs': self._list_configs(),
            'isSavedState': is_saved_state,
        }

    def _on_strummer_notes_changed(self) -> None:
        """
        Callback for when strummer notes change.
        Broadcasts config update to all clients.
        """
        _t0 = time.perf_counter()
        # Chord change implies the user is about to strum: block the idle
        # GC scheduler from firing a sweep in the next ~120 ms window, so
        # we don't collide with the strum that follows the chord button.
        self._last_strum_activity_ts = _t0
        self.broadcast_config()
        self._perf.mark_now('notes_changed.cb', _t0)

    def broadcast_config(self, is_saved_state: bool = False) -> None:
        """
        Broadcast current config to all clients.

        Args:
            is_saved_state: True when config represents the saved state (after load/save),
                           False for updates (default)
        """
        _t0 = time.perf_counter()
        message = {
            'type': 'config',
            'data': self._get_config_data(is_saved_state)
        }
        self._broadcast(json.dumps(message))
        self._perf.mark_now('broadcast.config', _t0)

    def _gc_idle_loop(self) -> None:
        """Cooperative garbage collector. Runs a gen-0 (and occasionally
        gen-1) sweep only when the user has been idle for a short window,
        so the stop-the-world pause is inaudible. Rationale: the default
        auto-GC picks its collection moment based on allocation count, and
        will happily fire mid-strum when the young generation happens to
        cross a threshold - producing a 50-100 ms GIL freeze that starves
        the pen HID reader. By eagerly draining gen-0/gen-1 during silence,
        we keep the working set small enough that the next auto-triggered
        sweep during play is cheap (or unnecessary).

        Thread-safety: reads ``_last_strum_activity_ts`` without a lock. On
        CPython, single float attribute reads/writes are atomic under the
        GIL, and a torn/stale value here just means we skip a sweep for
        one tick - which is harmless.
        """
        # Tunables kept simple; measured defaults chosen for a ~4ms pen
        # cadence where anything above ~15 ms is audible. Two separate
        # idle thresholds because gen-0 is always cheap (< 5 ms) but
        # gen-1 can be expensive (100-300 ms). A short brain-pause
        # between strums (~300 ms) should never trigger gen-1: if it
        # overruns and the user resumes play, the pen reader is frozen
        # for the tail of the sweep and the first stroke hitches.
        gen0_idle_ms = 120.0      # pen quiet this long -> safe for gen-0
        gen1_idle_ms = 750.0      # gen-1 only after the user is really done
        tick_ms = 100.0           # scheduler wake interval
        # Only escalate to gen-1 after this many consecutive gen-0
        # sweeps at gen1-idle. Prevents back-to-back gen-1 sweeps and
        # gives auto-GC's own threshold a chance to fire cheaply first.
        gen1_every_n_gen0 = 5
        gen0_count = 0
        gc = self._gc
        while not self._gc_idle_stop.wait(tick_ms / 1000.0):
            now = time.perf_counter()
            last = self._last_strum_activity_ts
            idle_ms = (now - last) * 1000.0 if last != 0.0 else float('inf')
            if idle_ms < gen0_idle_ms:
                # User is active or just paused briefly - do nothing.
                gen0_count = 0
                continue
            _t = now
            if idle_ms >= gen1_idle_ms and gen0_count >= gen1_every_n_gen0:
                gc.collect(1)
                gen0_count = 0
                self._perf.mark_now('gc.idle_sweep_gen1', _t)
            else:
                gc.collect(0)
                gen0_count += 1
                self._perf.mark_now('gc.idle_sweep_gen0', _t)

    def _broadcast_action_event(self, event: Dict[str, Any]) -> None:
        """
        Broadcast action executed event to all connected clients.
        Used for UI feedback (e.g., status dots on action rules).

        Args:
            event: Action event data containing action, params, button, trigger,
                   timestamp, rule_id, and is_startup
        """
        # Convert Python snake_case to JavaScript camelCase for the WebSocket message
        message = {
            'type': 'action-event',
            'action': event.get('action'),
            'params': event.get('params', []),
            'button': event.get('button'),
            'trigger': event.get('trigger'),
            'timestamp': event.get('timestamp'),
            'ruleId': event.get('rule_id'),
            'isStartup': event.get('is_startup', False),
        }
        self._broadcast(json.dumps(message))

    def _handle_keyboard_key_press(self, key: str) -> None:
        """
        Handle a raw keyboard press: learn the key when detection is on,
        update state, dispatch a ``key:<char>`` action, and emit a synthetic
        tablet event so the UI can show pressed-key indicators.

        Drops OS auto-repeat: if the key is already marked pressed, the
        event is a repeat from the OS's typematic timer (~30 Hz on macOS,
        higher on Linux). Every repeat would re-fire the action rule,
        allocate a new chord, and schedule broadcasts - all on the
        keyboard listener thread, which starves the pen HID reader on
        the same interpreter and shows up as strums that pause and then
        flush in a burst. Mirrors the aux-HID button semantics (which
        don't auto-repeat) so a held key means "press once".
        """
        _t_all = time.perf_counter()
        # Chord-change keys imply the user is about to strum: gate the
        # idle GC scheduler even before the auto-repeat check, so a held
        # key still blocks sweeps in the "about to strum" window.
        self._last_strum_activity_ts = _t_all
        self._maybe_learn_device_key(key)
        button_id = f'key:{key}'
        if self.keyboard_button_states.get(button_id):
            return
        self.keyboard_button_states[button_id] = True
        _t = time.perf_counter()
        self.actions.handle_button_event(button_id, 'press')
        self._perf.mark_now('kbd.press.action', _t)
        _t = time.perf_counter()
        self._emit_keyboard_tablet_event()
        self._perf.mark_now('kbd.press.emit', _t)
        self._perf.mark_now('kbd.press.total', _t_all)

    def _handle_keyboard_key_release(self, key: str) -> None:
        _t_all = time.perf_counter()
        button_id = f'key:{key}'
        self.keyboard_button_states[button_id] = False
        _t = time.perf_counter()
        self.actions.handle_button_event(button_id, 'release')
        self._perf.mark_now('kbd.release.action', _t)
        _t = time.perf_counter()
        self._emit_keyboard_tablet_event()
        self._perf.mark_now('kbd.release.emit', _t)
        self._perf.mark_now('kbd.release.total', _t_all)

    def _emit_keyboard_tablet_event(self) -> None:
        """
        Emit a synthetic tablet event carrying currently-held keyboard keys as
        ``pressedKeys`` so the dashboard can highlight them alongside auxCodes.
        """
        pressed_keys: List[str] = []
        for button_id, is_pressed in self.keyboard_button_states.items():
            if is_pressed and button_id.startswith('key:'):
                pressed_keys.append(button_id.split(':', 1)[1])

        tablet_data = TabletEventData(
            x=0.5,
            y=0.5,
            pressure=0.0,
            tiltX=0.0,
            tiltY=0.0,
            tiltXY=0.0,
            primaryButtonPressed=False,
            secondaryButtonPressed=False,
            state='out-of-range',
            auxCodes=[],
            pressedKeys=pressed_keys,
        )

        self.event_bus.emit_tablet_event(tablet_data)

    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a WebSocket client connection"""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(colored(f'Client connected: {client_addr}', Colors.GREEN))
        
        # Resume event bus when first client connects
        if len(self.clients) == 1:
            self.event_bus.resume()
        
        # Send initial config (is_saved_state=True since this is the saved state on connection)
        await websocket.send(json.dumps({
            'type': 'config',
            'data': self._get_config_data(is_saved_state=True)
        }))
        
        # Send initial status (matching Node.js format)
        import time
        device_name = self._resolve_device_name()
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

        # Send MIDI input status to new client
        await self._send_midi_input_status(websocket)

        # Send current button-detection state so the UI reflects the shared
        # per-server flag on reconnect / new tab.
        await websocket.send(json.dumps({
            'type': 'button-detection-state',
            'enabled': self.detecting_device_buttons,
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

            elif msg_type == 'set-button-detection':
                enabled = bool(data.get('enabled', False))
                self.detecting_device_buttons = enabled
                print(colored(
                    f'[Device Buttons] Detection {"started" if enabled else "stopped"}',
                    Colors.CYAN,
                ))
                self._broadcast_button_detection_state()

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
                    self._persist_config_to_file()
                # Every update is auto-persisted above, so the broadcast
                # can report the saved state directly.
                self.broadcast_config(is_saved_state=True)

            elif msg_type == 'save-config':
                # Save the current configuration to the config file
                self._handle_save_config()

            elif msg_type == 'load-config':
                # Load a different config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_load_config(config_name)

            elif msg_type == 'create-config':
                # Create a new config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_create_config(config_name)

            elif msg_type == 'rename-config':
                # Rename a config file
                old_name = data.get('oldName')
                new_name = data.get('newName')
                if old_name and new_name:
                    self._handle_rename_config(old_name, new_name)

            elif msg_type == 'upload-config':
                # Upload/import a config file
                config_name = data.get('configName')
                config_data = data.get('configData')
                if config_name and config_data:
                    self._handle_upload_config(config_name, config_data)

            elif msg_type == 'delete-config':
                # Delete a config file
                config_name = data.get('configName')
                if config_name:
                    self._handle_delete_config(config_name)

            elif msg_type == 'get-midi-devices':
                # Get available MIDI devices
                await self._handle_get_midi_devices(websocket)

            elif msg_type == 'restart-service':
                # Restart the systemd service
                await self._handle_restart_service(websocket)

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
        self.strummer.configure(self.config.pressure_threshold, self.config.strummer.strumming.pressure_buffer_size)
        self.slider.configure(self.config.strummer.slide.pressure_threshold, self.config.strummer.slide.max_bend_semitones)
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
            # Capture old mode so we can detect a strum <-> slide transition
            previous_mode = self.config.strummer.mode

            # Set the config value using the path
            self._set_config_value(path, value)

            # Mode change: release any held notes and reset both controllers
            if path == 'strummer.mode' and self.config.strummer.mode != previous_mode:
                self._clear_controller_state()

            # Re-apply strummer settings if relevant
            if path.startswith('strummer.strumming.'):
                self.strummer.configure(self.config.pressure_threshold, self.config.strummer.strumming.pressure_buffer_size)

            # Re-apply slider settings if relevant
            if path.startswith('strummer.slide.'):
                self.slider.configure(self.config.strummer.slide.pressure_threshold, self.config.strummer.slide.max_bend_semitones)

            # Re-setup notes if chord or note spread changed
            if 'chord' in path.lower() or 'spread' in path.lower() or 'initialNotes' in path:
                self._setup_notes()

            # Update chord progressions in Actions if they changed
            if path == 'strummer.chordProgressions':
                self.actions.set_chord_progressions(self.config.strummer.chord_progressions)

            # Update action rules if they changed
            if path == 'strummer.actionRules':
                self.actions.set_action_rules_config(self.config.strummer.action_rules)

            # Update MIDI channel on the backend if it changed
            # Frontend sends 0-15 (0-based), backend expects 0-15 (0-based)
            if 'midiChannel' in path and self.backend is not None:
                self.backend.set_channel(value)

            # Reconnect MIDI output if port changed. ``None`` means the
            # user toggled the current output off in the UI — just
            # disconnect and stay disconnected; ``backend.connect(None)``
            # silently falls through to port 0, which would either
            # reconnect to a random device or (once ALSA has leaked
            # Sketchatone clients from earlier toggles) land on our own
            # output and re-arm the loopback.
            if path == 'midi.midiOutputId' and self.backend is not None:
                if value is None:
                    print(colored('[MIDI Output] Disconnecting (no port selected)', Colors.YELLOW))
                    self.backend.disconnect()
                    self._broadcast_midi_devices()
                else:
                    print(colored(f'[MIDI Output] Reconnecting to port: {value}', Colors.CYAN))
                    self.backend.disconnect()
                    if self.backend.connect(value):
                        print(colored('[MIDI Output] Reconnected successfully', Colors.GREEN))
                        # Broadcast updated device list to all clients
                        self._broadcast_midi_devices()
                    else:
                        print(colored('[MIDI Output] Failed to reconnect', Colors.RED))

            # Reconnect MIDI input if port changed
            if path == 'midi.midiInputId' and self.midi_input is not None:
                print(colored(f'[MIDI Input] Reconnecting to port(s): {value}', Colors.CYAN))
                self.midi_input.disconnect()

                connected = False
                if isinstance(value, list):
                    # Array of port IDs - connect to multiple specific ports
                    if len(value) == 0:
                        # Empty array = disconnect all
                        print(colored('[MIDI Input] Disconnecting all ports (empty selection)', Colors.YELLOW))
                        connected = False
                    else:
                        # Connect to selected ports
                        exclude_ports = list(self.config.midi.midi_input_exclude)
                        connected = self.midi_input.connect_multiple(value, exclude_ports=exclude_ports)
                        if connected:
                            print(colored(f'[MIDI Input] Reconnected to {len(value)} port(s)', Colors.GREEN))
                elif value is None:
                    # Legacy: null = connect to all ports (but we don't use this anymore from UI)
                    exclude_ports = list(self.config.midi.midi_input_exclude)
                    connected = self.midi_input.connect_all(exclude_ports=exclude_ports)
                    if connected:
                        print(colored('[MIDI Input] Reconnected to all ports', Colors.GREEN))
                else:
                    # Single port (legacy support)
                    connected = self.midi_input.connect(value)
                    if connected:
                        print(colored('[MIDI Input] Reconnected successfully', Colors.GREEN))

                if connected:
                    # Re-register the callback after reconnection
                    self._register_midi_input_callback()
                    # Re-register passthrough after reconnection
                    self._register_midi_passthrough()

                # Always broadcast updated device list to all clients (even on disconnect)
                self._broadcast_midi_devices()

            # Update MIDI passthrough if configuration changed
            if path == 'midi.midiPassthrough':
                print(colored(f'[MIDI Passthrough] Configuration updated', Colors.CYAN))
                self._register_midi_passthrough()
                # Broadcast updated device list to show passthrough status
                self._broadcast_midi_devices()

            # Re-apply action rules if they changed
            if 'actionRules' in path or 'action_rules' in path:
                self.actions.set_action_rules_config(self.config.strummer.action_rules)
                # Re-execute startup rules to apply new chord progression
                self.actions.execute_startup_rules()

            # Persist every config change immediately so it survives a
            # restart. The Save/Revert affordances have been retired; all
            # in-memory mutations round-trip to disk right away.
            # Exception: the live strumming chord changes frequently
            # during play (UI chord buttons, MIDI-driven progressions)
            # and writing the full config on every press adds enough
            # synchronous I/O to stall the WS/tablet loop and cause
            # buffered-then-released strums. It's transient play state,
            # so we intentionally skip persistence for it.
            if path != 'strummer.strumming.chord':
                self._persist_config_to_file()

            print(colored(f'Config updated: {path} = {value}', Colors.YELLOW))
        except Exception as e:
            print(colored(f'Failed to update config: {path} - {e}', Colors.RED))

    def _persist_config_to_file(self) -> None:
        """
        Write the current in-memory config to disk (if a file path is configured).
        Used by auto-learn and other server-initiated config mutations.
        Preserves original file ownership when running as root (sudo).
        """
        if not self.strummer_config_path:
            return
        try:
            original_uid = None
            original_gid = None
            if os.path.exists(self.strummer_config_path):
                stat_info = os.stat(self.strummer_config_path)
                original_uid = stat_info.st_uid
                original_gid = stat_info.st_gid

            with open(self.strummer_config_path, 'w', encoding='utf-8') as f:
                json.dump(self.config.to_dict(), f, indent=2)

            if original_uid is not None and os.geteuid() == 0:
                os.chown(self.strummer_config_path, original_uid, original_gid)
        except Exception as e:
            abs_path = os.path.abspath(self.strummer_config_path)
            errno_name = getattr(e, 'errno', None)
            errno_str = f' ({errno.errorcode.get(errno_name, errno_name)})' if errno_name else ''
            print(colored(
                f'[Persist Config] !! FAILED to write {abs_path}: '
                f'{type(e).__name__}{errno_str}: {e}',
                Colors.RED,
            ))
            print(colored(
                '[Persist Config] !! UI changes will NOT survive restart '
                'until this is resolved (check file ownership/permissions).',
                Colors.RED,
            ))

    def _maybe_learn_device_button(self, code: int) -> None:
        """
        If button detection is currently on and this aux code isn't already
        known, append it to ``device_buttons.buttons`` with a default name,
        persist, and broadcast the updated config to all clients.
        """
        from ..models.device_buttons_config import DeviceButton
        if not self.detecting_device_buttons:
            return
        dbc = self.config.device_buttons
        if any(b.code == code for b in dbc.buttons):
            return

        next_index = len(dbc.buttons) + 1
        dbc.buttons.append(DeviceButton(code=code, name=f'Button {next_index}'))
        print(colored(
            f'[Device Buttons] Learned new button: code={code} name="Button {next_index}"',
            Colors.CYAN,
        ))
        self._persist_config_to_file()
        self.broadcast_config(is_saved_state=True)

    def _maybe_learn_device_key(self, key: str) -> None:
        """
        If key detection is currently on and this key isn't already known,
        append it to ``device_buttons.keys`` with a default name, persist, and
        broadcast the updated config to all clients.
        """
        from ..models.device_buttons_config import DeviceKey
        if not self.detecting_device_buttons or not key:
            return
        dbc = self.config.device_buttons
        if any(k.key == key for k in dbc.keys):
            return

        dbc.keys.append(DeviceKey(key=key, name=f'Key {key.upper()}'))
        print(colored(
            f'[Device Buttons] Learned new key: key="{key}" name="Key {key.upper()}"',
            Colors.CYAN,
        ))
        self._persist_config_to_file()
        self.broadcast_config(is_saved_state=True)

    def _broadcast_button_detection_state(self) -> None:
        """
        Broadcast the current button-detection state to all clients so UIs
        stay in sync across multiple browser tabs.
        """
        self._broadcast(json.dumps({
            'type': 'button-detection-state',
            'enabled': self.detecting_device_buttons,
        }))

    async def _handle_restart_service(self, websocket: 'WebSocketServerProtocol') -> None:
        """
        Restart the systemd service.
        """
        print(colored('[Restart Service] Received restart request', Colors.CYAN))

        try:
            # Check if running as systemd service
            result = subprocess.run(
                ['systemctl', 'is-active', 'sketchatone'],
                capture_output=True,
                text=True
            )
            is_systemd_service = result.stdout.strip() == 'active'

            if not is_systemd_service:
                error_msg = 'Not running as a systemd service. Please restart manually.'
                print(colored(f'[Restart Service] {error_msg}', Colors.YELLOW))
                await websocket.send(json.dumps({
                    'type': 'restart-service-error',
                    'error': error_msg,
                }))
                return

            # Send acknowledgment before restarting
            await websocket.send(json.dumps({
                'type': 'restart-service-ack',
                'message': 'Service restart initiated. Reconnecting...',
            }))

            print(colored('[Restart Service] Restarting sketchatone service...', Colors.YELLOW))

            # Delay to allow acknowledgment to be sent
            await asyncio.sleep(0.5)

            # Restart service (use sudo if available)
            subprocess.Popen(['sudo', 'systemctl', 'restart', 'sketchatone'])
        except Exception as e:
            print(colored(f'[Restart Service] Error: {e}', Colors.RED))
            await websocket.send(json.dumps({
                'type': 'restart-service-error',
                'error': 'Failed to restart service',
            }))

    def _handle_save_config(self) -> None:
        """
        Save the current configuration to the config file.
        Preserves original file ownership even when running as root (sudo).
        """
        if not self.strummer_config_path:
            print(colored('[Save Config] No config file path - config was not loaded from a file', Colors.RED))
            return

        try:
            # Get original file ownership before writing (to preserve when running as sudo)
            original_uid = None
            original_gid = None
            if os.path.exists(self.strummer_config_path):
                stat_info = os.stat(self.strummer_config_path)
                original_uid = stat_info.st_uid
                original_gid = stat_info.st_gid

            config_dict = self.config.to_dict()
            with open(self.strummer_config_path, 'w', encoding='utf-8') as f:
                json.dump(config_dict, f, indent=2)

            # Restore original ownership if we had it and we're running as root
            if original_uid is not None and os.geteuid() == 0:
                os.chown(self.strummer_config_path, original_uid, original_gid)

            print(colored(f'[Save Config] Configuration saved to {self.strummer_config_path}', Colors.GREEN))

            # Broadcast with is_saved_state=True so clients know config matches file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Save Config] Failed to save configuration: {e}', Colors.RED))

    def _handle_load_config(self, config_name: str) -> None:
        """Load a config file by name."""
        if not self.strummer_config_dir:
            print(colored('[Load Config] No config directory set', Colors.RED))
            return

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Load Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(config_path):
            print(colored(f'[Load Config] Config file not found: {config_name}', Colors.RED))
            return

        try:
            self.config = MidiStrummerConfig.from_json_file(config_path)
            self.strummer_config_path = config_path
            self.current_config_name = config_name

            # Release any notes held under the previous config and reset both controllers
            self._clear_controller_state()

            # Re-apply strummer settings
            self.strummer.configure(self.config.pressure_threshold, self.config.strummer.strumming.pressure_buffer_size)
            self.slider.configure(self.config.strummer.slide.pressure_threshold, self.config.strummer.slide.max_bend_semitones)
            self._setup_notes()
            self.actions.set_action_rules_config(self.config.strummer.action_rules)
            self.actions.execute_startup_rules()

            print(colored(f'[Load Config] Loaded config: {config_name}', Colors.GREEN))

            # Broadcast with is_saved_state=True since we just loaded from file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Load Config] Failed to load config: {e}', Colors.RED))

    def _handle_create_config(self, config_name: str) -> None:
        """Create a new config file with default values."""
        if not self.strummer_config_dir:
            print(colored('[Create Config] No config directory set', Colors.RED))
            return

        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Create Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if os.path.exists(config_path):
            print(colored(f'[Create Config] Config file already exists: {config_name}', Colors.RED))
            return

        try:
            new_config = MidiStrummerConfig()
            config_dict = new_config.to_dict()
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_dict, f, indent=2)

            # Set permissions to 0o666 to allow editing when created as root
            if os.geteuid() == 0:
                os.chmod(config_path, 0o666)

            print(colored(f'[Create Config] Created new config: {config_name}', Colors.GREEN))

            # Switch to the newly created config
            self.strummer_config_path = config_path
            self.current_config_name = config_name
            self.config = new_config

            # Broadcast with is_saved_state=True since we just created/saved the file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Create Config] Failed to create config: {e}', Colors.RED))

    def _handle_rename_config(self, old_name: str, new_name: str) -> None:
        """Rename a config file."""
        if not self.strummer_config_dir:
            print(colored('[Rename Config] No config directory set', Colors.RED))
            return

        # Ensure names end with .json
        if not old_name.endswith('.json'):
            old_name = old_name + '.json'
        if not new_name.endswith('.json'):
            new_name = new_name + '.json'

        old_path = os.path.join(self.strummer_config_dir, old_name)
        new_path = os.path.join(self.strummer_config_dir, new_name)

        # Security check: ensure paths are within the config directory
        resolved_old_path = os.path.abspath(old_path)
        resolved_new_path = os.path.abspath(new_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_old_path.startswith(resolved_dir) or not resolved_new_path.startswith(resolved_dir):
            print(colored('[Rename Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(old_path):
            print(colored(f'[Rename Config] Config file not found: {old_name}', Colors.RED))
            return

        if os.path.exists(new_path):
            print(colored(f'[Rename Config] Config file already exists: {new_name}', Colors.RED))
            return

        try:
            os.rename(old_path, new_path)

            # Update current config path if we renamed the current config
            if self.current_config_name == old_name:
                self.strummer_config_path = new_path
                self.current_config_name = new_name

            print(colored(f'[Rename Config] Renamed {old_name} to {new_name}', Colors.GREEN))

            # Broadcast updated config list to all clients
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Rename Config] Failed to rename config: {e}', Colors.RED))

    def _handle_upload_config(self, config_name: str, config_data: Any) -> None:
        """Upload a config file (save uploaded data as a new config) and switch to it."""
        if not self.strummer_config_dir:
            print(colored('[Upload Config] No config directory set', Colors.RED))
            return

        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Upload Config] Invalid config path - path traversal detected', Colors.RED))
            return

        try:
            # Parse and validate the config data
            parsed_config = MidiStrummerConfig.from_dict(config_data)

            # Write the config file
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2)

            # Set permissions to 0o666 to allow editing when created as root
            if os.geteuid() == 0:
                os.chmod(config_path, 0o666)

            print(colored(f'[Upload Config] Uploaded config: {config_name}', Colors.GREEN))

            # Switch to the uploaded config
            self.strummer_config_path = config_path
            self.current_config_name = config_name
            self.config = parsed_config

            # Release any notes held under the previous config and reset both controllers
            self._clear_controller_state()

            # Re-apply settings from the new config
            self.strummer.configure(self.config.pressure_threshold, self.config.strummer.strumming.pressure_buffer_size)
            self.slider.configure(self.config.strummer.slide.pressure_threshold, self.config.strummer.slide.max_bend_semitones)
            self._setup_notes()
            self.actions.set_action_rules_config(self.config.strummer.action_rules)
            self.actions.execute_startup_rules()

            # Broadcast with is_saved_state=True since we just saved the file
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Upload Config] Failed to upload config: {e}', Colors.RED))

    def _handle_delete_config(self, config_name: str) -> None:
        """Delete a config file."""
        if not self.strummer_config_dir:
            print(colored('[Delete Config] No config directory set', Colors.RED))
            return

        # Don't allow deleting the currently loaded config
        if self.current_config_name == config_name:
            print(colored('[Delete Config] Cannot delete the currently loaded config', Colors.RED))
            return

        config_path = os.path.join(self.strummer_config_dir, config_name)

        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.strummer_config_dir)
        if not resolved_path.startswith(resolved_dir):
            print(colored('[Delete Config] Invalid config path - path traversal detected', Colors.RED))
            return

        if not os.path.exists(config_path):
            print(colored(f'[Delete Config] Config file not found: {config_name}', Colors.RED))
            return

        try:
            os.remove(config_path)
            print(colored(f'[Delete Config] Deleted config: {config_name}', Colors.GREEN))

            # Broadcast updated config list to all clients
            self.broadcast_config(is_saved_state=True)
        except Exception as e:
            print(colored(f'[Delete Config] Failed to delete config: {e}', Colors.RED))

    def _get_midi_devices_data(self) -> dict:
        """
        Get current MIDI devices data.
        Returns a dict with inputPorts, outputPorts, currentInputPorts, currentOutputPort, and excludedInputPorts.
        """
        input_ports = []
        output_ports = []

        # Build exclusion lists up front so we can filter both pickers.
        # Same case-insensitive substring rule as RtMidiInput.connect_all,
        # so anything hidden here is guaranteed to also be skipped by the
        # auto-connect path.
        excluded_input_ports = list(self.config.midi.midi_input_exclude)
        excluded_output_ports = list(self.config.midi.midi_output_exclude)

        def _is_excluded(name: Optional[str], patterns: List[str]) -> bool:
            if not name:
                return False
            lowered = name.lower()
            return any(p and p.lower() in lowered for p in patterns)

        # Get MIDI input ports
        if self.midi_input:
            available_inputs = self.midi_input.get_available_ports()
            input_ports = [
                p for p in available_inputs
                if not _is_excluded(p.get('name', ''), excluded_input_ports)
            ]
            print(colored(f'[MIDI Devices] Found {len(input_ports)} input ports', Colors.CYAN))

        # Get MIDI output ports. We keep the enumeration index as the id
        # so the backend still opens the right port after excluded entries
        # are dropped from the visible list.
        if self.backend:
            available_outputs = self.backend.get_available_ports()
            output_ports = [
                {'id': i, 'name': name}
                for i, name in enumerate(available_outputs)
                if not _is_excluded(name, excluded_output_ports)
            ]

        # Get currently connected ports (not just config values)
        # For input: return ALL connected port IDs (for "all ports" mode)
        current_input_ports = []
        if self.midi_input and self.midi_input.is_connected:
            connected_ports = self.midi_input.connected_ports
            current_input_ports = [p['id'] for p in connected_ports]

        # For output: find the port ID that matches the connected port name
        current_output_port = None
        if self.backend and self.backend.is_connected and self.backend.current_output_name:
            if getattr(self.backend, 'is_virtual_port', False):
                # Virtual port won't appear in the enumerated list; inject it
                virtual_entry = {'id': '__virtual__', 'name': self.backend.current_output_name, 'virtual': True}
                output_ports = [virtual_entry] + output_ports
                current_output_port = '__virtual__'
            else:
                # Find the port index that matches the current output name
                output_name = self.backend.current_output_name
                for port in output_ports:
                    if port['name'] == output_name:
                        current_output_port = port['id']
                        break

        # Get passthrough connections from config
        passthrough_connections = self.config.midi.midi_passthrough

        # Detect active MIDI loopback: any currently-connected input port
        # whose normalized name matches the current output port. This is
        # how our own strums fed back into _update_notes_from_midi_input
        # before the CLIENT_NAME rename and is the general failure mode
        # for "Midi Through" self-routing. The UI colours the offending
        # rows red and shows a header warning; we don't block the
        # connection so users can still recover manually.
        loopback_input_port_ids: List[Any] = []
        if self.backend and self.backend.current_output_name and current_input_ports:
            out_norm = _normalize_midi_port_name(self.backend.current_output_name)
            connected_set = set(current_input_ports)
            for port in input_ports:
                pid = port.get('id')
                if pid in connected_set and _normalize_midi_port_name(port.get('name', '')) == out_norm:
                    loopback_input_port_ids.append(pid)

        data = {
            'inputPorts': input_ports,
            'outputPorts': output_ports,
            'currentInputPorts': current_input_ports,  # Array of connected input port IDs
            'currentOutputPort': current_output_port,
            'excludedInputPorts': excluded_input_ports,  # Ports excluded from input to prevent feedback loops
            'passthroughConnections': passthrough_connections,  # MIDI passthrough connections
            'loopbackInputPortIds': loopback_input_port_ids,  # Connected inputs that share a name with current output
        }
        print(colored(f'[MIDI Devices] Sending to client: {len(input_ports)} inputs, {len(output_ports)} outputs, {len(passthrough_connections)} passthrough', Colors.CYAN))
        if loopback_input_port_ids:
            print(colored(f'[MIDI Devices] !! Loopback detected on input port ids: {loopback_input_port_ids}', Colors.YELLOW))
        return data

    async def _handle_get_midi_devices(self, websocket: WebSocketServerProtocol) -> None:
        """Handle get-midi-devices request - returns available MIDI input and output ports."""
        try:
            data = self._get_midi_devices_data()
            response = {
                'type': 'midi-devices',
                'data': data
            }
            await websocket.send(json.dumps(response))
        except Exception as e:
            print(colored(f'[Get MIDI Devices] Error: {e}', Colors.RED))

    def _broadcast_midi_devices(self) -> None:
        """Broadcast MIDI devices update to all connected clients."""
        if not self.clients:
            print(colored('[Broadcast MIDI Devices] No clients connected', Colors.YELLOW))
            return

        try:
            data = self._get_midi_devices_data()
            print(colored(f'[Broadcast MIDI Devices] currentInputPorts: {data["currentInputPorts"]}', Colors.CYAN))
            print(colored(f'[Broadcast MIDI Devices] currentOutputPort: {data["currentOutputPort"]}', Colors.CYAN))

            message = {
                'type': 'midi-devices',
                'data': data
            }

            # Schedule broadcast on the event loop
            if hasattr(self, '_main_loop') and self._main_loop:
                print(colored(f'[Broadcast MIDI Devices] Broadcasting to {len(self.clients)} client(s)', Colors.GREEN))
                asyncio.run_coroutine_threadsafe(
                    self._broadcast_message(message),
                    self._main_loop
                )
            else:
                print(colored('[Broadcast MIDI Devices] No event loop available', Colors.RED))
        except Exception as e:
            print(colored(f'[Broadcast MIDI Devices] Error: {e}', Colors.RED))

    async def _broadcast_message(self, message: dict) -> None:
        """Broadcast a message to all connected clients."""
        if not self.clients:
            return

        message_json = json.dumps(message)
        await asyncio.gather(
            *[client.send(message_json) for client in self.clients],
            return_exceptions=True
        )

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

        # Convert dict values to proper config objects for known complex types
        if isinstance(value, dict):
            value = self._convert_dict_to_config(snake_last, value)

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

    def _convert_dict_to_config(self, attr_name: str, value: Dict[str, Any]) -> Any:
        """
        Convert a dict value to the appropriate config object based on attribute name.

        Args:
            attr_name: The snake_case attribute name being set
            value: The dict value to convert

        Returns:
            The converted config object, or the original dict if no conversion needed
        """
        from ..models.action_rules import ActionRulesConfig
        from ..models.strummer_features import StrumReleaseConfig, SliderConfig, PressureModulationConfig
        from ..models.strummer_config import StrummingConfig
        from ..models.parameter_mapping import ParameterMapping
        from ..models.device_buttons_config import DeviceButtonsConfig

        converters = {
            'action_rules': ActionRulesConfig.from_dict,
            'strum_release': StrumReleaseConfig.from_dict,
            'strumming': StrummingConfig.from_dict,
            'slide': SliderConfig.from_dict,
            'pressure_modulation': PressureModulationConfig.from_dict,
            'note_duration': ParameterMapping.from_dict,
            'pitch_bend': ParameterMapping.from_dict,
            'note_velocity': ParameterMapping.from_dict,
            'device_buttons': DeviceButtonsConfig.from_dict,
        }

        converter = converters.get(attr_name)
        if converter:
            return converter(value)
        return value

    def on_tablet_event(self, tablet_event: TabletEvent) -> None:
        """Handle a normalized tablet event from the TabletClient."""
        _t_all = time.perf_counter()
        if self._perf.enabled:
            _last = self._perf_last_event_ts
            self._perf_last_event_ts = _t_all
            if _last > 0.0:
                self._perf.mark_now('tablet.gap', _last)
        try:
            x = float(tablet_event.x)
            y = float(tablet_event.y)
            pressure = float(tablet_event.pressure)
            # Feed the idle GC scheduler: any pen contact or non-zero
            # pressure counts as active play, and blocks the sweeper from
            # firing until the user pauses. Cheap - a bool check + one
            # attribute write on the pen thread per sample.
            if pressure > 0.0 or tablet_event.state == 'contact':
                self._last_strum_activity_ts = _t_all
            tilt_x = float(tablet_event.tiltX)
            tilt_y = float(tablet_event.tiltY)
            tilt_xy = float(tablet_event.tiltXY)
            primary_button = bool(tablet_event.primaryButtonPressed)
            secondary_button = bool(tablet_event.secondaryButtonPressed)
            # TabletEvent.state is 'contact' | 'hover' | 'none'; downstream expects 'out-of-range'
            state = 'out-of-range' if tablet_event.state == 'none' else tablet_event.state
            raw_aux_codes = list(tablet_event.auxCodes)

            events = {
                'x': x, 'y': y, 'pressure': pressure,
                'tiltX': tilt_x, 'tiltY': tilt_y, 'tiltXY': tilt_xy,
            }

            # Stylus button transitions
            if primary_button and not self.button_state['primaryButtonPressed']:
                _t = time.perf_counter()
                self.actions.handle_button_event('button:primary', 'press')
                self._perf.mark_now('stylus.press', _t)
            if not primary_button and self.button_state['primaryButtonPressed']:
                _t = time.perf_counter()
                self.actions.handle_button_event('button:primary', 'release')
                self._perf.mark_now('stylus.release', _t)
            if secondary_button and not self.button_state['secondaryButtonPressed']:
                _t = time.perf_counter()
                self.actions.handle_button_event('button:secondary', 'press')
                self._perf.mark_now('stylus.press', _t)
            if not secondary_button and self.button_state['secondaryButtonPressed']:
                _t = time.perf_counter()
                self.actions.handle_button_event('button:secondary', 'release')
                self._perf.mark_now('stylus.release', _t)
            self.button_state['primaryButtonPressed'] = primary_button
            self.button_state['secondaryButtonPressed'] = secondary_button

            # Auxiliary (express-key) transitions: diff HID scan codes as `code:<n>`
            current_aux_codes: Set[int] = set(raw_aux_codes)
            for code in current_aux_codes - self.prev_aux_codes:
                _t = time.perf_counter()
                self.actions.handle_button_event(f'code:{code}', 'press')
                self._perf.mark_now('aux.press', _t)
                self._maybe_learn_device_button(code)
            for code in self.prev_aux_codes - current_aux_codes:
                _t = time.perf_counter()
                self.actions.handle_button_event(f'code:{code}', 'release')
                self._perf.mark_now('aux.release', _t)
            self.prev_aux_codes = current_aux_codes

            # Apply pitch bend based on configuration (throttled to avoid MIDI flooding)
            pitch_bend_cfg = self.config.strummer.pitch_bend
            if pitch_bend_cfg and self.backend:
                control_value = self._get_control_value(pitch_bend_cfg.control, events)
                if control_value is not None:
                    # Map the control value to pitch bend range
                    bend_value = pitch_bend_cfg.map_value(control_value)

                    # Initialize tracking variables
                    current_time = time.time()
                    if not hasattr(self, '_last_pitch_bend_time'):
                        self._last_pitch_bend_time = 0
                        self._last_pitch_bend_value = None

                    # Apply deadzone around center (±0.02) to avoid sending tiny changes near zero
                    # This prevents MIDI flooding when there's no actual pitch bend
                    if abs(bend_value) < 0.02:
                        bend_value = 0.0

                    # Only send if value changed significantly
                    # Don't send repeated messages with the same value
                    value_changed = (self._last_pitch_bend_value is None or
                                   abs(bend_value - self._last_pitch_bend_value) > 0.01)

                    if value_changed:
                        self.backend.send_pitch_bend(bend_value)
                        self._last_pitch_bend_time = current_time
                        self._last_pitch_bend_value = bend_value

            # Calculate dynamic note duration based on configuration
            note_duration_cfg = self.config.strummer.note_duration
            if note_duration_cfg:
                control_value = self._get_control_value(note_duration_cfg.control, events)
                if control_value is not None:
                    current_note_duration = note_duration_cfg.map_value(control_value)
                else:
                    current_note_duration = note_duration_cfg.default
            else:
                current_note_duration = self.config.note_duration

            # Get note velocity configuration for applying curve
            note_velocity_cfg = self.config.strummer.note_velocity

            # Create tablet event data
            tablet_data = TabletEventData(
                x=x, y=y, pressure=pressure, state=state,
                tiltX=tilt_x, tiltY=tilt_y, tiltXY=tilt_xy,
                primaryButtonPressed=primary_button,
                secondaryButtonPressed=secondary_button,
                auxCodes=raw_aux_codes,
            )
            _t = time.perf_counter()
            self.event_bus.emit_tablet_event(tablet_data)
            self._perf.mark_now('bus.emit_tablet', _t)

            # Update strummer/slider bounds (use normalized 0-1 range)
            self.strummer.update_bounds(1.0, 1.0)
            self.slider.update_bounds(1.0, 1.0)

            # Apply X inversion for left-handed use if configured
            strum_x = 1.0 - x if self.config.strummer.strumming.invert_x else x

            # Branch on top-level mode: 'slide' uses Slider, 'strum' uses Strummer
            if self.config.strummer.mode == 'slide':
                self._handle_slide(strum_x, pressure, x)
                return

            # Process strum
            _t = time.perf_counter()
            event = self.strummer.strum(strum_x, pressure)
            self._perf.mark_now('strum.compute', _t)

            # Get note repeater state from actions
            repeater_config = self.actions.get_repeater_config()
            note_repeater_enabled = repeater_config['active']
            pressure_multiplier = repeater_config['pressure_multiplier']
            frequency_multiplier = repeater_config['frequency_multiplier']

            # Get transpose state from actions
            transpose_enabled = self.actions.is_transpose_active()
            transpose_semitones = self.actions.get_transpose_semitones()

            if event:
                # Create strum event data
                # event is a dict: {'type': 'strum'|'release', 'notes': [{'note': NoteObject, 'velocity': int}], ...}
                event_type = event.get('type')
                strum_notes = []
                event_notes = event.get('notes', [])

                if event_type == 'strum' and event_notes:
                    # Track strum start time for strum release feature
                    # Only set on FIRST strum event (not subsequent strums across strings)
                    if self.strum_start_time == 0.0:
                        self.strum_start_time = time.time()

                    # Store notes for repeater and mark as holding
                    self.repeater_state['notes'] = event_notes
                    self.repeater_state['is_holding'] = True
                    self.repeater_state['last_repeat_time'] = time.time()

                    for note_data in event_notes:
                        note_obj = note_data['note']  # This is a NoteObject
                        raw_velocity = note_data['velocity']

                        # Apply velocity curve from note_velocity config
                        if note_velocity_cfg and raw_velocity > 0:
                            # Normalize velocity to 0-1 range
                            normalized_vel = raw_velocity / 127.0
                            # Apply the parameter mapping (includes curve)
                            velocity = int(note_velocity_cfg.map_value(normalized_vel))
                            # Clamp to MIDI range
                            velocity = max(1, min(127, velocity))
                        else:
                            velocity = raw_velocity

                        # Send MIDI note
                        if self.backend and velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note_obj
                            if transpose_enabled:
                                note_to_play = note_obj.transpose(transpose_semitones)
                            _t = time.perf_counter()
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=velocity,
                                duration=current_note_duration
                            )
                            self._perf.mark_now('midi.send_note', _t)
                            self.notes_played += 1

                        strum_notes.append(StrumNoteEventData(
                            note=note_obj.to_midi(),
                            velocity=velocity,
                            name=note_obj.notation,
                            octave=note_obj.octave,
                            duration=current_note_duration
                        ))

                elif event_type == 'release':
                    # Stop holding - no more repeats
                    self.repeater_state['is_holding'] = False
                    self.repeater_state['notes'] = []

                    # Handle strum release - send configured MIDI note on quick releases
                    strum_release_cfg = self.config.strummer.strum_release
                    if strum_release_cfg and strum_release_cfg.active and self.backend and self.strum_start_time > 0:
                        strum_duration = time.time() - self.strum_start_time
                        max_duration = strum_release_cfg.max_duration if strum_release_cfg.max_duration else 0.25

                        # Only trigger release note if duration is within the max duration threshold
                        if strum_duration <= max_duration:
                            release_note = strum_release_cfg.midi_note
                            # Default to channel 9 (0-based, MIDI channel 10/drums) if not specified
                            release_channel = strum_release_cfg.midi_channel if strum_release_cfg.midi_channel is not None else 9
                            velocity_multiplier = strum_release_cfg.velocity_multiplier if strum_release_cfg.velocity_multiplier else 1.0

                            # Use the velocity from the strum and apply multiplier
                            base_velocity = event.get('velocity', 64)
                            release_velocity = int(base_velocity * velocity_multiplier)
                            # Clamp to MIDI range 1-127
                            release_velocity = max(1, min(127, release_velocity))

                            # Display channel as 1-based for user-friendliness
                            print(colored(f'[Strum Release] note={release_note} vel={release_velocity} ch={release_channel + 1} dur={strum_duration:.3f}s', Colors.CYAN))

                            # Send the raw MIDI note using the backend's send_raw_note method
                            if hasattr(self.backend, 'send_raw_note'):
                                self.backend.send_raw_note(
                                    midi_note=release_note,
                                    velocity=release_velocity,
                                    duration=strum_duration,
                                    channel=release_channel
                                )

                    # Reset strum start time
                    self.strum_start_time = 0.0

                strum_data = StrumEventData(
                    type=event.get('type', 'strum'),
                    notes=strum_notes,
                    velocity=event.get('velocity', strum_notes[0].velocity if strum_notes else 0),
                    x=x,
                    pressure=pressure
                )
                self.event_bus.emit_strum_event(strum_data)

            # Handle note repeater - fire repeatedly while holding
            # Only process if note repeater is explicitly enabled
            if note_repeater_enabled and self.repeater_state['is_holding'] and self.repeater_state['notes']:
                current_time = time.time()
                time_since_last_repeat = current_time - self.repeater_state['last_repeat_time']

                # Apply frequency multiplier to duration (higher = faster repeats)
                repeat_interval = current_note_duration / frequency_multiplier if frequency_multiplier > 0 else current_note_duration

                # Check if it's time for another repeat
                if time_since_last_repeat >= repeat_interval:
                    for note_data in self.repeater_state['notes']:
                        note_obj = note_data['note']
                        # Use the original note's velocity with pressure multiplier applied
                        original_velocity = note_data.get('velocity', 100)
                        raw_repeat_velocity = int(original_velocity * pressure_multiplier)
                        raw_repeat_velocity = max(1, min(127, raw_repeat_velocity))

                        # Apply velocity curve from note_velocity config
                        if note_velocity_cfg and raw_repeat_velocity > 0:
                            normalized_vel = raw_repeat_velocity / 127.0
                            repeat_velocity = int(note_velocity_cfg.map_value(normalized_vel))
                            repeat_velocity = max(1, min(127, repeat_velocity))
                        else:
                            repeat_velocity = raw_repeat_velocity

                        if self.backend and repeat_velocity > 0:
                            # Apply transpose if enabled
                            note_to_play = note_obj
                            if transpose_enabled:
                                note_to_play = note_obj.transpose(transpose_semitones)
                            _t = time.perf_counter()
                            self.backend.send_note(
                                note=note_to_play,
                                velocity=repeat_velocity,
                                duration=current_note_duration
                            )
                            self._perf.mark_now('midi.send_note_repeat', _t)

                    self.repeater_state['last_repeat_time'] = current_time

        except Exception as e:
            import traceback
            print(colored(f'Error processing packet: {e}', Colors.RED))
            traceback.print_exc()
        finally:
            self._perf.mark_now('tablet.proc', _t_all)

    def _clear_controller_state(self) -> None:
        """
        Release any held notes and reset transient controller state.
        Called when switching modes (strum <-> slide) or reloading config.
        """
        if self.backend:
            try:
                self.backend.release_all()
                self.backend.send_pitch_bend(0.0)
            except Exception:
                pass
        if self.slide_active_note is not None and self.backend:
            try:
                self.backend.send_note_off(self.slide_active_note)
            except Exception:
                pass
        self.slide_active_note = None
        self.last_slide_modulation_value = None
        self.slider.clear()
        self.strummer.clear_strum()

    def _handle_slide(self, slide_x: float, pressure: float, raw_x: float) -> None:
        """
        Process a tablet sample in slide (trombone) mode.

        Routes Slider events to the MIDI backend (note on/off + pitch bend) and
        emits a StrumEventData on the event bus so visualizers see activity.
        """
        event = self.slider.slide(slide_x, pressure)
        if not event:
            return

        event_type = event.get('type')
        slide_config = self.config.strummer.slide
        max_bend = slide_config.max_bend_semitones or 1.0
        strum_notes: List[StrumNoteEventData] = []
        velocity_for_event = 0

        if event_type == 'slide_on':
            note_obj: NoteObject = event['note']
            velocity = int(event.get('velocity', 0))
            bend_semis = float(event.get('bend_semitones', 0.0))
            bend_value = max(-1.0, min(1.0, bend_semis / max_bend)) if max_bend else 0.0

            self.slide_active_note = note_obj
            velocity_for_event = velocity

            if self.backend:
                # Send pitch bend first so the note starts at the correct pitch
                self.backend.send_pitch_bend(bend_value)
                self.backend.send_note_on(note_obj, velocity)
                self._send_slide_pressure_modulation(pressure)
                self.notes_played += 1

            strum_notes.append(StrumNoteEventData(
                note=note_obj.to_midi(),
                velocity=velocity,
                name=note_obj.notation,
                octave=note_obj.octave,
                duration=0.0
            ))

        elif event_type == 'slide_update':
            note_obj = event['note']
            bend_semis = float(event.get('bend_semitones', 0.0))
            bend_value = max(-1.0, min(1.0, bend_semis / max_bend)) if max_bend else 0.0
            event_pressure = float(event.get('pressure', pressure))
            if self.backend:
                self.backend.send_pitch_bend(bend_value)
                self._send_slide_pressure_modulation(event_pressure)

            strum_notes.append(StrumNoteEventData(
                note=note_obj.to_midi(),
                velocity=0,
                name=note_obj.notation,
                octave=note_obj.octave,
                duration=0.0
            ))

        elif event_type == 'slide_off':
            if self.backend and self.slide_active_note is not None:
                self.backend.send_note_off(self.slide_active_note)
                self.backend.send_pitch_bend(0.0)
            self.slide_active_note = None
            self.last_slide_modulation_value = None

        strum_data = StrumEventData(
            type=event_type,
            notes=strum_notes,
            velocity=velocity_for_event,
            x=raw_x,
            pressure=pressure
        )
        self.event_bus.emit_strum_event(strum_data)

    def _send_slide_pressure_modulation(self, pressure: float) -> None:
        """
        Route the current pen pressure to channel aftertouch or a CC,
        based on the slide.pressure_modulation config. No-op when type is
        'none' or backend is missing.
        """
        if not self.backend:
            return
        mod = self.config.strummer.slide.pressure_modulation
        if mod.type == 'none':
            return
        from sketchatone.strummer.slider import pressure_to_modulation_value
        value = pressure_to_modulation_value(
            pressure,
            self.config.strummer.slide.pressure_threshold,
            mod.min_value,
            mod.max_value,
        )
        # Skip if the mapped value hasn't changed since the last send (avoids
        # flooding the synth with redundant aftertouch/CC messages on dense
        # input streams). Reset to None on slide_off / clear_controller_state.
        if value == self.last_slide_modulation_value:
            return
        self.last_slide_modulation_value = value
        if mod.type == 'aftertouch':
            self.backend.send_aftertouch(value)
        elif mod.type == 'cc':
            self.backend.send_cc(mod.cc_number, value)

    def handle_tablet_disconnect(self) -> None:
        """Handle a disconnect reported by the TabletClient reader."""
        if self.tablet_client is None:
            return
        self.prev_aux_codes.clear()
        try:
            self.tablet_client.stop()
        except Exception:
            pass
        self.tablet_client = None
        self.broadcast_status(False)
        print(colored('Device disconnected', Colors.YELLOW))
        if self.poll_ms is not None and self.is_running:
            # Reader thread's outer loop handles polling for a new device.
            pass


    async def run_server(self) -> None:
        """Run the WebSocket and HTTP servers"""
        self._main_loop = asyncio.get_event_loop()

        # Set exception handler for errors
        def exception_handler(loop, context):
            if 'exception' in context:
                print(f"[ERROR] {context['message']}: {context['exception']}")

        self._main_loop.set_exception_handler(exception_handler)

        self._http_server = None
        self._ws_server = None

        # Initialize MIDI output
        print(colored('Initializing MIDI output...', Colors.GRAY))
        if self._setup_midi():
            print(colored('✓ MIDI output initialized', Colors.GREEN))
            self._print_midi_config()
        else:
            print(colored('⚠ MIDI not available - running without MIDI output', Colors.YELLOW))

        # Initialize MIDI input (for external keyboard)
        print(colored('Initializing MIDI input...', Colors.GRAY))
        if self._setup_midi_input():
            input_port = self.config.midi.midi_input_id
            if isinstance(input_port, list):
                if len(input_port) == 0:
                    port_info = "no ports selected"
                else:
                    port_info = f"{len(input_port)} port(s) selected"
            elif input_port is None:
                port_info = f"all ports ({len(self.midi_input.connected_ports) if self.midi_input else 0} found)"
            else:
                port_info = self.midi_input.current_input_name if self.midi_input else str(input_port)
            print(colored(f'✓ MIDI input: {port_info}', Colors.GREEN))
        else:
            print(colored('⚠ No MIDI input ports connected', Colors.YELLOW))

        # Note: Automatic device monitoring has been removed in favor of manual refresh
        # Users can click the "Refresh Devices" button in the UI to update the device list

        # Start event bus
        self.event_bus.start(self._main_loop)

        # Pause event bus initially (no clients)
        self.event_bus.pause()

        # Get local IP for LAN access URLs
        local_ip = get_local_ip()

        # Use ANSI underline (\033[4m) to make URLs visually clickable
        UNDERLINE = '\033[4m'
        RESET = '\033[0m'

        # Start HTTP server if port is configured
        if self.http_port:
            self._http_server = await asyncio.start_server(
                self._handle_http_request,
                "0.0.0.0",
                self.http_port
            )
            print(colored(f'✓ HTTP server listening on port {self.http_port}', Colors.GREEN))
            if local_ip:
                print(colored(f'  http://{local_ip}:{self.http_port}', Colors.CYAN))

        # Start HTTPS server if port is configured
        if self.https_port:
            print(colored(f'[DEBUG] Attempting to start HTTPS server on port {self.https_port}', Colors.GRAY))
            # Generate self-signed certificate if it doesn't exist
            cert_result = generate_self_signed_cert(self.ssl_cert_file, self.ssl_key_file)
            print(colored(f'[DEBUG] Certificate generation result: {cert_result}', Colors.GRAY))
            if cert_result:
                try:
                    print(colored('[DEBUG] Creating SSL context...', Colors.GRAY))
                    # Create SSL context with more permissive settings for self-signed cert
                    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    ssl_context.load_cert_chain(self.ssl_cert_file, self.ssl_key_file)
                    # Don't require client certificates
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE

                    # Python 3.13 compatibility - set minimum TLS version
                    try:
                        ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
                    except AttributeError:
                        pass  # Older Python versions

                    # Set options for better compatibility
                    ssl_context.options |= ssl.OP_NO_SSLv2 | ssl.OP_NO_SSLv3
                    print(colored('[DEBUG] SSL context created successfully', Colors.GRAY))

                    # Start HTTPS server with SSL context
                    # For Python 3.13, we need to use a workaround for SSL
                    print(colored('[DEBUG] Starting HTTPS server (Python 3.13 compatible mode)...', Colors.GRAY))

                    # Try with ssl_handshake_timeout parameter (Python 3.11+)
                    try:
                        self._https_server = await asyncio.start_server(
                            self._handle_http_request,
                            "0.0.0.0",
                            self.https_port,
                            ssl=ssl_context,
                            backlog=100,
                            reuse_address=True,
                            ssl_handshake_timeout=60.0  # Increase timeout for debugging
                        )
                    except TypeError:
                        # Fallback for older Python without ssl_handshake_timeout
                        self._https_server = await asyncio.start_server(
                            self._handle_http_request,
                            "0.0.0.0",
                            self.https_port,
                            ssl=ssl_context,
                            backlog=100,
                            reuse_address=True
                        )

                    print(colored('[DEBUG] asyncio.start_server returned successfully', Colors.GRAY))
                    print(colored(f'✓ HTTPS server listening on port {self.https_port}', Colors.GREEN))
                    print(colored(f'  Certificate: {self.ssl_cert_file}', Colors.CYAN))
                    print(colored(f'  Local:   ', Colors.WHITE) + f'{UNDERLINE}{Colors.BLUE}https://localhost:{self.https_port}{RESET}')
                    if local_ip:
                        print(colored(f'  Network: ', Colors.WHITE) + f'{UNDERLINE}{Colors.BLUE}https://{local_ip}:{self.https_port}{RESET}')
                    print(colored('  Note: Self-signed certificate will show browser warnings', Colors.YELLOW))
                    print(colored('  Debug: SSL context created, waiting for connections...', Colors.GRAY))
                except Exception as e:
                    import traceback
                    print(colored(f'⚠ Failed to start HTTPS server: {e}', Colors.YELLOW))
                    print(colored(f'  Traceback: {traceback.format_exc()}', Colors.GRAY))
            else:
                print(colored('⚠ HTTPS server disabled (certificate generation failed)', Colors.YELLOW))

        # Start WebSocket server (plain)
        if self.ws_port:
            self._ws_server = await websockets.serve(
                self._handle_client,
                "0.0.0.0",
                self.ws_port
            )
            self.server = self._ws_server  # Keep backward compatibility

            print(colored(f'✓ WebSocket server listening on port {self.ws_port}', Colors.GREEN))
            if local_ip:
                print(colored(f'  ws://{local_ip}:{self.ws_port}', Colors.CYAN))

        # Start Secure WebSocket server (WSS) if port is configured
        if self.wss_port:
            print(colored(f'[DEBUG] Attempting to start WSS server on port {self.wss_port}', Colors.GRAY))
            # Generate self-signed certificate if it doesn't exist (reuse same certs as HTTPS)
            cert_result = generate_self_signed_cert(self.ssl_cert_file, self.ssl_key_file)
            print(colored(f'[DEBUG] Certificate generation result: {cert_result}', Colors.GRAY))
            if cert_result:
                try:
                    print(colored('[DEBUG] Creating SSL context for WSS...', Colors.GRAY))
                    # Create SSL context for WebSocket
                    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                    ssl_context.load_cert_chain(self.ssl_cert_file, self.ssl_key_file)
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE

                    # Python 3.13 compatibility
                    try:
                        ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
                    except AttributeError:
                        pass

                    ssl_context.options |= ssl.OP_NO_SSLv2 | ssl.OP_NO_SSLv3
                    print(colored('[DEBUG] SSL context for WSS created successfully', Colors.GRAY))

                    # Start secure WebSocket server
                    self._wss_server = await websockets.serve(
                        self._handle_client,
                        "0.0.0.0",
                        self.wss_port,
                        ssl=ssl_context
                    )

                    print(colored(f'✓ Secure WebSocket server listening on port {self.wss_port}', Colors.GREEN))
                    print(colored(f'  Certificate: {self.ssl_cert_file}', Colors.CYAN))
                    print(colored(f'  Local:   ', Colors.WHITE) + f'{UNDERLINE}{Colors.MAGENTA}wss://localhost:{self.wss_port}{RESET}')
                    if local_ip:
                        print(colored(f'  Network: ', Colors.WHITE) + f'{UNDERLINE}{Colors.MAGENTA}wss://{local_ip}:{self.wss_port}{RESET}')
                    print(colored('  Note: Self-signed certificate will show warnings', Colors.YELLOW))
                except Exception as e:
                    import traceback
                    print(colored(f'⚠ Failed to start WSS server: {e}', Colors.YELLOW))
                    print(colored(f'  Traceback: {traceback.format_exc()}', Colors.GRAY))
            else:
                print(colored('⚠ WSS server disabled (certificate generation failed)', Colors.YELLOW))

        if not self.ws_port and not self.wss_port:
            print(colored('⚠ No WebSocket server configured (both ws_port and wss_port are None)', Colors.YELLOW))

        # Start keyboard listener if configured
        if self.keyboard_listener:
            self.keyboard_listener.start()

        # Start reading tablet data in a separate thread (unless in dev mode)
        if not self.dev_mode:
            self.is_running = True
            tablet_thread = threading.Thread(target=self._run_tablet_reader, daemon=True)
            tablet_thread.start()

        # Keep server running
        try:
            await asyncio.Future()  # Run forever
        except asyncio.CancelledError:
            pass
        finally:
            print(colored('Cleaning up servers...', Colors.GRAY))
            # Stop keyboard listener
            if self.keyboard_listener:
                self.keyboard_listener.stop()
            # Stop tablet client HID readers
            self.is_running = False
            if self.tablet_client is not None:
                try:
                    self.tablet_client.stop()
                except Exception:
                    pass
                self.tablet_client = None
            self.event_bus.cleanup()
            if self._http_server:
                self._http_server.close()
                try:
                    await asyncio.wait_for(self._http_server.wait_closed(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass  # Don't block shutdown
                print(colored('✓ HTTP server closed', Colors.GREEN))
            if self._https_server:
                self._https_server.close()
                try:
                    await asyncio.wait_for(self._https_server.wait_closed(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass  # Don't block shutdown
                print(colored('✓ HTTPS server closed', Colors.GREEN))
            if self._ws_server:
                # Close all client connections with a timeout to avoid hanging
                if self.clients:
                    try:
                        await asyncio.wait_for(
                            asyncio.gather(
                                *[client.close() for client in list(self.clients)],
                                return_exceptions=True
                            ),
                            timeout=2.0
                        )
                    except asyncio.TimeoutError:
                        pass  # Force close below will handle it
                    self.clients.clear()
                self._ws_server.close()
                try:
                    await asyncio.wait_for(self._ws_server.wait_closed(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass  # Don't block shutdown
                print(colored('✓ WebSocket server closed', Colors.GREEN))
            if self._wss_server:
                # Close WSS server (clients already closed above in shared self.clients)
                self._wss_server.close()
                try:
                    await asyncio.wait_for(self._wss_server.wait_closed(), timeout=2.0)
                except asyncio.TimeoutError:
                    pass  # Don't block shutdown
                print(colored('✓ Secure WebSocket server closed', Colors.GREEN))
            if self.backend:
                self.backend.disconnect()
                print(colored('✓ MIDI backend disconnected', Colors.GREEN))
            if self.midi_input:
                self.midi_input.disconnect()
                print(colored('✓ MIDI input disconnected', Colors.GREEN))
            # Stop the note scheduler thread (daemon=False, blocks exit if not stopped)
            from ..midi.note_scheduler import shutdown_scheduler
            shutdown_scheduler()
            print(colored('✓ Note scheduler stopped', Colors.GREEN))

    def _run_tablet_reader(self) -> None:
        """Discover a TabletClient and drive its lifecycle from a worker thread.

        Runs until ``self.is_running`` becomes False. When ``poll_ms`` is set,
        keeps polling for a device on startup and after disconnects; otherwise
        exits the thread if no device is found.
        """
        poll_interval = (self.poll_ms or 2000) / 1000.0
        while self.is_running:
            if self.tablet_client is None:
                notified = {'flag': False}

                def on_waiting() -> None:
                    notified['flag'] = True
                    print(colored('Waiting for tablet device to be connected...', Colors.YELLOW))
                    if self.poll_ms is not None:
                        print(colored(f'Poll interval: {self.poll_ms}ms', Colors.GRAY))

                try:
                    if self.poll_ms is None:
                        client = TabletClient.discover()
                        if client is None:
                            print(colored('No tablet device found', Colors.RED))
                            return
                    else:
                        client = wait_for_device(
                            interval_ms=self.poll_ms,
                            on_waiting=on_waiting,
                        )
                except Exception as e:
                    print(colored(f'Discovery error: {e}', Colors.RED))
                    time.sleep(poll_interval)
                    continue

                try:
                    # Wire perf probe into the HID reader thread so we can
                    # tell whether stalls are inside hid.read() (OS/driver)
                    # or between reads (GIL contention from another thread).
                    if self._perf.enabled:
                        _mark = self._perf.mark_now
                        client.reader.perf_hook = _mark
                        for _aux in client.aux_readers:
                            _aux.perf_hook = _mark
                    client.start(
                        on_event=self.on_tablet_event,
                        on_disconnect=self.handle_tablet_disconnect,
                    )
                    # Aux readers are constructed inside client.start(), so
                    # attach the hook to any that appeared after startup too.
                    if self._perf.enabled:
                        for _aux in client.aux_readers:
                            _aux.perf_hook = self._perf.mark_now
                except Exception as e:
                    print(colored(f'Tablet reader error: {e}', Colors.RED))
                    import traceback
                    traceback.print_exc()
                    try:
                        client.stop()
                    except Exception:
                        pass
                    time.sleep(poll_interval)
                    continue

                self.tablet_client = client
                caps = client.capabilities
                print(colored(f'✓ Tablet connected: {caps.manufacturer} {caps.model}', Colors.GREEN))
                print(colored(f'  Aux buttons: {caps.aux_button_count}, pen buttons: {caps.pen_button_count}', Colors.GRAY))
                self.broadcast_status(True, caps.name)
                self.broadcast_config(False)

            time.sleep(0.1)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Strummer WebSocket Server - broadcasts tablet and strum events via WebSocket',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '-c', '--config',
        dest='config',
        metavar='PATH',
        help='Combined config file path (strummer, MIDI, and server settings). Device path is specified in server.device field.'
    )
    
    parser.add_argument(
        '--ws-port',
        type=int,
        default=8081,
        help='WebSocket server port (default: 8081)'
    )

    parser.add_argument(
        '--wss-port',
        type=int,
        help='Secure WebSocket server port with SSL (optional)'
    )

    parser.add_argument(
        '--http-port',
        type=int,
        help='HTTP server port for serving webapps (optional)'
    )

    parser.add_argument(
        '--https-port',
        type=int,
        help='HTTPS server port for captive portal detection on Android 10+ (optional)'
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

    parser.add_argument(
        '--dev',
        action='store_true',
        help='Development mode: run without a tablet device (UI only, no tablet input)'
    )

    # MIDI options
    parser.add_argument(
        '-j', '--jack',
        action='store_true',
        help='Use JACK MIDI backend instead of rtmidi'
    )

    parser.add_argument(
        '--channel',
        type=int,
        choices=range(1, 17),
        metavar='1-16',
        help='MIDI channel (1-16)'
    )

    parser.add_argument(
        '-p', '--port',
        dest='midi_port',
        metavar='PORT',
        help='MIDI output port (name or index)'
    )

    parser.add_argument(
        '-d', '--duration',
        type=float,
        dest='note_duration',
        metavar='SECONDS',
        help='Note duration in seconds'
    )

    parser.add_argument(
        '--jack-client-name',
        dest='jack_client_name',
        metavar='NAME',
        help='JACK client name'
    )

    parser.add_argument(
        '--jack-auto-connect',
        dest='jack_auto_connect',
        metavar='TARGET',
        help='JACK auto-connect target'
    )

    # Debug/test options
    parser.add_argument(
        '--dump-config',
        action='store_true',
        dest='dump_config',
        help='Load config, print as JSON, and exit (for testing)'
    )

    args = parser.parse_args()

    # Load config early to get server settings (CLI args take precedence)
    config = None
    config_path = None
    config_dir = None
    if args.config:
        config_path = os.path.abspath(args.config)
        config_dir = os.path.dirname(config_path)
        config = MidiStrummerConfig.from_json_file(config_path)

    # Handle --dump-config: print config as JSON and exit
    if args.dump_config:
        if config is None:
            config = MidiStrummerConfig()
        print(json.dumps(config.to_dict(), indent=2))
        sys.exit(0)

    # Resolve effective server settings (CLI args take precedence over config file)
    effective_ws_port = args.ws_port if args.ws_port != 8081 else (
        config.ws_port if config and config.ws_port else 8081
    )
    effective_wss_port = args.wss_port or (
        config.wss_port if config and hasattr(config, 'wss_port') else None
    )
    effective_http_port = args.http_port or (
        config.http_port if config else None
    )
    effective_https_port = args.https_port or (
        config.https_port if config and hasattr(config, 'https_port') else None
    )
    effective_throttle = args.throttle if args.throttle != 150 else (
        config.ws_message_throttle if config else 150
    )
    effective_poll = args.poll or (
        config.device_finding_poll_interval if config else None
    )

    print(colored(f'Sketchatone Server v{SKETCHATONE_VERSION}', Colors.CYAN))
    if args.dev:
        print(colored('Dev mode (no tablet)', Colors.YELLOW))
    if effective_http_port:
        print(colored(f'HTTP port: {effective_http_port}', Colors.GRAY))
    if effective_https_port:
        print(colored(f'HTTPS port: {effective_https_port}', Colors.GRAY))
    print(colored(f'Throttle: {effective_throttle}ms', Colors.GRAY))
    if effective_poll:
        print(colored(f'Poll interval: {effective_poll}ms', Colors.GRAY))
    print()

    # Parse MIDI port (could be int or string)
    midi_port = args.midi_port
    if midi_port is not None:
        try:
            midi_port = int(midi_port)
        except ValueError:
            pass  # Keep as string (port name)

    # Create and run server
    server = StrummerWebSocketServer(
        strummer_config_path=config_path,
        ws_port=effective_ws_port,
        wss_port=effective_wss_port,
        http_port=effective_http_port,
        https_port=effective_https_port,
        throttle_ms=effective_throttle,
        poll_ms=effective_poll,
        dev_mode=args.dev,
        # MIDI options
        use_jack=args.jack if args.jack else None,
        midi_channel=args.channel - 1 if args.channel is not None else None,  # Convert 1-16 to 0-15
        midi_port=midi_port,
        note_duration=args.note_duration,
        jack_client_name=args.jack_client_name,
        jack_auto_connect=args.jack_auto_connect
    )

    # Flag to track shutdown
    shutdown_requested = False

    def shutdown_handler(signum, frame):
        """Handle shutdown signals"""
        nonlocal shutdown_requested
        if shutdown_requested:
            # Force exit on second signal
            print(colored('\nForce shutdown...', Colors.RED))
            os._exit(1)
        shutdown_requested = True
        print(colored('\nShutting down gracefully...', Colors.YELLOW))
        print(colored('(Press Ctrl+C again to force quit)', Colors.GRAY))
        # Set flag to stop tablet reader thread loop
        server.is_running = False
        # Cancel asyncio tasks to trigger the finally block in run_server()
        if server._main_loop and server._main_loop.is_running():
            for task in asyncio.all_tasks(server._main_loop):
                server._main_loop.call_soon_threadsafe(task.cancel)

    # Register signal handlers
    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    try:
        asyncio.run(server.run_server())
    except KeyboardInterrupt:
        pass  # Handled by signal handler
    except SystemExit:
        pass  # Expected from signal handler


if __name__ == '__main__':
    main()
