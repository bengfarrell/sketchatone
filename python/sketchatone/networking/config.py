"""Private, device-level network configuration storage."""

from __future__ import annotations

import copy
import ipaddress
import json
import os
import re
import tempfile
from typing import Any


def _default_config() -> dict[str, Any]:
    return {
        "enabled": False,
        "wifi": {
            "enabled": True,
            "interface": "wlan0",
            "connectionTimeout": 15,
            "reconnectGrace": 10,
            "networks": [],
            "hotspot": {
                "ssid": "Sketchatone",
                "password": "",
                "address": "192.168.50.1/24",
            },
        },
        "usb": {"enabled": False},
    }


def _bounded_integer(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{field} must be an integer from {minimum} to {maximum}")
    return value


def _text(value: Any, field: str, *, maximum: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum:
        raise ValueError(f"{field} must be text no longer than {maximum} UTF-8 bytes")
    if not allow_empty and not value:
        raise ValueError(f"{field} cannot be empty")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f"{field} cannot contain control characters")
    return value


class NetworkConfigStore:
    """Load and atomically persist Wi-Fi and USB-tether device settings."""

    def __init__(self, path: str | os.PathLike[str]):
        self.path = os.path.abspath(os.path.expanduser(os.fspath(path)))
        self._config: dict[str, Any] | None = None

    @property
    def config(self) -> dict[str, Any]:
        """Return a defensive copy of the full, secret-bearing device config."""
        return self.load()

    def load(self) -> dict[str, Any]:
        defaults = self._config if self._config is not None else _default_config()
        try:
            with open(self.path, "r", encoding="utf-8") as config_file:
                raw = json.load(config_file)
        except FileNotFoundError:
            if self._config is None:
                self._config = defaults
        else:
            self._config = self._validated_config(raw, defaults)
            os.chmod(self.path, 0o600)
        return copy.deepcopy(self._config)

    def public_config(self) -> dict[str, Any]:
        config = self.load()
        for network in config["wifi"]["networks"]:
            network["passwordSet"] = bool(network.pop("password", None))
        hotspot = config["wifi"]["hotspot"]
        hotspot["passwordSet"] = bool(hotspot.pop("password", None))
        return config

    def validate(self, submitted: dict[str, Any]) -> dict[str, Any]:
        """Validate a candidate without persisting it; the result includes secrets."""
        if not isinstance(submitted, dict):
            raise ValueError("network configuration must be an object")
        current = self.load()
        merged = copy.deepcopy(current)

        if "enabled" in submitted:
            merged["enabled"] = self._boolean(submitted["enabled"], "enabled")
        wifi_input = submitted.get("wifi", {})
        if not isinstance(wifi_input, dict):
            raise ValueError("wifi must be an object")
        usb_input = submitted.get("usb", {})
        if not isinstance(usb_input, dict):
            raise ValueError("usb must be an object")

        wifi = merged["wifi"]
        for name in ("enabled",):
            if name in wifi_input:
                wifi[name] = self._boolean(wifi_input[name], f"wifi.{name}")
        if "interface" in wifi_input:
            interface = _text(wifi_input["interface"], "wifi.interface", maximum=15)
            if not re.fullmatch(r"[A-Za-z0-9_.:-]+", interface):
                raise ValueError("wifi.interface contains unsupported characters")
            wifi["interface"] = interface
        for name, minimum, maximum in (
            ("connectionTimeout", 1, 120),
            ("reconnectGrace", 0, 300),
        ):
            if name in wifi_input:
                wifi[name] = _bounded_integer(
                    wifi_input[name], f"wifi.{name}", minimum, maximum
                )

        if "networks" in wifi_input:
            submitted_networks = wifi_input["networks"]
            if not isinstance(submitted_networks, list) or len(submitted_networks) > 20:
                raise ValueError("wifi.networks must be a list of at most 20 networks")
            old_by_id = {network["id"]: network for network in wifi["networks"]}
            networks = []
            seen_ids: set[str] = set()
            for item in submitted_networks:
                if not isinstance(item, dict):
                    raise ValueError("each Wi-Fi network must be an object")
                network_id = _text(item.get("id"), "wifi network id", maximum=64)
                if not re.fullmatch(r"[A-Za-z0-9_-]+", network_id):
                    raise ValueError("wifi network id may contain only letters, digits, _ and -")
                if network_id in seen_ids:
                    raise ValueError(f"duplicate Wi-Fi network id: {network_id}")
                seen_ids.add(network_id)
                ssid = _text(item.get("ssid"), "wifi network ssid", maximum=32)
                hidden = self._boolean(item.get("hidden", False), "wifi network hidden")
                password = item.get("password")
                if password is None or password == "":
                    password = old_by_id.get(network_id, {}).get("password")
                elif not isinstance(password, str):
                    raise ValueError("wifi network password must be text")
                if password:
                    self._validate_wifi_password(password, "wifi network password")
                networks.append(
                    {
                        "id": network_id,
                        "ssid": ssid,
                        "hidden": hidden,
                        "password": password,
                    }
                )
            wifi["networks"] = networks

        if "hotspot" in wifi_input:
            hotspot_input = wifi_input["hotspot"]
            if not isinstance(hotspot_input, dict):
                raise ValueError("wifi.hotspot must be an object")
            hotspot = wifi["hotspot"]
            if "ssid" in hotspot_input:
                hotspot["ssid"] = _text(
                    hotspot_input["ssid"], "wifi.hotspot.ssid", maximum=32
                )
            if "address" in hotspot_input:
                address = _text(
                    hotspot_input["address"], "wifi.hotspot.address", maximum=64
                )
                try:
                    ipaddress.IPv4Interface(address)
                except ipaddress.AddressValueError as error:
                    raise ValueError(
                        "wifi.hotspot.address must be an IPv4 interface address"
                    ) from error
                hotspot["address"] = address
            submitted_password = hotspot_input.get("password")
            if submitted_password not in (None, ""):
                self._validate_wifi_password(submitted_password, "wifi.hotspot.password")
                hotspot["password"] = submitted_password

        if "enabled" in usb_input:
            merged["usb"]["enabled"] = self._boolean(usb_input["enabled"], "usb.enabled")

        return self._validated_config(merged)

    def save(self, submitted: dict[str, Any]) -> dict[str, Any]:
        validated = self.validate(submitted)
        self._write_private(validated)
        self._config = validated
        return self.public_config()

    @staticmethod
    def _boolean(value: Any, field: str) -> bool:
        if not isinstance(value, bool):
            raise ValueError(f"{field} must be a boolean")
        return value

    @staticmethod
    def _validate_wifi_password(value: Any, field: str) -> None:
        if not isinstance(value, str):
            raise ValueError(f"{field} must be text")
        encoded = value.encode("utf-8")
        valid_psk = len(value) == 64 and re.fullmatch(r"[0-9A-Fa-f]{64}", value)
        if not valid_psk and not 8 <= len(encoded) <= 63:
            raise ValueError(f"{field} must be 8-63 characters or a 64-digit hexadecimal PSK")
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError(f"{field} cannot contain control characters")

    @classmethod
    def _validated_config(
        cls, raw: Any, defaults: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("network configuration file must contain an object")
        defaults = copy.deepcopy(defaults) if defaults is not None else _default_config()
        merged = copy.deepcopy(defaults)
        merged["enabled"] = cls._boolean(raw.get("enabled", False), "enabled")
        raw_wifi = raw.get("wifi", {})
        raw_usb = raw.get("usb", {})
        if not isinstance(raw_wifi, dict) or not isinstance(raw_usb, dict):
            raise ValueError("wifi and usb settings must be objects")
        wifi = merged["wifi"]
        wifi["enabled"] = cls._boolean(raw_wifi.get("enabled", True), "wifi.enabled")
        interface = _text(raw_wifi.get("interface", "wlan0"), "wifi.interface", maximum=15)
        if not re.fullmatch(r"[A-Za-z0-9_.:-]+", interface):
            raise ValueError("wifi.interface contains unsupported characters")
        wifi["interface"] = interface
        wifi["connectionTimeout"] = _bounded_integer(
            raw_wifi.get("connectionTimeout", 15), "wifi.connectionTimeout", 1, 120
        )
        wifi["reconnectGrace"] = _bounded_integer(
            raw_wifi.get("reconnectGrace", 10), "wifi.reconnectGrace", 0, 300
        )
        wifi["networks"] = []
        networks = raw_wifi.get("networks", [])
        if not isinstance(networks, list) or len(networks) > 20:
            raise ValueError("wifi.networks must be a list of at most 20 networks")
        seen_ids: set[str] = set()
        for item in networks:
            if not isinstance(item, dict):
                raise ValueError("each Wi-Fi network must be an object")
            network_id = _text(item.get("id"), "wifi network id", maximum=64)
            if not re.fullmatch(r"[A-Za-z0-9_-]+", network_id) or network_id in seen_ids:
                raise ValueError("Wi-Fi network ids must be unique letters, digits, _ or -")
            seen_ids.add(network_id)
            ssid = _text(item.get("ssid"), "wifi network ssid", maximum=32)
            hidden = cls._boolean(item.get("hidden", False), "wifi network hidden")
            password = item.get("password")
            if password is not None:
                cls._validate_wifi_password(password, "wifi network password")
            wifi["networks"].append(
                {"id": network_id, "ssid": ssid, "hidden": hidden, "password": password}
            )

        raw_hotspot = raw_wifi.get("hotspot", {})
        if not isinstance(raw_hotspot, dict):
            raise ValueError("wifi.hotspot must be an object")
        hotspot = wifi["hotspot"]
        hotspot["ssid"] = _text(
            raw_hotspot.get("ssid", hotspot["ssid"]), "wifi.hotspot.ssid", maximum=32
        )
        hotspot["password"] = raw_hotspot.get("password", hotspot["password"])
        if hotspot["password"] or (merged["enabled"] and wifi["enabled"]):
            cls._validate_wifi_password(hotspot["password"], "wifi.hotspot.password")
        hotspot["address"] = _text(
            raw_hotspot.get("address", hotspot["address"]),
            "wifi.hotspot.address",
            maximum=64,
        )
        try:
            ipaddress.IPv4Interface(hotspot["address"])
        except ipaddress.AddressValueError as error:
            raise ValueError("wifi.hotspot.address must be an IPv4 interface address") from error
        merged["usb"]["enabled"] = cls._boolean(raw_usb.get("enabled", False), "usb.enabled")
        return merged

    def _write_private(self, config: dict[str, Any]) -> None:
        directory = os.path.dirname(self.path)
        os.makedirs(directory, mode=0o700, exist_ok=True)
        descriptor, temporary_path = tempfile.mkstemp(prefix=".network-", dir=directory)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as config_file:
                json.dump(config, config_file, indent=2)
                config_file.write("\n")
                config_file.flush()
                os.fsync(config_file.fileno())
            os.replace(temporary_path, self.path)
            os.chmod(self.path, 0o600)
            directory_fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary_path):
                os.unlink(temporary_path)
