"""HID enumeration and exclusive-access device reading."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional

import hid  # cython-hidapi

from ..otd.config_loader import ConfigIndex, ConfigMatch


log = logging.getLogger(__name__)


def _request_string_descriptor_via_usb(vendor_id: int, product_id: int, index: int) -> bool:
    """Send a GET_DESCRIPTOR(STRING, index) control transfer via libusb.

    macOS's IOHIDManager (which cython-hidapi uses) cannot reach arbitrary
    string descriptor indices; OTD works around this by going through
    HidSharp -> IOUSBDeviceInterface::DeviceRequest. We achieve the same
    via pyusb. UCLogic/Huion firmware uses this request as a magic
    mode-switch into vendor-report mode.
    """
    try:
        import usb.core  # local import: pyusb is only needed for the fallback
    except ImportError:
        log.warning("pyusb not installed; cannot send fallback string descriptor request")
        return False
    try:
        dev = usb.core.find(idVendor=vendor_id, idProduct=product_id)
    except (usb.core.NoBackendError, ValueError) as exc:
        log.warning("libusb backend unavailable (%s); install libusb (e.g. `brew install libusb`)", exc)
        return False
    if dev is None:
        log.warning("libusb could not find device %04x:%04x", vendor_id, product_id)
        return False
    try:
        # bmRequestType=0x80 (device-to-host, standard, device),
        # bRequest=0x06 (GET_DESCRIPTOR),
        # wValue=(STRING<<8) | index, wIndex=langID (English US),
        # wLength=255 (max string descriptor size).
        dev.ctrl_transfer(0x80, 0x06, (0x03 << 8) | index, 0x0409, 255)
        return True
    except usb.core.USBError as exc:
        log.warning("libusb ctrl_transfer(STRING %d) failed: %s", index, exc)
        return False


@dataclass
class DiscoveredDevice:
    """A connected HID device that matched a vendored OTD config."""
    vendor_id: int
    product_id: int
    path: bytes
    interface_number: int
    usage_page: int
    usage: int
    product_string: str
    manufacturer_string: str
    serial_number: str
    input_report_length: Optional[int]
    match: ConfigMatch


def _enumerate_raw() -> List[dict]:
    return list(hid.enumerate())


def _score_match(match: ConfigMatch, product: str, manufacturer: str) -> int:
    cfg = match.config
    score = 0
    if manufacturer and cfg.manufacturer.lower() == manufacturer:
        score += 2
    if product and cfg.model and cfg.model.lower() in product:
        score += 1
    return score


def pick_best_match(
    candidates: List[ConfigMatch],
    product_string: str,
    manufacturer_string: str,
) -> ConfigMatch:
    """Among configs that share a ``{VID, PID}`` (common with UCLogic-based
    tablets rebranded across Huion, Gaomon, Artisul, etc.), pick the one
    that best matches the device's own USB descriptor strings. Falls back
    to the first candidate when no tie-breaker fires.
    """
    if len(candidates) <= 1:
        return candidates[0]
    product = product_string.lower()
    manufacturer = manufacturer_string.lower()
    best = candidates[0]
    best_score = _score_match(best, product, manufacturer)
    for cand in candidates[1:]:
        score = _score_match(cand, product, manufacturer)
        if score > best_score:
            best = cand
            best_score = score
    return best


def discover(index: ConfigIndex) -> List[DiscoveredDevice]:
    """Enumerate HID devices and return any that match a vendored OTD config."""
    matches: List[DiscoveredDevice] = []
    for entry in _enumerate_raw():
        vid = entry.get("vendor_id")
        pid = entry.get("product_id")
        if vid is None or pid is None:
            continue
        candidates = index.find(vid, pid)
        if not candidates:
            continue
        product_string = entry.get("product_string") or ""
        manufacturer_string = entry.get("manufacturer_string") or ""
        matches.append(DiscoveredDevice(
            vendor_id=vid,
            product_id=pid,
            path=entry.get("path", b""),
            interface_number=entry.get("interface_number", -1),
            usage_page=entry.get("usage_page", 0),
            usage=entry.get("usage", 0),
            product_string=product_string,
            manufacturer_string=manufacturer_string,
            serial_number=entry.get("serial_number") or "",
            input_report_length=None,
            match=pick_best_match(candidates, product_string, manufacturer_string),
        ))
    return matches


DIGITIZER_USAGE_PAGE = 0x0D
AUX_USAGE_PAGE_GENERIC_DESKTOP = 0x01
AUX_USAGE_PAGE_CONSUMER = 0x0C
AUX_USAGE_PAGES = (AUX_USAGE_PAGE_GENERIC_DESKTOP, AUX_USAGE_PAGE_CONSUMER)


def is_standard_digitizer(device: DiscoveredDevice) -> bool:
    """True if the interface is the standard HID Digitizer (UsagePage 0x0D)."""
    return device.usage_page == DIGITIZER_USAGE_PAGE


def pick_aux_interfaces(devices: List[DiscoveredDevice]) -> List[DiscoveredDevice]:
    """Return the non-pen HID interfaces that expose the tablet's express keys.

    Tablets that want the OS to recognize their hardware buttons surface
    them through standard Keyboard (usage page 0x01) or Consumer Control
    (usage page 0x0C) collections on a separate interface from the
    digitizer. We open each unique path so we can forward raw scan codes
    to clients.

    On Linux the kernel's ``usbhid`` also binds these interfaces and
    exposes them via ``/dev/input/eventN``; to avoid double-firing,
    ``KeyboardListener`` unconditionally skips tablet-VID/PID evdev
    nodes so this hidraw path is the sole source of express-key events.
    """
    pen_ifaces = {d.interface_number for d in devices if is_standard_digitizer(d)}
    seen_paths: set = set()
    out: List[DiscoveredDevice] = []
    for d in devices:
        if is_standard_digitizer(d):
            continue
        if d.interface_number in pen_ifaces:
            continue
        if d.usage_page not in AUX_USAGE_PAGES:
            continue
        if d.path in seen_paths:
            continue
        seen_paths.add(d.path)
        out.append(d)
    return out


def pick_digitizer_interface(devices: List[DiscoveredDevice]) -> Optional[DiscoveredDevice]:
    """From candidates for a single tablet, pick the digitizer (pen) interface.

    Preference order:
      1. The standard HID Digitizer interface (UsagePage 0x0D). Actively
         reading it gives us the OS-compatibility reports our generic
         parser understands and (on macOS) suppresses the system cursor
         without requiring any vendor-specific init sequence.
      2. Anything else, falling back to the highest usage_page (vendor
         pages 0xFF00+ require a parser-specific init we may not be able
         to perform on every OS).
    """
    if not devices:
        return None
    digitizers = [d for d in devices if is_standard_digitizer(d)]
    pool = digitizers or devices
    return max(pool, key=lambda d: (d.usage_page, d.interface_number))


class HidReader:
    """Reads HID input reports in a background thread."""

    # Optional perf probe. When set (by the server if instrumentation is
    # enabled), each iteration of ``_run`` records timings into this
    # collector under the ``hid.read``, ``hid.read_gap`` and
    # ``hid.dispatch`` buckets. Kept as an instance attribute so unit
    # tests can construct readers without touching global state.
    perf_hook: Optional[Callable[[str, float], None]] = None

    def __init__(self, device: DiscoveredDevice):
        self.device = device
        self._dev: Optional[hid.device] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._on_report: Optional[Callable[[bytes], None]] = None
        self._on_disconnect: Optional[Callable[[], None]] = None
        self._last_log_key: Optional[bytes] = None

    def open(self, run_init: bool = True) -> None:
        d = hid.device()
        d.open_path(self.device.path)
        d.set_nonblocking(False)
        self._dev = d
        log.info("Opened HID device %s (VID=%04x PID=%04x interface=%d)",
                 self.device.product_string, self.device.vendor_id,
                 self.device.product_id, self.device.interface_number)
        if run_init:
            self._run_init_sequence()
        else:
            log.debug("Skipping vendor init sequence on this interface")

    def _run_init_sequence(self) -> None:
        """Mirror OTD's InputDevice.Initialize() init order.

        Many vendor tablets (UCLogic, ViewSonic, XP-Pen, etc.) ship a
        compatibility HID profile that drives the OS cursor and won't emit
        the rich vendor reports our parsers expect until a magic init
        sequence is sent. Without it: no events arrive and the OS keeps
        moving the cursor on its own.
        """
        assert self._dev is not None
        ident = self.device.match.identifier

        for index in ident.initialization_strings:
            try:
                self._dev.get_indexed_string(index)
                log.debug("Initialized string index %d (via hidapi)", index)
                continue
            except (OSError, ValueError) as exc:
                log.debug("hidapi get_indexed_string(%d) failed: %s; "
                          "falling back to libusb", index, exc)
            if not _request_string_descriptor_via_usb(
                    self.device.vendor_id, self.device.product_id, index):
                log.warning("InitializationString %d failed via all backends", index)
            else:
                log.debug("Initialized string index %d (via libusb)", index)

        for report in ident.feature_init_reports:
            try:
                self._dev.send_feature_report(report)
                log.debug("Set feature report: %s", report.hex())
            except (OSError, ValueError) as exc:
                log.warning("FeatureInitReport %s failed: %s", report.hex(), exc)

        for report in ident.output_init_reports:
            try:
                self._dev.write(report)
                log.debug("Wrote output report: %s", report.hex())
            except (OSError, ValueError) as exc:
                log.warning("OutputInitReport %s failed: %s", report.hex(), exc)

    def get_report_descriptor(self) -> Optional[bytes]:
        """Return the raw HID report descriptor, or None if unsupported."""
        if self._dev is None:
            return None
        try:
            data = self._dev.get_report_descriptor()
        except (OSError, AttributeError) as exc:
            log.debug("get_report_descriptor failed: %s", exc)
            return None
        return bytes(data) if data else None

    def start(self,
              on_report: Callable[[bytes], None],
              on_disconnect: Optional[Callable[[], None]] = None) -> None:
        if self._dev is None:
            raise RuntimeError("Device not opened")
        self._on_report = on_report
        self._on_disconnect = on_disconnect
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="HidReader", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        assert self._dev is not None
        # 64 bytes is a safe upper bound for HID input reports across
        # both standard digitizer and vendor interfaces; hidapi returns
        # only the bytes the device actually sent.
        buffer_size = max(64, self.device.match.identifier.input_report_length or 0)
        perf = self.perf_hook
        _last_read_end: float = 0.0
        while not self._stop.is_set():
            _read_start = time.perf_counter() if perf else 0.0
            if perf and _last_read_end > 0.0:
                perf('hid.read_gap', _last_read_end)
            try:
                data = self._dev.read(buffer_size, timeout_ms=500)
            except OSError:
                log.warning("HID read failed; signalling disconnect")
                if self._on_disconnect:
                    self._on_disconnect()
                return
            if perf:
                # Split by outcome so idle 500ms timeouts don't pollute
                # the active-read p95/max we actually care about.
                perf('hid.read_active' if data else 'hid.read_idle', _read_start)
            if not data:
                if perf:
                    _last_read_end = time.perf_counter()
                continue
            if log.isEnabledFor(logging.DEBUG):
                # Collapse high-rate streams: only log when the report id
                # or status byte changes, since per-sample X/Y/pressure
                # noise drowns out the transitions we care about (button
                # presses, in-range/out-of-range, contact toggles).
                key = bytes(data[:2]) if len(data) >= 2 else bytes(data)
                if key != self._last_log_key:
                    log.debug("report: %s", bytes(data).hex())
                    self._last_log_key = key
            _dispatch_start = time.perf_counter() if perf else 0.0
            try:
                if self._on_report:
                    self._on_report(bytes(data))
            except Exception:  # pragma: no cover - never let callback kill the thread
                log.exception("on_report callback raised")
            if perf:
                perf('hid.dispatch', _dispatch_start)
                _last_read_end = time.perf_counter()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._dev is not None:
            try:
                self._dev.close()
            finally:
                self._dev = None
