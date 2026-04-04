"""
Keyboard Listener for Server-Side Input

System-level keyboard listener that works with systemd services.
Uses evdev on Linux or pynput on macOS for global keyboard capture.
Requires root/sudo permissions or accessibility permissions on macOS.
"""

import sys
import threading
import platform
from typing import Callable, Dict, Optional


class KeyboardListener:
    """
    System-level keyboard listener that maps keys to button events.

    - On Linux: Uses evdev to read from /dev/input/event* (requires root)
    - On macOS: Uses pynput for global keyboard hooks (requires accessibility permissions or root)
    - On Windows: Uses pynput (not tested)

    Works with systemd services and background processes.
    """

    def __init__(
        self,
        enabled: bool,
        mappings: Dict[str, str],
        on_button_press: Callable[[str], None],
        on_button_release: Callable[[str], None]
    ):
        self.enabled = enabled
        self.mappings = mappings
        self.on_button_press = on_button_press
        self.on_button_release = on_button_release
        self.running = False
        self.listener = None
        self.system = platform.system()

    def start(self) -> None:
        """Start listening to keyboard input"""
        if not self.enabled or not self.mappings:
            return

        self.running = True

        # Choose implementation based on platform
        if self.system == "Linux":
            self._start_linux()
        elif self.system == "Darwin":  # macOS
            self._start_macos()
        else:
            print(f'[Keyboard] Warning: Platform {self.system} not fully tested')
            self._start_macos()  # Try pynput as fallback

    def stop(self) -> None:
        """Stop listening to keyboard input"""
        self.running = False

        if self.listener:
            try:
                if hasattr(self.listener, 'stop'):
                    self.listener.stop()
                elif hasattr(self.listener, 'close'):
                    self.listener.close()
            except:
                pass

    def _start_linux(self) -> None:
        """Start Linux evdev-based keyboard listener"""
        try:
            import evdev
            from evdev import InputDevice, categorize, ecodes

            # Find keyboard devices
            devices = [InputDevice(path) for path in evdev.list_devices()]
            keyboards = []
            for device in devices:
                # Look for devices with keyboard capabilities
                caps = device.capabilities()
                if ecodes.EV_KEY in caps:
                    # Check if it has letter keys (likely a keyboard)
                    keys = caps[ecodes.EV_KEY]
                    if ecodes.KEY_A in keys or ecodes.KEY_1 in keys:
                        keyboards.append(device)

            if not keyboards:
                print('[Keyboard] No keyboard devices found')
                print('[Keyboard] Available devices:')
                for device in devices:
                    print(f'  - {device.path}: {device.name}')
                return

            # Use the first keyboard found
            keyboard = keyboards[0]
            print(f'[Keyboard] Listening on: {keyboard.name} ({keyboard.path})')
            print(f'[Keyboard] Key mappings: {self.mappings}')
            print('[Keyboard] Note: Requires root/sudo permissions')

            # Start listening thread
            thread = threading.Thread(target=self._linux_listen_loop, args=(keyboard,), daemon=True)
            thread.start()

        except ImportError:
            print('[Keyboard] ERROR: evdev not installed')
            print('[Keyboard] Install with: pip install evdev')
            print('[Keyboard] Note: Requires root/sudo to access /dev/input/event*')
        except PermissionError as e:
            print(f'[Keyboard] ERROR: Permission denied - {e}')
            print('[Keyboard] Run with sudo or add user to input group:')
            print('[Keyboard]   sudo usermod -a -G input $USER')
        except Exception as e:
            print(f'[Keyboard] ERROR: {e}')

    def _linux_listen_loop(self, keyboard) -> None:
        """Linux evdev listening loop"""
        from evdev import categorize, ecodes

        # Map evdev keycodes to character strings
        keycode_map = {
            ecodes.KEY_1: '1', ecodes.KEY_2: '2', ecodes.KEY_3: '3', ecodes.KEY_4: '4',
            ecodes.KEY_5: '5', ecodes.KEY_6: '6', ecodes.KEY_7: '7', ecodes.KEY_8: '8',
            ecodes.KEY_9: '9', ecodes.KEY_0: '0',
        }

        try:
            for event in keyboard.read_loop():
                if not self.running:
                    break

                if event.type == ecodes.EV_KEY:
                    key_event = categorize(event)

                    # Map keycode to character
                    char = keycode_map.get(key_event.keycode)
                    if not char:
                        continue

                    # Check if mapped to a button
                    button_id = self.mappings.get(char)
                    if not button_id:
                        continue

                    # Handle press/release
                    if key_event.keystate == key_event.key_down:
                        self.on_button_press(button_id)
                    elif key_event.keystate == key_event.key_up:
                        self.on_button_release(button_id)
        except Exception as e:
            if self.running:
                print(f'[Keyboard] Error in listen loop: {e}')

    def _start_macos(self) -> None:
        """Start macOS pynput-based keyboard listener"""
        try:
            from pynput import keyboard

            print('[Keyboard] Starting macOS keyboard listener')
            print(f'[Keyboard] Key mappings: {self.mappings}')
            print('[Keyboard] Note: May require Accessibility permissions or sudo')

            def on_press(key):
                try:
                    # Try to get the character
                    char = None
                    if hasattr(key, 'char') and key.char:
                        char = key.char
                    elif hasattr(key, 'name'):
                        char = key.name

                    if not char:
                        return

                    # Check if mapped to a button
                    button_id = self.mappings.get(char)
                    if button_id:
                        self.on_button_press(button_id)
                except Exception as e:
                    pass  # Ignore errors in callback

            def on_release(key):
                try:
                    # Try to get the character
                    char = None
                    if hasattr(key, 'char') and key.char:
                        char = key.char
                    elif hasattr(key, 'name'):
                        char = key.name

                    if not char:
                        return

                    # Check if mapped to a button
                    button_id = self.mappings.get(char)
                    if button_id:
                        self.on_button_release(button_id)
                except Exception as e:
                    pass  # Ignore errors in callback

            # Create and start listener
            self.listener = keyboard.Listener(
                on_press=on_press,
                on_release=on_release
            )
            self.listener.start()

        except ImportError:
            print('[Keyboard] ERROR: pynput not installed')
            print('[Keyboard] Install with: pip install pynput')
        except Exception as e:
            print(f'[Keyboard] ERROR: {e}')
            print('[Keyboard] On macOS, you may need to:')
            print('[Keyboard]   1. Grant Accessibility permissions in System Preferences')
            print('[Keyboard]   2. Or run with sudo')

    def update_config(self, enabled: bool, mappings: Dict[str, str]) -> None:
        """Update configuration"""
        was_enabled = self.enabled
        self.enabled = enabled
        self.mappings = mappings

        if not was_enabled and enabled:
            # Start if we weren't enabled before
            self.start()
        elif was_enabled and not enabled:
            # Stop if we were enabled before
            self.stop()
