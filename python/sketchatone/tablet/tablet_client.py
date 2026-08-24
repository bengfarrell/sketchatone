"""High-level tablet client that composes discovery, HID reading, parsing,
and event adaptation into a single unit that CLIs and services can drive
with a couple of callbacks. No transport concerns: the consumer decides how
to fan events out (websocket, bus, stdout, etc.).
"""

from __future__ import annotations

import glob
import logging
import os
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

from .otd.config_loader import ConfigIndex, TabletConfiguration
from .otd.parsers import StandardDigitizerReportParser, get_parser
from .server.aux_report import parse_aux_report
from .server.event_adapter import EventAdapter, TabletEvent
from .server.hid_descriptor import pick_pen_ranges
from .server.hid_device import (
    DiscoveredDevice,
    HidReader,
    discover,
    is_standard_digitizer,
    pick_aux_interfaces,
    pick_digitizer_interface,
)


log = logging.getLogger(__name__)


@dataclass
class DeviceCapabilities:
    name: str
    manufacturer: str
    model: str
    max_x: int
    max_y: int
    max_pressure: int
    pen_button_count: int
    aux_button_count: int


EventCallback = Callable[[TabletEvent], None]
DisconnectCallback = Callable[[], None]


class TabletClient:
    """Composes an OTD-matched HID device with parser + adapter + aux readers."""

    def __init__(self,
                 device: DiscoveredDevice,
                 aux_devices: Optional[List[DiscoveredDevice]] = None):
        self.device = device
        self.aux_devices: List[DiscoveredDevice] = list(aux_devices or [])
        self.config: TabletConfiguration = device.match.config
        self._use_standard_digitizer = is_standard_digitizer(device)
        if self._use_standard_digitizer:
            log.info("Using standard HID digitizer parser for %s", self.config.name)
            self.parser = StandardDigitizerReportParser()
        else:
            self.parser = get_parser(device.match.identifier.report_parser)
        self.adapter = EventAdapter(self.config)
        self.reader = HidReader(device)
        self.aux_readers: List[HidReader] = []
        self._on_event: Optional[EventCallback] = None
        self._on_disconnect: Optional[DisconnectCallback] = None
        self._started = False

    @staticmethod
    def discover(vendor_id: Optional[int] = None,
                 product_id: Optional[int] = None,
                 use_aux: bool = True,
                 config_index: Optional[ConfigIndex] = None) -> Optional["TabletClient"]:
        """Enumerate connected HID devices and return a client for the best match."""
        index = config_index or ConfigIndex.from_vendored()
        devices = discover(index)
        if vendor_id is not None:
            devices = [d for d in devices if d.vendor_id == vendor_id]
        if product_id is not None:
            devices = [d for d in devices if d.product_id == product_id]
        device = pick_digitizer_interface(devices)
        if device is None:
            return None
        siblings = [d for d in devices
                    if d.vendor_id == device.vendor_id and d.product_id == device.product_id]
        aux_devices = pick_aux_interfaces(siblings) if use_aux else []
        return TabletClient(device, aux_devices=aux_devices)

    @property
    def capabilities(self) -> DeviceCapabilities:
        spec = self.config.specifications
        return DeviceCapabilities(
            name=self.config.name,
            manufacturer=self.config.manufacturer,
            model=self.config.model,
            max_x=spec.digitizer_max_x,
            max_y=spec.digitizer_max_y,
            max_pressure=spec.pen_max_pressure,
            pen_button_count=spec.pen_button_count,
            aux_button_count=spec.aux_button_count,
        )

    def start(self,
              on_event: EventCallback,
              on_disconnect: Optional[DisconnectCallback] = None) -> None:
        if self._started:
            raise RuntimeError("TabletClient already started")
        self._started = True
        self._on_event = on_event
        self._on_disconnect = on_disconnect
        self.reader.open(run_init=not self._use_standard_digitizer)
        if self._use_standard_digitizer:
            self._apply_descriptor_ranges()
        self.reader.start(on_report=self._on_report, on_disconnect=self._handle_disconnect)
        log.info("Reading from %s", self.config.name)
        self._start_aux_readers()

    def stop(self) -> None:
        self.reader.stop()
        for reader in self.aux_readers:
            reader.stop()
        self.aux_readers.clear()
        self._on_event = None
        self._on_disconnect = None
        self._started = False

    def _apply_descriptor_ranges(self) -> None:
        descriptor = self.reader.get_report_descriptor()
        if not descriptor:
            log.debug("No HID report descriptor available; using config ranges")
            return
        ranges = pick_pen_ranges(descriptor)
        if ranges is None:
            log.debug("No pen X/Y usages found in descriptor; using config ranges")
            return
        log.info("Descriptor pen ranges: x_max=%s y_max=%s pressure_max=%s",
                 ranges.x_max, ranges.y_max, ranges.pressure_max)
        self.adapter.override_ranges(
            max_x=ranges.x_max,
            max_y=ranges.y_max,
            max_pressure=ranges.pressure_max,
        )

    def _start_aux_readers(self) -> None:
        for aux in self.aux_devices:
            reader = HidReader(aux)
            try:
                reader.open(run_init=False)
            except (OSError, IOError) as exc:
                log.warning("Could not open aux interface %s (usage_page=%#06x): %s. "
                            "On macOS the keyboard-class aux interface requires root; "
                            "rerun with sudo to capture express keys.",
                            aux.path, aux.usage_page, exc)
                continue
            reader.start(
                on_report=lambda data, a=aux: self._on_aux_report(a, data),
                on_disconnect=None,
            )
            self.aux_readers.append(reader)
            log.info("Reading aux interface %d (usage_page=%#06x usage=%#06x) for %s",
                     aux.interface_number, aux.usage_page, aux.usage, self.config.name)

    def _on_aux_report(self, aux: DiscoveredDevice, data: bytes) -> None:
        report_id, codes = parse_aux_report(data)
        if not self.adapter.update_aux_codes(aux.path, report_id, codes):
            return
        if self._on_event is not None:
            self._on_event(self.adapter._empty_event())

    def _on_report(self, data: bytes) -> None:
        try:
            report = self.parser.parse(data)
        except (IndexError, ValueError):
            return
        if report is None:
            return
        event = self.adapter.adapt(report)
        if event is None:
            return
        if self._on_event is not None:
            self._on_event(event)

    def _handle_disconnect(self) -> None:
        if self._on_disconnect is not None:
            self._on_disconnect()


BlockedTablet = Tuple[int, int, str]

# Root of the sysfs hidraw class tree. Overridable for tests without
# needing to mock the whole filesystem. Kept as a module-level constant
# so patching one attribute is enough.
HIDRAW_SYSFS_ROOT = "/sys/class/hidraw"


def _parse_hid_id(uevent_text: str) -> Optional[Tuple[int, int]]:
    """Extract (vendor_id, product_id) from a hidraw uevent file body.

    The relevant line looks like ``HID_ID=0003:0000256C:00000064`` where
    the second and third fields are 32-bit hex representations of the
    16-bit USB VID and PID. Returns None when the line is missing or
    malformed rather than raising.
    """
    for line in uevent_text.splitlines():
        if not line.startswith("HID_ID="):
            continue
        parts = line[len("HID_ID="):].split(":")
        if len(parts) != 3:
            return None
        try:
            return int(parts[1], 16) & 0xFFFF, int(parts[2], 16) & 0xFFFF
        except ValueError:
            return None
    return None


def find_blocked_tablets(index: ConfigIndex) -> List[BlockedTablet]:
    """Return tablets present on the bus but unreadable by this process.

    cython-hidapi silently drops devices it cannot ``open()``, so a
    permissions problem on ``/dev/hidraw*`` looks identical to "no
    tablet plugged in". This helper walks the world-readable sysfs
    hidraw entries, matches their VID/PID against the vendored OTD
    configs, and returns any that match but whose device node the
    current process cannot ``os.access(R_OK)``. Callers can use this
    to distinguish a missing device from a misconfigured udev setup.
    """
    blocked: List[BlockedTablet] = []
    seen: set = set()
    for sys_entry in sorted(glob.glob(os.path.join(HIDRAW_SYSFS_ROOT, "hidraw*"))):
        name = os.path.basename(sys_entry)
        uevent_path = os.path.join(sys_entry, "device", "uevent")
        try:
            with open(uevent_path, "r", encoding="utf-8") as fh:
                uevent = fh.read()
        except OSError:
            continue
        ids = _parse_hid_id(uevent)
        if ids is None:
            continue
        vid, pid = ids
        if not index.find(vid, pid):
            continue
        node = os.path.join("/dev", name)
        if os.access(node, os.R_OK):
            continue
        key = (vid, pid, node)
        if key in seen:
            continue
        seen.add(key)
        blocked.append(key)
    return blocked


def wait_for_device(interval_ms: int,
                    vendor_id: Optional[int] = None,
                    product_id: Optional[int] = None,
                    use_aux: bool = True,
                    config_index: Optional[ConfigIndex] = None,
                    on_waiting: Optional[Callable[[], None]] = None,
                    on_blocked: Optional[Callable[[List[BlockedTablet]], None]] = None
                    ) -> TabletClient:
    """Poll until a discoverable device appears; return a client for it."""
    notified = False
    while True:
        index = config_index or ConfigIndex.from_vendored()
        client = TabletClient.discover(
            vendor_id=vendor_id, product_id=product_id,
            use_aux=use_aux, config_index=index,
        )
        if client is not None:
            return client
        if not notified:
            blocked = find_blocked_tablets(index)
            if blocked:
                for vid, pid, node in blocked:
                    log.warning(
                        "Tablet %04x:%04x present at %s but not readable by this "
                        "process. Install the udev rules "
                        "(sudo sketchatone-ui-setup-autostart --install-hid) and "
                        "re-plug the tablet, or run as a user in the plugdev group.",
                        vid, pid, node,
                    )
                if on_blocked is not None:
                    on_blocked(blocked)
            if on_waiting is not None:
                on_waiting()
            notified = True
        time.sleep(interval_ms / 1000.0)
