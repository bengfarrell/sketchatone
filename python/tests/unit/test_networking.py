import asyncio
import json
import os
import stat
from unittest.mock import AsyncMock

import pytest

from sketchatone.networking import NetworkConfigStore, NetworkManager
from sketchatone.networking.manager import NetworkCommandError


async def test_enabling_after_disabled_start_launches_monitor(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr("sketchatone.networking.manager.platform.system", lambda: "Linux")
    monkeypatch.setattr(manager, "_apply_configuration", AsyncMock())
    await manager.start()
    assert manager._task is None
    store.save({
        "enabled": True,
        "wifi": {"hotspot": {"password": "known-hotspot-password"}},
    })
    try:
        await manager.apply()
        await manager._apply_task
        assert manager._task is not None
        assert not manager._task.done()
        store.save({"enabled": False})
        await manager.apply()
        assert not manager._enabled
        assert manager.status["mode"] == "disabled"
    finally:
        await manager.stop()


async def test_wifi_budget_exhaustion_still_attempts_hotspot(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({
        "enabled": True,
        "wifi": {
            "hotspot": {"password": "known-hotspot-password"},
            "networks": [{"id": "home", "ssid": "Home"}],
        },
    })
    manager = NetworkManager(store)
    manager.MAX_ATTEMPT_SECONDS = 1
    manager._active_config = store.load()
    monkeypatch.setattr(manager, "_snapshot_active_connections", AsyncMock(return_value=[]))
    activate = AsyncMock(return_value="hotspot-uuid")
    monkeypatch.setattr(manager, "_install_and_activate", activate)
    monkeypatch.setattr(manager, "_connection_succeeded", AsyncMock())

    await manager._apply_configuration(store.load(), reconnect=False)

    assert activate.await_count == 1
    assert activate.call_args.args[1] == "sketchnet-hotspot"


async def test_wifi_cleanup_preserves_owned_usb_connections(tmp_path, monkeypatch):
    manager = NetworkManager(NetworkConfigStore(tmp_path / "network.json"))
    usb_uuid = "12345678-1234-1234-1234-123456789abc"
    commands = []

    async def run(operation, *args, **kwargs):
        commands.append(operation)
        return f"sketchnet-usb-75736230-12345678:{usb_uuid}\n"

    monkeypatch.setattr(manager, "_run", run)
    await manager._cleanup_owned_connections("keep", asyncio.get_running_loop().time() + 10)
    assert commands == ["list Sketchatone connections"]


async def test_error_state_retries_recovery(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": True, "wifi": {"hotspot": {"password": "known-hotspot-password"}}})
    manager = NetworkManager(store)
    manager._active_config = store.load()
    manager._enabled = True
    manager.status.update(state="error", connected=False)
    apply = AsyncMock()
    monkeypatch.setattr(manager, "_apply_configuration", apply)

    await manager._monitor_once()

    apply.assert_awaited_once()
    assert apply.call_args.kwargs["reconnect"]


async def test_usb_failure_retries_without_replugging(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": True, "wifi": {"enabled": False}, "usb": {"enabled": True}})
    manager = NetworkManager(store)
    manager._active_config = store.load()
    manager._enabled = True
    monkeypatch.setattr(manager, "_discover_usb_interfaces", lambda: ["usb0"])
    run = AsyncMock(side_effect=NetworkCommandError("Tethering is not enabled yet"))
    monkeypatch.setattr(manager, "_run", run)

    await manager._monitor_once()
    await manager._monitor_once()

    assert run.await_count == 2


@pytest.fixture(autouse=True)
def private_runtime_profiles(tmp_path, monkeypatch):
    monkeypatch.setattr(NetworkManager, "KEYFILE_DIRECTORY", str(tmp_path / "profiles"))


async def _apply_and_wait(manager):
    await manager.apply()
    if manager._apply_task is not None:
        await manager._apply_task
    return manager.status


def test_store_defaults_are_disabled_and_redacted(tmp_path):
    store = NetworkConfigStore(tmp_path / "network.json")

    config = store.load()
    public = store.public_config()

    assert config["enabled"] is False
    assert config["wifi"]["enabled"] is True
    assert config["wifi"]["interface"] == "wlan0"
    assert config["wifi"]["connectionTimeout"] == 15
    assert config["wifi"]["reconnectGrace"] == 10
    assert config["wifi"]["hotspot"]["password"] == ""
    assert public["wifi"]["hotspot"]["passwordSet"] is False
    assert "password" not in public["wifi"]["hotspot"]
    assert not (tmp_path / "network.json").exists()


def test_missing_config_defaults_and_external_edits_are_reloadable(tmp_path):
    path = tmp_path / "network.json"
    store = NetworkConfigStore(path)

    first = store.load()
    second = store.load()
    assert first == second

    externally_edited = json.loads(json.dumps(first))
    externally_edited["wifi"]["interface"] = "wlan1"
    path.write_text(json.dumps(externally_edited), encoding="utf-8")
    assert store.load()["wifi"]["interface"] == "wlan1"


def test_save_none_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="object"):
        NetworkConfigStore(tmp_path / "network.json").save(None)


def test_enabling_wifi_requires_known_hotspot_password(tmp_path):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": False})
    with pytest.raises(ValueError, match="password"):
        store.save({"enabled": True})
    assert not store.public_config()["enabled"]


def test_store_save_preserves_passwords_and_writes_private_file(tmp_path):
    path = tmp_path / "network.json"
    store = NetworkConfigStore(path)
    store.save(
        {
            "enabled": True,
            "wifi": {
                "networks": [
                    {
                        "id": "home",
                        "ssid": "Home",
                        "hidden": True,
                        "password": "a secure password",
                    }
                ],
                "hotspot": {"password": "hotspot password"},
            },
        }
    )

    returned = store.save(
        {
            "wifi": {
                "networks": [{"id": "home", "ssid": "Home 2", "hidden": False}],
                "hotspot": {"ssid": "My device"},
            }
        }
    )

    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stored["wifi"]["networks"][0]["password"] == "a secure password"
    assert stored["wifi"]["hotspot"]["password"] == "hotspot password"
    assert returned["wifi"]["networks"] == [
        {"id": "home", "ssid": "Home 2", "hidden": False, "passwordSet": True}
    ]
    assert "a secure password" in path.read_text(encoding="utf-8")
    assert "hotspot password" not in json.dumps(returned)


@pytest.mark.parametrize(
    "submitted",
    [
        {"wifi": {"connectionTimeout": 0}},
        {"wifi": {"networks": [{"id": "bad id", "ssid": "Home"}]}},
        {
            "wifi": {
                "networks": [
                    {"id": "same", "ssid": "one"},
                    {"id": "same", "ssid": "two"},
                ]
            }
        },
        {"wifi": {"hotspot": {"password": "short"}}},
    ],
)
def test_store_rejects_invalid_configuration(tmp_path, submitted):
    with pytest.raises(ValueError):
        NetworkConfigStore(tmp_path / "network.json").save(submitted)


def test_disabled_manager_does_not_run_network_commands(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    manager = NetworkManager(store)
    calls = []

    async def forbidden_run(*args, **kwargs):
        calls.append(args)
        raise AssertionError("nmcli must not run while networking is disabled")

    monkeypatch.setattr(manager, "_run", forbidden_run)

    asyncio.run(manager.start())
    asyncio.run(manager.stop())

    assert manager.status["state"] == "stopped"
    assert calls == []


def test_apply_tries_wifi_in_order_without_putting_password_in_arguments(
    tmp_path, monkeypatch
):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save(
        {
            "enabled": True,
            "wifi": {
                "networks": [
                    {"id": "first", "ssid": "First", "password": "first-password"},
                    {"id": "second", "ssid": "Second", "password": "second-password"},
                ],
                "hotspot": {"password": "known-hotspot-password"},
            },
        }
    )
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr("sketchatone.networking.manager.platform.system", lambda: "Linux")
    imports = []
    calls = []
    profiles = {}

    async def fake_run(operation, *args, timeout, extra=()):
        calls.append((operation, args, extra))
        if operation == "snapshot active connections":
            return ""
        if operation == "read interface addresses":
            return "192.168.1.20/24\n"
        if operation == "load connection keyfile":
            keyfile_path = args[-1]
            assert stat.S_IMODE(os.stat(keyfile_path).st_mode) == 0o600
            with open(keyfile_path, encoding="utf-8") as keyfile:
                contents = keyfile.read()
            imports.append(contents)
            profiles[contents.split("uuid=", 1)[1].splitlines()[0]] = contents
            return ""
        if operation == "activate connection":
            connection_uuid = args[args.index("uuid") + 1]
            if "ssid=First" in profiles[connection_uuid]:
                raise NetworkCommandError("activate connection: no network")
            return ""
        if operation == "list Sketchatone connections":
            return ""
        if operation == "remove failed connection":
            return ""
        raise AssertionError(f"unexpected nmcli operation: {operation}")

    monkeypatch.setattr(manager, "_run", fake_run)
    status = asyncio.run(_apply_and_wait(manager))

    assert status["state"] == "wifi"
    assert status["activeConnection"] == "wifi"
    assert len(imports) == 2
    assert "psk=first-password" in imports[0]
    assert "psk=second-password" in imports[1]
    assert all(
        secret not in repr(call)
        for call in calls
        for secret in ("first-password", "second-password")
    )


def test_connection_status_does_not_echo_network_names_or_passwords(tmp_path, monkeypatch):
    secret = "shared-secret-value"
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save(
        {
            "enabled": True,
            "wifi": {
                "networks": [
                    {"id": "safe-id", "ssid": secret, "password": secret}
                ],
                "hotspot": {"password": "known-hotspot-password"},
            },
        }
    )
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr(
        "sketchatone.networking.manager.platform.system", lambda: "Linux"
    )

    async def fake_run(operation, *args, timeout, extra=()):
        if operation == "snapshot active connections":
            return ""
        if operation == "read interface addresses":
            return "192.168.1.20/24\n"
        if operation == "load connection keyfile":
            return ""
        if operation == "activate connection":
            return ""
        if operation == "list Sketchatone connections":
            return ""
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(manager, "_run", fake_run)
    status = asyncio.run(_apply_and_wait(manager))

    assert status["mode"] == "wifi"
    assert secret not in repr(status)


def test_failed_hotspot_restores_previous_wifi_profile(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save(
        {
            "enabled": True,
            "wifi": {
                "networks": [],
                "hotspot": {"password": "known-hotspot-password"},
            },
        }
    )
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr("sketchatone.networking.manager.platform.system", lambda: "Linux")
    operations = []

    async def fake_run(operation, *args, timeout, extra=()):
        operations.append(operation)
        if operation == "snapshot active connections":
            return "previous-uuid:wlan0\n"
        if operation == "load connection keyfile":
            return ""
        if operation == "activate connection":
            raise NetworkCommandError("activate connection: activation failed")
        if operation in ("remove failed connection", "restore previous connection"):
            return ""
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(manager, "_run", fake_run)
    status = asyncio.run(_apply_and_wait(manager))

    assert status["state"] == "error"
    assert "Hotspot: activate connection" in status["error"]
    assert "restore previous connection" in operations


def test_usb_discovery_finds_supported_usb_ethernet_driver(tmp_path):
    sys_class_net = tmp_path / "class" / "net"
    sys_class_net.mkdir(parents=True)
    device = tmp_path / "devices" / "usb1" / "1-1" / "net" / "eth9"
    (device / "driver").parent.mkdir(parents=True)
    (device / "driver").symlink_to(tmp_path / "drivers" / "cdc_ncm")
    (sys_class_net / "eth9").mkdir()
    (sys_class_net / "eth9" / "device").symlink_to(device)
    (sys_class_net / "wlan0").mkdir()

    manager = NetworkManager(
        NetworkConfigStore(tmp_path / "network.json"),
        sys_class_net=sys_class_net,
    )

    assert manager._discover_usb_interfaces() == ["eth9"]


def test_usb_tether_uses_owned_ethernet_profile_without_replacing_wifi(
    tmp_path, monkeypatch
):
    sys_class_net = tmp_path / "class" / "net"
    sys_class_net.mkdir(parents=True)
    device = tmp_path / "devices" / "usb1" / "1-1" / "net" / "usb0"
    (device / "driver").parent.mkdir(parents=True)
    (device / "driver").symlink_to(tmp_path / "drivers" / "rndis_host")
    (sys_class_net / "usb0").mkdir()
    (sys_class_net / "usb0" / "device").symlink_to(device)
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save(
        {
            "enabled": True,
            "wifi": {
                "networks": [
                    {"id": "home", "ssid": "Home", "password": "private wifi pass"}
                ],
                "hotspot": {"password": "known-hotspot-password"},
            },
            "usb": {"enabled": True},
        }
    )
    manager = NetworkManager(store, sys_class_net=sys_class_net)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr("sketchatone.networking.manager.platform.system", lambda: "Linux")
    imports = []
    operations = []

    async def fake_run(operation, *args, timeout, extra=()):
        operations.append((operation, args))
        if operation == "snapshot active connections":
            return ""
        if operation == "read interface addresses":
            return "192.168.1.20/24\n"
        if operation == "load connection keyfile":
            keyfile_path = args[-1]
            with open(keyfile_path, encoding="utf-8") as keyfile:
                imports.append(keyfile.read())
            return ""
        if operation == "activate connection":
            return ""
        if operation == "list Sketchatone connections":
            return ""
        if operation == "check USB tether":
            return "usb0:disconnected\n"
        if operation == "list owned USB tether connections":
            return ""
        raise AssertionError(f"unexpected operation: {operation}")

    monkeypatch.setattr(manager, "_run", fake_run)
    status = asyncio.run(_apply_and_wait(manager))

    assert status["state"] == "wifi"
    assert status["connected"] is True
    assert status["usbConnectedInterfaces"] == ["usb0"]
    assert status["usbError"] is None
    assert "type=wifi" in imports[0]
    assert "type=ethernet" in imports[1]
    assert "interface-name=usb0" in imports[1]
    assert "private wifi pass" not in repr(operations)


def test_monitor_does_not_retry_while_hotspot_is_stable(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": True, "wifi": {"hotspot": {"password": "known-hotspot-password"}}})
    manager = NetworkManager(store)
    manager._enabled = True
    manager.status.update(state="hotspot", connected=True)

    async def forbidden_run(*args, **kwargs):
        raise AssertionError("stable hotspot must not trigger retry commands")

    monkeypatch.setattr(manager, "_run", forbidden_run)

    asyncio.run(manager._monitor_once())


def test_monitor_uses_apply_snapshot_not_externally_edited_config(tmp_path, monkeypatch):
    async def scenario():
        path = tmp_path / "network.json"
        store = NetworkConfigStore(path)
        store.save(
            {
                "enabled": True,
                "wifi": {
                    "networks": [
                        {"id": "original", "ssid": "Original", "password": "original pass"}
                    ],
                    "hotspot": {"password": "known-hotspot-password"},
                },
            }
        )
        manager = NetworkManager(store)
        manager._enabled = True
        manager._active_config = store.load()
        manager.status.update(state="wifi", connected=True)
        changed = json.loads(path.read_text(encoding="utf-8"))
        changed["wifi"]["networks"] = [
            {"id": "edited", "ssid": "Edited", "password": "edited password"}
        ]
        path.write_text(json.dumps(changed), encoding="utf-8")
        commands = []

        async def fake_run(operation, *args, timeout, extra=()):
            commands.append((operation, args))
            assert operation == "device status"
            return "wlan0:connected:Home\n"

        monkeypatch.setattr(manager, "_run", fake_run)
        await manager._monitor_once()

        assert commands == [
            ("device status", ("device", "status"))
        ]
        assert manager._active_config["wifi"]["networks"][0]["id"] == "original"

    asyncio.run(scenario())


def test_wifi_disabled_does_not_start_saved_network_or_hotspot(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": True, "wifi": {"enabled": False}})
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr(
        "sketchatone.networking.manager.platform.system", lambda: "Linux"
    )

    async def forbidden_run(*args, **kwargs):
        raise AssertionError("Wi-Fi-disabled settings must not activate profiles")

    monkeypatch.setattr(manager, "_run", forbidden_run)
    status = asyncio.run(_apply_and_wait(manager))

    assert status["mode"] == "disabled"
    assert status["enabled"] is True
    assert "Wi-Fi networking is disabled" in status["message"]
    assert manager.busy is False


def test_request_apply_returns_busy_status_while_work_runs(tmp_path, monkeypatch):
    async def scenario():
        store = NetworkConfigStore(tmp_path / "network.json")
        store.save({"enabled": True, "wifi": {"hotspot": {"password": "known-hotspot-password"}}})
        callbacks = []

        async def on_status(status):
            callbacks.append(status)

        manager = NetworkManager(store, on_status=on_status)
        manager._nmcli = "/usr/bin/nmcli"
        monkeypatch.setattr(
            "sketchatone.networking.manager.platform.system", lambda: "Linux"
        )
        entered = asyncio.Event()
        release = asyncio.Event()

        async def delayed_apply(config, *, reconnect, time_limit=None):
            entered.set()
            await release.wait()
            await manager._set_status(state="hotspot", connected=True)

        monkeypatch.setattr(manager, "_apply_configuration", delayed_apply)
        immediate_status = await manager.apply()

        assert immediate_status["busy"] is True
        assert manager.busy is True
        assert immediate_status["mode"] == "connecting"
        assert immediate_status["phase"] == "starting"
        assert immediate_status["supported"] is True
        assert "usb" in immediate_status
        assert "addresses" in immediate_status
        assert callbacks[-1]["busy"] is True

        await entered.wait()
        with pytest.raises(RuntimeError, match="already being applied"):
            await manager.apply()

        release.set()
        await manager._apply_task
        assert manager.status["busy"] is False
        assert manager.status["mode"] == "hotspot"

    asyncio.run(scenario())


def test_unsupported_platform_is_reported_and_apply_rejected(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({"enabled": True, "wifi": {"hotspot": {"password": "known-hotspot-password"}}})
    manager = NetworkManager(store)
    manager._nmcli = "/usr/bin/nmcli"
    monkeypatch.setattr(
        "sketchatone.networking.manager.platform.system", lambda: "Darwin"
    )

    asyncio.run(manager.start())

    assert manager.status["supported"] is False
    assert manager.status["mode"] == "unsupported"
    with pytest.raises(RuntimeError, match="NetworkManager"):
        asyncio.run(manager.apply())
