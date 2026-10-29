from unittest.mock import Mock

import pytest

from sketchatone.cli import appliance_setup
from sketchatone.networking import NetworkConfigStore


def test_validation_does_not_write_credentials(tmp_path):
    store = NetworkConfigStore(tmp_path / "network.json")
    with pytest.raises(ValueError, match="password"):
        store.validate({"enabled": True})
    assert not (tmp_path / "network.json").exists()
    assert not store.public_config()["enabled"]


@pytest.mark.parametrize("apply", [False, True])
def test_headless_setup_only_prompts_for_appliance_options(tmp_path, monkeypatch, apply):
    monkeypatch.setattr(appliance_setup.sys, "platform", "linux")
    monkeypatch.setattr(appliance_setup.os, "geteuid", lambda: 0)
    monkeypatch.setattr(appliance_setup.sys, "stdin", Mock(isatty=lambda: True))
    monkeypatch.setattr(appliance_setup, "Path", Mock(return_value=Mock(
        exists=lambda: True, read_text=lambda: "Raspberry Pi 5",
    )))
    monkeypatch.setattr(appliance_setup, "NETWORK_CONFIG", str(tmp_path / "network.json"))
    monkeypatch.setattr(appliance_setup.shutil, "which", lambda _: None)
    prompts = []

    def confirm(prompt, **kwargs):
        prompts.append(prompt)
        return apply if prompt == "Apply this appliance setup?" else False

    monkeypatch.setattr(appliance_setup, "confirm", confirm)
    run = Mock()
    monkeypatch.setattr(appliance_setup.subprocess, "run", run)

    assert appliance_setup.main() == 0
    assert prompts == [
        "Configure the Pi's USB peripheral port as a MIDI device?",
        "Apply optional boot trimming (masks unused services and changes boot settings)?",
        "Apply this appliance setup?",
    ]
    assert not (tmp_path / "network.json").exists()
    if apply:
        assert [call.args[0] for call in run.call_args_list] == [
            ["sketchatone-setup", "--mode", "always-on"],
            ["systemctl", "restart", "sketchatone"],
        ]
    else:
        run.assert_not_called()


def test_disabled_setup_never_checks_networkmanager(tmp_path, monkeypatch):
    monkeypatch.setattr(appliance_setup, "confirm", lambda *args, **kwargs: False)
    run = Mock()
    monkeypatch.setattr(appliance_setup.subprocess, "run", run)

    settings = appliance_setup.collect_network_settings(NetworkConfigStore(tmp_path / "network.json"))

    assert settings["enabled"] is False
    run.assert_not_called()


def test_network_setup_preserves_saved_credentials_without_prompts(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({
        "enabled": True,
        "wifi": {
            "networks": [{"id": "home", "ssid": "Home", "password": "home-password"}],
            "hotspot": {"password": "hotspot-password"},
        },
    })
    original = (tmp_path / "network.json").read_bytes()
    prompt = Mock(side_effect=AssertionError("Setup must not prompt for networking"))
    monkeypatch.setattr("builtins.input", prompt)
    run = Mock()
    monkeypatch.setattr(appliance_setup.subprocess, "run", run)

    candidate = appliance_setup.collect_network_settings(store)
    validated = store.validate(candidate)

    assert validated["wifi"]["networks"][0]["password"] == "home-password"
    assert validated["wifi"]["hotspot"]["password"] == "hotspot-password"
    assert validated["usb"]["enabled"] is False
    assert "password" not in candidate["wifi"]["hotspot"]
    assert (tmp_path / "network.json").read_bytes() == original
    prompt.assert_not_called()
    run.assert_not_called()


def test_provision_leaves_networking_unconfigured_and_restarts_last(tmp_path, monkeypatch, capsys):
    store = NetworkConfigStore(tmp_path / "network.json")
    candidate = store.public_config()
    events = []

    def run(command, **kwargs):
        assert kwargs["check"] is True
        events.append(command)
        if command == ["sketchatone-setup", "--mode", "always-on"]:
            assert not (tmp_path / "network.json").exists()
        if command == ["systemctl", "restart", "sketchatone"]:
            assert not (tmp_path / "network.json").exists()

    monkeypatch.setattr(appliance_setup.subprocess, "run", run)
    appliance_setup.provision(candidate, store, iphone=True, gadget=True, trim=False)

    assert events == [
        ["apt-get", "update"],
        ["apt-get", "install", "-y", "usbmuxd", "libimobiledevice-utils"],
        ["modprobe", "ipheth"],
        ["sketchatone-setup-usb-gadget", "--yes", "--no-reboot"],
        ["sketchatone-setup", "--mode", "always-on"],
        ["systemctl", "restart", "sketchatone"],
    ]
    assert "reboot is required" in capsys.readouterr().out


def test_provision_preserves_preconfigured_network_json(tmp_path, monkeypatch, capsys):
    store = NetworkConfigStore(tmp_path / "network.json")
    store.save({
        "enabled": True,
        "wifi": {
            "networks": [{"id": "home", "ssid": "Home", "password": "home-password"}],
            "hotspot": {"password": "hotspot-password"},
        },
    })
    original = (tmp_path / "network.json").read_bytes()
    monkeypatch.setattr(appliance_setup.subprocess, "run", Mock())
    appliance_setup.provision(
        store.public_config(), store, iphone=False, gadget=False, trim=False,
    )
    assert (tmp_path / "network.json").read_bytes() == original
    assert "may disconnect SSH" in capsys.readouterr().out


def test_provision_stops_on_required_dependency_failure(tmp_path, monkeypatch):
    import subprocess
    store = NetworkConfigStore(tmp_path / "network.json")
    run = Mock(side_effect=subprocess.CalledProcessError(1, ["apt-get", "update"]))
    monkeypatch.setattr(appliance_setup.subprocess, "run", run)

    with pytest.raises(subprocess.CalledProcessError):
        appliance_setup.provision(store.public_config(), store, iphone=True, gadget=False, trim=False)

    assert run.call_count == 1
    assert not (tmp_path / "network.json").exists()


def test_ui_autostart_precedes_network_save_and_restart(tmp_path, monkeypatch):
    store = NetworkConfigStore(tmp_path / "network.json")
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[0] == "sketchatone-ui-setup-autostart":
            assert not (tmp_path / "network.json").exists()

    monkeypatch.setattr(appliance_setup.subprocess, "run", run)
    appliance_setup.provision(
        store.public_config(), store, iphone=False, gadget=False, trim=False,
        native_ui=True,
    )
    assert calls[0] == ["sketchatone-ui-setup-autostart", "--install", "--no-reboot"]
    assert calls[-1] == ["systemctl", "restart", "sketchatone"]
