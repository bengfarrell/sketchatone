"""Asynchronous NetworkManager integration using private keyfiles."""

from __future__ import annotations

import asyncio
import configparser
import copy
import inspect
import ipaddress
import os
import platform
import shutil
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .config import NetworkConfigStore


class NetworkCommandError(RuntimeError):
    """An nmcli operation failed with a safe, actionable error message."""


class NetworkManager:
    """Manage prioritized Wi-Fi, a fallback hotspot, and USB tether discovery."""

    MAX_ATTEMPT_SECONDS = 20 * 122
    KEYFILE_DIRECTORY = "/run/NetworkManager/system-connections"
    MONITOR_INTERVAL_SECONDS = 5
    USB_DRIVERS = {"ipheth", "rndis_host", "cdc_ncm", "cdc_ether"}

    def __init__(
        self,
        store: NetworkConfigStore,
        on_status: Callable[[dict[str, Any]], Any] | None = None,
        *,
        sys_class_net: str | os.PathLike[str] = "/sys/class/net",
    ):
        self.store = store
        self.on_status = on_status
        self.sys_class_net = Path(sys_class_net)
        self._nmcli = shutil.which("nmcli")
        self._active_config: dict[str, Any] | None = None
        self.status: dict[str, Any] = {
            "supported": platform.system() == "Linux" and self._nmcli is not None,
            "enabled": False,
            "state": "disabled",
            "mode": "disabled",
            "phase": "disabled",
            "busy": False,
            "connected": False,
            "interface": None,
            "activeConnection": None,
            "addresses": [],
            "usbEnabled": False,
            "usbInterfaces": [],
            "usbConnectedInterfaces": [],
            "usbError": None,
            "usb": {
                "enabled": False,
                "interfaces": [],
                "connectedInterfaces": [],
                "error": None,
            },
            "message": "Network management is disabled.",
            "error": None,
        }
        self._task: asyncio.Task[None] | None = None
        self._apply_task: asyncio.Task[dict[str, Any]] | None = None
        self._lock: asyncio.Lock | None = None
        self._enabled = False
        self._usb_attempted_interfaces: set[str] = set()

    @property
    def busy(self) -> bool:
        """Whether a settings transition is currently in progress."""
        return bool(self.status.get("busy"))

    async def start(self) -> None:
        if self.busy or (self._task is not None and not self._task.done()):
            return
        config = self.store.load()
        self._active_config = copy.deepcopy(config)
        supported = platform.system() == "Linux" and self._nmcli is not None
        if not config["enabled"]:
            self._enabled = False
            await self._cancel_background_task()
            await self._set_status(
                supported=supported,
                enabled=False,
                state="disabled",
                connected=False,
                usbEnabled=config["usb"]["enabled"],
                message="Network management is disabled.",
                error=None,
            )
            return

        self._enabled = True
        self._usb_attempted_interfaces.clear()
        if platform.system() != "Linux" or self._nmcli is None:
            await self._set_status(
                supported=False,
                enabled=True,
                state="unsupported",
                connected=False,
                message="Network management requires Linux with NetworkManager's nmcli installed.",
                error="Install and enable NetworkManager to use device networking.",
                usbEnabled=config["usb"]["enabled"],
                usbInterfaces=self._discover_usb_interfaces(),
            )
            return

        await self._set_status(
            supported=True,
            enabled=True,
            state="starting",
            busy=True,
            connected=False,
            interface=config["wifi"]["interface"],
            usbEnabled=config["usb"]["enabled"],
            usbInterfaces=self._discover_usb_interfaces(),
            message="Applying saved network settings.",
            error=None,
        )
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._startup_and_monitor(config))

    async def stop(self) -> None:
        self._enabled = False
        await self._cancel_background_task()
        await self._set_status(
            enabled=False,
            state="stopped",
            busy=False,
            connected=False,
            message="Network manager stopped; the active system connection was left unchanged.",
            error=None,
        )

    async def _cancel_background_task(self) -> None:
        current_task = asyncio.current_task()
        for attribute in ("_task", "_apply_task"):
            task = getattr(self, attribute)
            setattr(self, attribute, None)
            if task is None:
                continue
            if task is current_task:
                setattr(self, attribute, task)
                continue
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _apply_now(self, config: dict[str, Any]) -> dict[str, Any]:
        if not config["enabled"]:
            self._enabled = False
            await self._cancel_background_task()
            await self._set_status(
                enabled=False,
                state="disabled",
                connected=False,
                usbEnabled=config["usb"]["enabled"],
                message="Network management is disabled.",
                error=None,
            )
            return dict(self.status)
        self._enabled = True
        self._usb_attempted_interfaces.clear()
        if platform.system() != "Linux" or self._nmcli is None:
            await self._set_status(
                supported=False,
                enabled=True,
                state="unsupported",
                connected=False,
                message="Network management requires Linux with NetworkManager's nmcli installed.",
                error="Install and enable NetworkManager to use device networking.",
                usbEnabled=config["usb"]["enabled"],
                usbInterfaces=self._discover_usb_interfaces(),
            )
            return dict(self.status)
        async with self._get_lock():
            await self._apply_configuration(config, reconnect=False)
        return dict(self.status)

    async def apply(self) -> dict[str, Any]:
        """Schedule one apply attempt and return immediately with busy status."""
        if self.busy:
            raise RuntimeError("Network settings are already being applied")
        config = self.store.load()
        if not config["enabled"]:
            self._active_config = copy.deepcopy(config)
            return await self._apply_now(config)
        if platform.system() != "Linux" or self._nmcli is None:
            await self._set_status(
                supported=False,
                enabled=True,
                state="unsupported",
                connected=False,
                message="Network management requires Linux with NetworkManager's nmcli installed.",
                error="Install and enable NetworkManager to use device networking.",
                usbEnabled=config["usb"]["enabled"],
                usbInterfaces=self._discover_usb_interfaces(),
            )
            raise RuntimeError(self.status["error"])
        self._active_config = copy.deepcopy(config)
        self._enabled = True
        await self._set_status(
            enabled=True,
            supported=True,
            state="starting",
            busy=True,
            message="Applying saved network settings.",
            error=None,
        )
        self._apply_task = asyncio.create_task(self._apply_requested(config))
        return copy.deepcopy(self.status)

    async def request_apply(self) -> dict[str, Any]:
        """Compatibility alias for the nonblocking apply operation."""
        return await self.apply()

    async def _apply_requested(self, config: dict[str, Any]) -> dict[str, Any]:
        try:
            return await self._apply_now(config)
        finally:
            await self._set_status(busy=False)
            if self._enabled and (self._task is None or self._task.done()):
                self._task = asyncio.create_task(self._monitor())

    async def _startup_and_monitor(self, config: dict[str, Any]) -> None:
        try:
            await self._apply_now(config)
        finally:
            await self._set_status(busy=False)
        await self._monitor()

    async def _monitor(self) -> None:
        while self._enabled:
            await asyncio.sleep(self.MONITOR_INTERVAL_SECONDS)
            await self._monitor_once()

    async def _monitor_once(self) -> None:
        if not self._enabled or self.status.get("busy"):
            return
        config = copy.deepcopy(self._active_config)
        if config is None:
            return
        usb_interfaces = self._discover_usb_interfaces()
        new_usb_interfaces = usb_interfaces
        self._usb_attempted_interfaces.intersection_update(usb_interfaces)
        connected_usb = [
            interface for interface in self.status.get("usbConnectedInterfaces", [])
            if interface in usb_interfaces
        ]
        if usb_interfaces != self.status.get("usbInterfaces"):
            await self._set_status(
                usbInterfaces=usb_interfaces, usbConnectedInterfaces=connected_usb,
            )
        if new_usb_interfaces and config["usb"]["enabled"]:
            await self._set_status(busy=True)
            try:
                async with self._get_lock():
                    await self._connect_usb_tethers(config, new_usb_interfaces)
            finally:
                await self._set_status(busy=False)
        if not config["wifi"]["enabled"]:
            return
        if not self.status.get("connected"):
            await self._set_status(busy=True)
            try:
                async with self._get_lock():
                    await self._apply_configuration(config, reconnect=True)
            finally:
                await self._set_status(busy=False)
            return
        if self.status.get("state") == "hotspot":
            return
        try:
            output = await self._run(
                "device status",
                "device",
                "status",
                timeout=8,
                extra=("-t", "-f", "DEVICE,STATE"),
            )
        except (NetworkCommandError, asyncio.TimeoutError) as error:
            await self._set_status(
                state="error",
                connected=False,
                message="Could not check the Wi-Fi connection.",
                error=self._safe_error(str(error), config),
            )
            return
        interface = config["wifi"]["interface"]
        is_connected = any(
            line.split(":", 2)[0] == interface
            and line.split(":", 2)[1].lower().startswith("connected")
            for line in output.splitlines()
            if line.count(":") >= 1
        )
        if is_connected:
            return

        grace = config["wifi"]["reconnectGrace"]
        await self._set_status(
            state="reconnecting",
            busy=True,
            connected=False,
            message="Wi-Fi was lost; trying saved networks before enabling the hotspot.",
            error=None,
        )
        async with self._get_lock():
            try:
                if grace:
                    await asyncio.sleep(grace)
                    output = await self._run(
                        "device status", "device", "status", timeout=8,
                        extra=("-t", "-f", "DEVICE,STATE"),
                    )
                    if any(
                        line.partition(":")[0] == interface
                        and line.partition(":")[2].lower().startswith("connected")
                        for line in output.splitlines()
                    ):
                        await self._set_status(state="wifi", connected=True, error=None)
                        return
                await self._apply_configuration(config, reconnect=True)
            except NetworkCommandError as error:
                await self._set_status(
                    state="error", connected=False,
                    message="Could not restore the Wi-Fi connection.",
                    error=self._safe_error(str(error), config),
                )
            finally:
                await self._set_status(busy=False)

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def _apply_configuration(
        self,
        config: dict[str, Any],
        *,
        reconnect: bool,
        time_limit: int | None = None,
    ) -> None:
        wifi = config["wifi"]
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.MAX_ATTEMPT_SECONDS
        hotspot_reserve = min(wifi["connectionTimeout"], 15)
        wifi_budget = min(
            max(0, self.MAX_ATTEMPT_SECONDS - hotspot_reserve - 8),
            len(wifi["networks"]) * (wifi["connectionTimeout"] + 2),
        )
        if not wifi["enabled"]:
            await self._connect_usb_tethers(config)
            await self._set_status(
                enabled=True,
                state="disabled",
                connected=False,
                interface=wifi["interface"],
                usbEnabled=config["usb"]["enabled"],
                usbInterfaces=self._discover_usb_interfaces(),
                message="Wi-Fi networking is disabled; USB tether management remains available.",
                error=None,
            )
            return
        try:
            previous_connections = await self._snapshot_active_connections(wifi["interface"])
        except (NetworkCommandError, asyncio.TimeoutError) as error:
            detail = self._safe_error(str(error), config)
            await self._set_status(
                state="error",
                connected=False,
                message=(
                    "Could not preserve the current connection before applying settings: "
                    f"{detail}"
                ),
                error=detail,
                usbEnabled=config["usb"]["enabled"],
                usbInterfaces=self._discover_usb_interfaces(),
            )
            return
        wifi_deadline = loop.time() + min(
            wifi_budget, time_limit if time_limit is not None else wifi_budget,
        )
        wifi_deadline = min(wifi_deadline, deadline - hotspot_reserve)
        errors: list[str] = []
        for network in wifi["networks"]:
            remaining = wifi_deadline - loop.time()
            if remaining <= 0:
                errors.append("The Wi-Fi reconnect time limit was reached.")
                break
            allowed = min(wifi["connectionTimeout"], remaining)
            try:
                connection_uuid = await self._install_and_activate(
                    self._wifi_keyfile(network, wifi["interface"]),
                    f"sketchnet-wifi-{network['id']}",
                    wifi["interface"],
                    timeout=allowed,
                )
            except (NetworkCommandError, asyncio.TimeoutError) as error:
                errors.append(
                    f"Wi-Fi profile {network['id']}: "
                    f"{self._safe_error(str(error), config)}"
                )
                continue
            await self._connection_succeeded(
                "wifi", wifi["interface"], connection_uuid, deadline
            )
            return

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining > 0:
            hotspot = wifi["hotspot"]
            try:
                connection_uuid = await self._install_and_activate(
                    self._hotspot_keyfile(config),
                    "sketchnet-hotspot",
                    wifi["interface"],
                    timeout=min(wifi["connectionTimeout"], remaining),
                )
            except (NetworkCommandError, asyncio.TimeoutError) as error:
                errors.append(f"Hotspot: {self._safe_error(str(error), config)}")
            else:
                await self._connection_succeeded(
                    "hotspot",
                    wifi["interface"],
                    connection_uuid,
                    deadline,
                )
                return
        else:
            errors.append("The total network connection time limit was reached.")

        detail = "; ".join(errors) if errors else "No Wi-Fi networks are configured."
        restore_error = await self._restore_active_connections(
            previous_connections, deadline
        )
        if restore_error:
            detail = (
                f"{detail}; restoring the previous connection also failed: "
                f"{self._safe_error(restore_error, config)}"
            )
        await self._connect_usb_tethers(config)
        verb = "Reconnect failed" if reconnect else "Network setup failed"
        await self._set_status(
            state="error",
            connected=False,
            message=f"{verb}: {detail}",
            error=detail,
            usbEnabled=config["usb"]["enabled"],
            usbInterfaces=self._discover_usb_interfaces(),
        )

    async def _install_and_activate(
        self,
        contents: str,
        name_prefix: str,
        interface: str,
        *,
        timeout: float,
    ) -> str:
        try:
            return await self._write_and_activate(
                contents, name_prefix, interface, timeout=timeout,
            )
        except OSError as error:
            raise NetworkCommandError(
                f"Could not provision the network profile: {error.strerror or 'filesystem error'}. "
                "Network management requires permission to write NetworkManager runtime profiles."
            ) from error

    async def _write_and_activate(
        self,
        contents: str,
        name_prefix: str,
        interface: str,
        *,
        timeout: float,
    ) -> str:
        deadline = asyncio.get_running_loop().time() + timeout
        connection_uuid = str(uuid.uuid4())
        connection_name = f"{name_prefix}-{connection_uuid[:8]}"
        contents = contents.replace("\nuuid=@CONNECTION_UUID@\n", f"\nuuid={connection_uuid}\n")
        contents = contents.replace("\nid=@CONNECTION_NAME@\n", f"\nid={connection_name}\n")
        os.makedirs(self.KEYFILE_DIRECTORY, mode=0o700, exist_ok=True)
        descriptor, keyfile_path = tempfile.mkstemp(
            prefix="sketchnet-", suffix=".nmconnection", dir=self.KEYFILE_DIRECTORY,
        )
        activated = False
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as keyfile:
                keyfile.write(contents)
                keyfile.flush()
                os.fsync(keyfile.fileno())
            await self._run(
                "load connection keyfile",
                "--wait",
                str(max(1, int(timeout))),
                "connection",
                "load",
                keyfile_path,
                timeout=max(0.01, deadline - asyncio.get_running_loop().time()),
            )
            await self._run(
                "activate connection",
                "--wait",
                str(max(1, int(timeout))),
                "connection",
                "up",
                "uuid",
                connection_uuid,
                "ifname",
                interface,
                timeout=max(0.01, deadline - asyncio.get_running_loop().time()),
            )
            activated = True
        except (NetworkCommandError, asyncio.TimeoutError) as error:
            try:
                await self._run(
                    "remove failed connection",
                    "connection",
                    "delete",
                    "uuid",
                    connection_uuid,
                    timeout=2,
                )
            except (NetworkCommandError, asyncio.TimeoutError) as cleanup_error:
                raise NetworkCommandError(
                    f"{error}; failed candidate cleanup: {cleanup_error}"
                ) from error
            raise
        except asyncio.CancelledError:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining > 0:
                try:
                    await self._run(
                        "remove cancelled connection",
                        "connection",
                        "delete",
                        "uuid",
                        connection_uuid,
                        timeout=min(2, remaining),
                    )
                except (NetworkCommandError, asyncio.TimeoutError) as cleanup_error:
                    await self._set_status(
                        state="error",
                        connected=False,
                        message="Could not clean up the interrupted network profile.",
                        error=self._safe_error(
                            str(cleanup_error), self._active_config or {}
                        ),
                    )
            raise
        finally:
            if not activated and os.path.exists(keyfile_path):
                os.unlink(keyfile_path)
        return connection_uuid

    async def _connection_succeeded(
        self,
        state: str,
        interface: str,
        connection_uuid: str,
        deadline: float,
    ) -> None:
        cleanup_warning = await self._cleanup_owned_connections(connection_uuid, deadline)
        config = self._active_config or {}
        await self._connect_usb_tethers(config)
        addresses, address_error = await self._interface_addresses(interface)
        if address_error:
            cleanup_warning = "; ".join(filter(None, (cleanup_warning, address_error)))
        message = (
            "Connected to a configured Wi-Fi network."
            if state == "wifi"
            else "Password-protected hotspot is active."
        )
        if cleanup_warning:
            message = f"{message} {cleanup_warning}"
        await self._set_status(
            state=state,
            connected=True,
            interface=interface,
            activeConnection=state,
            addresses=addresses,
            usbEnabled=config["usb"]["enabled"],
            message=message,
            error=cleanup_warning,
            usbInterfaces=self._discover_usb_interfaces(),
        )

    async def _interface_addresses(self, interface: str) -> tuple[list[str], str | None]:
        try:
            output = await self._run(
                "read interface addresses", "device", "show", interface, timeout=5,
                extra=("-g", "IP4.ADDRESS"),
            )
        except NetworkCommandError as error:
            return [], str(error)
        addresses = []
        for line in output.splitlines():
            try:
                address = ipaddress.IPv4Interface(line)
            except ValueError:
                continue
            addresses.append(str(address))
        return addresses, None

    async def _cleanup_owned_connections(
        self, keep_uuid: str, deadline: float
    ) -> str | None:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return (
                "The network operation time limit was reached before old profiles "
                "could be cleaned up."
            )
        try:
            output = await self._run(
                "list Sketchatone connections",
                "connection",
                "show",
                timeout=min(8, remaining),
                extra=("-t", "-f", "NAME,UUID"),
            )
        except (NetworkCommandError, asyncio.TimeoutError) as error:
            return (
                "Could not list old Sketchatone connections: "
                f"{self._safe_error(str(error), self._active_config or {})}"
            )
        failures = []
        for line in output.splitlines():
            name, separator, connection_uuid = line.partition(":")
            if (
                separator
                and self._is_owned_connection(name, connection_uuid)
                and not name.startswith("sketchnet-usb-")
                and connection_uuid != keep_uuid
            ):
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    failures.append("the profile cleanup time limit was reached")
                    break
                try:
                    await self._run(
                        "remove old Sketchatone connection",
                        "connection",
                        "delete",
                        "uuid",
                        connection_uuid,
                        timeout=min(8, remaining),
                    )
                except (NetworkCommandError, asyncio.TimeoutError) as error:
                    failures.append(
                        self._safe_error(str(error), self._active_config or {})
                    )
        if failures:
            return "Could not remove an old Sketchatone profile: " + "; ".join(failures)
        return None

    async def _connect_usb_tethers(
        self,
        config: dict[str, Any],
        interfaces: list[str] | None = None,
    ) -> None:
        if not config["usb"]["enabled"]:
            await self._set_status(
                usbEnabled=False,
                usbConnectedInterfaces=[],
                usbError=None,
            )
            await self._set_status(
                usbEnabled=False, usbConnectedInterfaces=[], usbAddresses=[], usbError=None,
            )
            return
        candidates = interfaces if interfaces is not None else self._discover_usb_interfaces()
        connected = set(self.status.get("usbConnectedInterfaces", []))
        failures = []
        deadline = asyncio.get_running_loop().time() + 20
        for interface in candidates:
            connected.discard(interface)
            self._usb_attempted_interfaces.add(interface)
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                failures.append("USB tether connection time limit reached.")
                break
            try:
                device_status = await self._run(
                    "check USB tether",
                    "device",
                    "status",
                    timeout=min(5, remaining),
                    extra=("-t", "-f", "DEVICE,STATE"),
                )
            except (NetworkCommandError, asyncio.TimeoutError) as error:
                failures.append(self._safe_error(str(error), config))
                continue
            if any(
                line.partition(":")[0] == interface
                and line.partition(":")[2].lower().startswith("connected")
                for line in device_status.splitlines()
                if ":" in line
            ):
                connected.add(interface)
                continue

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                failures.append(f"{interface}: USB tether connection time limit reached.")
                break
            try:
                connection_uuid = await self._install_and_activate(
                    self._ethernet_keyfile(interface),
                    f"sketchnet-usb-{interface.encode('utf-8').hex()}",
                    interface,
                    timeout=min(8, remaining),
                )
            except (NetworkCommandError, asyncio.TimeoutError) as error:
                failures.append(f"{interface}: {self._safe_error(str(error), config)}")
                continue
            connected.add(interface)
            cleanup_error = await self._cleanup_usb_profiles(
                interface, connection_uuid, deadline
            )
            if cleanup_error:
                failures.append(cleanup_error)
        addresses = []
        for interface in sorted(connected):
            interface_addresses, address_error = await self._interface_addresses(interface)
            addresses.extend(interface_addresses)
            if address_error:
                failures.append(self._safe_error(address_error, config))
        await self._set_status(
            usbEnabled=True,
            usbInterfaces=self._discover_usb_interfaces(),
            usbConnectedInterfaces=sorted(connected),
            usbAddresses=addresses,
            usbError="; ".join(failures) if failures else None,
        )

    async def _cleanup_usb_profiles(
        self, interface: str, keep_uuid: str, deadline: float
    ) -> str | None:
        prefix = f"sketchnet-usb-{interface.encode('utf-8').hex()}-"
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return "USB tether time limit reached before old profiles could be cleaned up."
        try:
            output = await self._run(
                "list owned USB tether connections",
                "connection",
                "show",
                timeout=min(5, remaining),
                extra=("-t", "-f", "NAME,UUID"),
            )
        except (NetworkCommandError, asyncio.TimeoutError) as error:
            return self._safe_error(
                str(error), self._active_config or {}
            )
        for line in output.splitlines():
            name, separator, connection_uuid = line.partition(":")
            if (
                separator
                and name.startswith(prefix)
                and self._is_owned_connection(name, connection_uuid)
                and connection_uuid != keep_uuid
            ):
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    return "USB tether time limit reached before old profiles could be cleaned up."
                try:
                    await self._run(
                        "remove old USB tether connection",
                        "connection",
                        "delete",
                        "uuid",
                        connection_uuid,
                        timeout=min(5, remaining),
                    )
                except (NetworkCommandError, asyncio.TimeoutError) as error:
                    return self._safe_error(
                        str(error), self._active_config or {}
                    )
        return None

    @staticmethod
    def _is_owned_connection(name: str, connection_uuid: str) -> bool:
        if not name.startswith(
            ("sketchnet-wifi-", "sketchnet-hotspot-", "sketchnet-usb-")
        ):
            return False
        try:
            parsed_uuid = uuid.UUID(connection_uuid)
        except ValueError:
            return False
        return name.rsplit("-", 1)[-1].lower() == str(parsed_uuid)[:8]

    async def _snapshot_active_connections(self, interface: str) -> list[str]:
        output = await self._run(
            "snapshot active connections",
            "connection",
            "show",
            "--active",
            timeout=8,
            extra=("-t", "-f", "UUID,DEVICE"),
        )
        active = []
        for line in output.splitlines():
            connection_uuid, separator, device = line.partition(":")
            if separator and device == interface and connection_uuid.strip():
                active.append(connection_uuid.strip())
        return active[:1]

    async def _restore_active_connections(
        self, connection_uuids: list[str], deadline: float
    ) -> str | None:
        failures = []
        for connection_uuid in connection_uuids:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                failures.append("the network operation time limit was reached")
                break
            try:
                await self._run(
                    "restore previous connection",
                    "connection",
                    "up",
                    "uuid",
                    connection_uuid,
                    timeout=min(10, remaining),
                )
            except (NetworkCommandError, asyncio.TimeoutError) as error:
                failures.append(str(error))
        return "; ".join(failures) if failures else None

    async def _run(
        self,
        operation: str,
        *arguments: str,
        timeout: float,
        extra: tuple[str, ...] = (),
    ) -> str:
        if self._nmcli is None:
            raise NetworkCommandError("nmcli is not installed")
        try:
            process = await asyncio.create_subprocess_exec(
                self._nmcli,
                *extra,
                *arguments,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "LC_ALL": "C"},
            )
        except OSError as error:
            raise NetworkCommandError(
                f"{operation}: could not start nmcli ({error.strerror or 'execution failed'})"
            ) from error
        communication = asyncio.create_task(process.communicate())
        try:
            stdout, stderr = await asyncio.wait_for(
                asyncio.shield(communication), timeout=timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await communication
            raise NetworkCommandError(
                f"{operation}: timed out after {timeout:g} seconds"
            ) from None
        except asyncio.CancelledError:
            process.kill()
            await communication
            raise
        if process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip()
            if not detail:
                detail = f"nmcli exited with status {process.returncode}"
            raise NetworkCommandError(f"{operation}: {detail}")
        return stdout.decode("utf-8", errors="replace")

    def _wifi_keyfile(self, network: dict[str, Any], interface: str) -> str:
        return self._keyfile(
            ssid=network["ssid"],
            password=network["password"],
            interface=interface,
            hidden=network["hidden"],
        )

    def _hotspot_keyfile(self, config: dict[str, Any]) -> str:
        hotspot = config["wifi"]["hotspot"]
        return self._keyfile(
            ssid=hotspot["ssid"],
            password=hotspot["password"],
            interface=config["wifi"]["interface"],
            ap_address=hotspot["address"],
        )

    @staticmethod
    def _ethernet_keyfile(interface: str) -> str:
        parser = configparser.ConfigParser(interpolation=None, strict=True)
        parser.optionxform = str
        parser["connection"] = {
            "id": "@CONNECTION_NAME@",
            "uuid": "@CONNECTION_UUID@",
            "type": "ethernet",
            "interface-name": interface,
            "autoconnect": "false",
        }
        parser["ethernet"] = {}
        parser["ipv4"] = {"method": "auto", "may-fail": "false"}
        parser["ipv6"] = {"method": "auto"}
        from io import StringIO

        output = StringIO()
        parser.write(output, space_around_delimiters=False)
        return output.getvalue()

    @staticmethod
    def _keyfile(
        *,
        ssid: str,
        password: str | None,
        interface: str,
        hidden: bool = False,
        ap_address: str | None = None,
    ) -> str:
        connection_uuid = "@CONNECTION_UUID@"
        connection_name = "@CONNECTION_NAME@"

        def escape(value: str) -> str:
            escaped = (
                value.replace("\\", "\\\\")
                .replace("\n", "\\n")
                .replace("\t", "\\t")
                .replace("\r", "\\r")
            )
            if escaped.startswith(" "):
                escaped = "\\s" + escaped[1:]
            if escaped.endswith(" "):
                escaped = escaped[:-1] + "\\s"
            return escaped

        parser = configparser.ConfigParser(interpolation=None, strict=True)
        parser.optionxform = str
        parser["connection"] = {
            "id": escape(connection_name),
            "uuid": connection_uuid,
            "type": "wifi",
            "interface-name": escape(interface),
            "autoconnect": "false",
        }
        parser["wifi"] = {
            "mode": "ap" if ap_address else "infrastructure",
            "ssid": escape(ssid),
        }
        if hidden:
            parser["wifi"]["hidden"] = "true"
        if password:
            parser["wifi-security"] = {"key-mgmt": "wpa-psk", "psk": escape(password)}
        parser["ipv4"] = {"method": "shared" if ap_address else "auto", "may-fail": "false"}
        if ap_address:
            parsed_address = ipaddress.IPv4Interface(ap_address)
            parser["ipv4"]["address1"] = f"{parsed_address.ip}/{parsed_address.network.prefixlen}"
        parser["ipv6"] = {"method": "auto"}
        from io import StringIO

        output = StringIO()
        parser.write(output, space_around_delimiters=False)
        return output.getvalue()

    def _safe_error(self, message: str, config: dict[str, Any]) -> str:
        wifi = config.get("wifi", {})
        networks = wifi.get("networks", []) if isinstance(wifi, dict) else []
        secrets_to_redact = [
            item["password"]
            for item in networks
            if isinstance(item, dict) and item.get("password")
        ]
        hotspot = wifi.get("hotspot", {}) if isinstance(wifi, dict) else {}
        if isinstance(hotspot, dict) and hotspot.get("password"):
            secrets_to_redact.append(hotspot["password"])
        for secret in secrets_to_redact:
            message = message.replace(secret, "[redacted]")
        return message

    def _discover_usb_interfaces(self) -> list[str]:
        interfaces = []
        if not self.sys_class_net.is_dir():
            return interfaces
        for entry in self.sys_class_net.iterdir():
            device = entry / "device"
            if not device.exists():
                continue
            resolved = device.resolve()
            path_parts = {part.lower() for part in resolved.parts}
            driver_path = resolved / "driver"
            try:
                driver = driver_path.resolve().name.lower()
            except OSError:
                driver = ""
            is_usb_path = any(part == "usb" or part.startswith("usb") for part in path_parts)
            if (driver in self.USB_DRIVERS or is_usb_path) and not (entry / "wireless").exists():
                interfaces.append(entry.name)
        return sorted(interfaces)

    async def _set_status(self, **updates: Any) -> None:
        self.status.update(updates)
        state = self.status.get("state", "disabled")
        self.status["mode"] = {
            "stopped": "disabled",
            "starting": "connecting",
            "reconnecting": "connecting",
            "wifi": "wifi",
            "hotspot": "hotspot",
            "disabled": "disabled",
            "unsupported": "unsupported",
            "error": "error",
        }.get(state, "error")
        self.status["phase"] = state
        interfaces = self.status.get("usbInterfaces", [])
        connected_interfaces = self.status.get("usbConnectedInterfaces", [])
        self.status["usb"] = {
            "enabled": self.status.get("usbEnabled", False),
            "interfaces": list(interfaces),
            "connectedInterfaces": list(connected_interfaces),
            "error": self.status.get("usbError"),
            "addresses": list(self.status.get("usbAddresses", [])),
        }
        if self.status.get("state") == "hotspot":
            config = self._active_config or {}
            hotspot = config.get("wifi", {}).get("hotspot", {})
            if hotspot.get("address"):
                self.status["addresses"] = [hotspot["address"]]
        elif "state" in updates and "addresses" not in updates:
            self.status["addresses"] = []
        if self.on_status is None:
            return
        result = self.on_status(copy.deepcopy(self.status))
        if inspect.isawaitable(result):
            await result
