"""
Keyboard Listener for Server-Side Input

System-level keyboard listener that works with systemd services.
Uses evdev on Linux or pynput on macOS for global keyboard capture.
Requires root/sudo permissions or accessibility permissions on macOS.

Emits raw normalized key characters; the server maps ``key:<char>`` to buttons.

On Linux, many drawing tablets (Huion, XP-Pen, Wacom, …) expose their
express-key buttons through a USB HID *keyboard* interface in addition
to the aux HID report. The kernel binds usbhid to that interface and
synthesises ``EV_KEY`` events, so without filtering those events would
land in the same stream as a real keyboard. ``tablet_vid_pids`` lets
this listener identify (and skip) those tablet interfaces so the
tablet's hidraw aux path is the sole source of express-key events -
keeping the ``code:<int>`` tablet-button IDs identical to macOS.
"""

import os
import threading
import platform
from typing import Callable, Optional, Set, Tuple


class KeyboardListener:
    """
    System-level keyboard listener that emits raw key press/release events.

    - On Linux: Uses evdev to read from /dev/input/event* (requires root).
      Every keyboard-capable device is opened on its own thread. When
      ``tablet_vid_pids`` is provided, each device's USB parent VID/PID
      is looked up via sysfs; devices whose parent matches are skipped
      entirely so the tablet's hidraw aux reader is the sole source of
      express-key events (matching the macOS code space).
    - On macOS: Uses pynput for global keyboard hooks (requires accessibility permissions or root)
    - On Windows: Uses pynput (not tested)
    """

    def __init__(
        self,
        enabled: bool,
        on_key_press: Callable[[str], None],
        on_key_release: Callable[[str], None],
        tablet_vid_pids: Optional[Set[Tuple[int, int]]] = None,
    ):
        self.enabled = enabled
        self.on_key_press = on_key_press
        self.on_key_release = on_key_release
        self.tablet_vid_pids: Set[Tuple[int, int]] = set(tablet_vid_pids or ())
        self.running = False
        self.listener = None
        self.system = platform.system()

    def start(self) -> None:
        if not self.enabled:
            return

        self.running = True

        if self.system == "Linux":
            self._start_linux()
        elif self.system == "Darwin":
            self._start_macos()
        else:
            print(f'[Keyboard] Warning: Platform {self.system} not fully tested')
            self._start_macos()

    def stop(self) -> None:
        self.running = False

        if self.listener:
            try:
                if hasattr(self.listener, 'stop'):
                    self.listener.stop()
                elif hasattr(self.listener, 'close'):
                    self.listener.close()
            except Exception:
                pass

    def _start_linux(self) -> None:
        try:
            import evdev
            from evdev import InputDevice, ecodes

            devices = [InputDevice(path) for path in evdev.list_devices()]
            keyboards = []
            for device in devices:
                caps = device.capabilities()
                if ecodes.EV_KEY in caps:
                    keys = caps[ecodes.EV_KEY]
                    if ecodes.KEY_A in keys or ecodes.KEY_1 in keys:
                        keyboards.append(device)

            if not keyboards:
                print('[Keyboard] No keyboard devices found')
                for device in devices:
                    print(f'  - {device.path}: {device.name}')
                return

            print('[Keyboard] Note: Requires root/sudo permissions')
            for keyboard in keyboards:
                vid_pid = _resolve_usb_vid_pid(keyboard.path)
                is_tablet = (
                    vid_pid is not None
                    and self.tablet_vid_pids
                    and vid_pid in self.tablet_vid_pids
                )
                # Tablet keyboard interfaces are handled by the tablet's
                # hidraw aux reader so express-key IDs match macOS.
                # Reading them here too would double-fire.
                if is_tablet:
                    print(
                        f'[Keyboard] Skipping tablet keyboard interface '
                        f'(handled via aux HID): '
                        f'{keyboard.name} ({keyboard.path})'
                    )
                    continue
                print(
                    f'[Keyboard] Listening on (keyboard): '
                    f'{keyboard.name} ({keyboard.path})'
                )
                thread = threading.Thread(
                    target=self._linux_listen_loop,
                    args=(keyboard,),
                    daemon=True,
                )
                thread.start()

        except ImportError:
            print('[Keyboard] ERROR: evdev not installed')
            print('[Keyboard] Install with: pip install evdev')
        except PermissionError as e:
            print(f'[Keyboard] ERROR: Permission denied - {e}')
            print('[Keyboard] Run with sudo or add user to input group:')
            print('[Keyboard]   sudo usermod -a -G input $USER')
        except Exception as e:
            print(f'[Keyboard] ERROR: {e}')

    def _linux_listen_loop(self, keyboard) -> None:
        from evdev import categorize, ecodes

        try:
            for event in keyboard.read_loop():
                if not self.running:
                    break

                if event.type != ecodes.EV_KEY:
                    continue

                key_event = categorize(event)

                keycode = key_event.keycode
                if isinstance(keycode, list):
                    keycode = keycode[0] if keycode else ''
                char = self._normalize_evdev_keycode(keycode)
                if not char:
                    continue

                if key_event.keystate == key_event.key_down:
                    self.on_key_press(char)
                elif key_event.keystate == key_event.key_up:
                    self.on_key_release(char)
        except Exception as e:
            if self.running:
                print(f'[Keyboard] Error in listen loop: {e}')

    @staticmethod
    def _normalize_evdev_keycode(keycode: str) -> str:
        if not keycode:
            return ''
        name = keycode.lower()
        if name.startswith('key_'):
            name = name[4:]
        if name.startswith('kp_'):
            name = name[3:]
        return name

    def _start_macos(self) -> None:
        try:
            from pynput import keyboard

            print('[Keyboard] Listener enabled')

            def _extract(key) -> Optional[str]:
                char = None
                if hasattr(key, 'char') and key.char:
                    char = key.char
                elif hasattr(key, 'name'):
                    char = key.name
                if not char:
                    return None
                return char.lower()

            def on_press(key):
                try:
                    char = _extract(key)
                    if char:
                        self.on_key_press(char)
                except Exception:
                    pass

            def on_release(key):
                try:
                    char = _extract(key)
                    if char:
                        self.on_key_release(char)
                except Exception:
                    pass

            self.listener = keyboard.Listener(on_press=on_press, on_release=on_release)
            self.listener.start()

        except ImportError:
            print('[Keyboard] ERROR: pynput not installed')
            print('[Keyboard] Install with: pip install pynput')
        except Exception as e:
            print(f'[Keyboard] ERROR: {e}')
            print('[Keyboard] On macOS, you may need to:')
            print('[Keyboard]   1. Grant Accessibility permissions in System Preferences')
            print('[Keyboard]   2. Or run with sudo')

    def update_config(self, enabled: bool) -> None:
        was_enabled = self.enabled
        self.enabled = enabled

        if not was_enabled and enabled:
            self.start()
        elif was_enabled and not enabled:
            self.stop()



def _resolve_usb_vid_pid(event_path: str) -> Optional[Tuple[int, int]]:
    """Walk sysfs from an evdev node up to its parent USB device and
    return ``(vendor_id, product_id)`` as ints, or ``None`` if the
    device isn't backed by USB or sysfs isn't readable.

    ``event_path`` is an ``/dev/input/eventN`` path. The corresponding
    sysfs entry is ``/sys/class/input/eventN/device``; every ancestor
    directory is checked for ``idVendor`` + ``idProduct`` files, which
    exist on the USB device node.
    """
    name = os.path.basename(event_path)
    sysfs = os.path.realpath(f'/sys/class/input/{name}/device')
    for _ in range(8):  # bounded walk; USB node is usually 3-5 levels up
        vid_file = os.path.join(sysfs, 'idVendor')
        pid_file = os.path.join(sysfs, 'idProduct')
        if os.path.isfile(vid_file) and os.path.isfile(pid_file):
            try:
                with open(vid_file, 'r') as f:
                    vid = int(f.read().strip(), 16)
                with open(pid_file, 'r') as f:
                    pid = int(f.read().strip(), 16)
                return (vid, pid)
            except (OSError, ValueError):
                return None
        parent = os.path.dirname(sysfs)
        if parent == sysfs or parent in ('', '/'):
            return None
        sysfs = parent
    return None
