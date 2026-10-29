"""Validate package generation without running privileged installation."""

from pathlib import Path
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import tarfile
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[3]


def generated_script(source: str, delimiter: str) -> str:
    match = re.search(r"<<\s*'?" + delimiter + r"'?\n(.*?)\n" + delimiter + r"\n", source, re.S)
    assert match, f"Missing generated script {delimiter}"
    return match.group(1) + "\n"


def syntax_check(script):
    subprocess.run(["bash", "-n"], input=script, text=True, check=True, capture_output=True)


def run_device_setup(tmp_path, command, devices_dir=None):
    source = (ROOT / "install-scripts/sketchatone-setup").read_text()
    syntax_check(source)
    functions = source.split("# Main\n", 1)[0]
    devices_dir = devices_dir or ROOT / "python/sketchatone/tablet/otd/configs"
    script = functions + "\n" + "\n".join([
        f"INSTALL_DIR={shlex.quote(str(ROOT))}",
        f"CONFIG_DIR={shlex.quote(str(tmp_path))}",
        f"DEVICES_DIR={shlex.quote(str(devices_dir))}",
        f"UDEV_RULES_FILE={shlex.quote(str(tmp_path / 'rules'))}",
        command,
    ])
    return subprocess.run(["bash"], input=script, text=True, capture_output=True)


def test_udev_rules_use_bundled_otd_identifiers(tmp_path):
    result = run_device_setup(tmp_path, 'generate_udev_rules')
    assert result.returncode == 0, result.stdout + result.stderr
    rules = (tmp_path / "rules").read_text()
    assert 'ATTRS{idVendor}=="056a", ATTRS{idProduct}=="037a"' in rules
    assert 'ATTR{idVendor}=="056a", ATTR{idProduct}=="037a"' in rules
    assert 'ENV{PRODUCT}=="56a/37a/*"' in rules
    assert rules.count('ATTRS{idVendor}=="056a", ATTRS{idProduct}=="037a"') == 1


def test_udev_rules_preserve_legacy_custom_devices(tmp_path):
    devices = tmp_path / "devices"
    devices.mkdir()
    (devices / "custom.json").write_text(json.dumps({
        "vendorId": "0x1234", "productId": "0x0001", "name": "Custom tablet",
    }))
    result = run_device_setup(tmp_path, 'generate_udev_rules')
    assert result.returncode == 0, result.stdout + result.stderr
    rules = (tmp_path / "rules").read_text()
    assert 'ATTRS{idVendor}=="1234", ATTRS{idProduct}=="0001"' in rules
    assert 'ENV{PRODUCT}=="1234/1/*"' in rules


def test_missing_device_definitions_do_not_overwrite_rules(tmp_path):
    (tmp_path / "rules").write_text("existing rules\n")
    result = run_device_setup(tmp_path, 'generate_udev_rules', tmp_path / "missing")
    assert result.returncode != 0
    assert "Tablet config directory not found" in result.stderr
    assert (tmp_path / "rules").read_text() == "existing rules\n"


def test_invalid_device_definitions_do_not_overwrite_rules(tmp_path):
    devices = tmp_path / "otd"
    devices.mkdir()
    (devices / "invalid.json").write_text("{")
    (tmp_path / "rules").write_text("existing rules\n")
    result = run_device_setup(tmp_path, 'generate_udev_rules', devices)
    assert result.returncode != 0
    assert "JSONDecodeError" in result.stderr
    assert (tmp_path / "rules").read_text() == "existing rules\n"


@pytest.mark.parametrize("filename,delimiters", [
    ("package-for-pi.sh", ("INSTALLEOF",)),
    ("install-scripts/create-deb.sh", ("POSTINSTEOF", "BINEOF", "PRERMEOF", "POSTRMEOF")),
    ("install-scripts/create-deb-ui.sh", ("PREINSTEOF", "POSTINSTEOF", "BINEOF", "PRERMEOF")),
])
def test_packaging_shell_syntax(filename, delimiters):
    source = (ROOT / filename).read_text()
    syntax_check(source)
    for delimiter in delimiters:
        syntax_check(generated_script(source, delimiter))


def test_core_owns_private_stock_python_and_hidraw():
    source = (ROOT / "install-scripts/create-deb.sh").read_text()
    postinst = generated_script(source, "POSTINSTEOF")
    assert "python3-venv" in source
    assert "libhidapi-dev" in source and "libudev-dev" in source
    assert "--break-system-packages" not in postinst
    assert "pip3 install" not in postinst
    assert "/usr/bin/python3 -m venv --system-site-packages /opt/sketchatone/venv" in postinst
    assert "Cython" in postinst
    assert "HIDAPI_WITH_HIDRAW=1" in postinst
    assert "--no-binary hidapi --force-reinstall" in postinst
    assert "--no-build-isolation" in postinst


def test_ui_is_passive_shared_runtime_addon():
    source = (ROOT / "install-scripts/create-deb-ui.sh").read_text()
    postinst = generated_script(source, "POSTINSTEOF")
    launcher = generated_script(source, "BINEOF")
    assert "Depends: sketchatone (= $VERSION)" in source
    assert "/opt/sketchatone/venv/bin/python" in launcher
    assert "-m sketchatone.cli.ui" in launcher
    assert '--connect "$URL" "$@"' in launcher
    assert '--connect|--connect=*)' in launcher
    assert "MidiStrummerConfig.from_json_file(path)" in launcher
    assert 'path = "/opt/sketchatone/configs/config.json"' in launcher
    assert "'/opt/sketchatone/python[ui]'" in postinst
    assert "-m venv" not in postinst
    for delimiter in ("POSTINSTEOF", "PRERMEOF"):
        script = generated_script(source, delimiter)
        assert "systemctl" not in script
        assert "udev" not in script
        assert "--install-hid" not in script
        assert "--uninstall-hid" not in script
    preinst = generated_script(source, "PREINSTEOF")
    assert "legacy-ui-configs" in preinst
    assert "cp -a -n" in preinst
    assert "/opt/sketchatone/configs/config.json" not in preinst
    assert 'if [ -n "${2:-}" ]; then' in postinst
    assert "--migrate-all" in postinst
    prerm = generated_script(source, "PRERMEOF")
    assert "remove|purge)" in prerm
    assert "--uninstall-all" in prerm
    assert "upgrade)" not in prerm


def test_unified_installer_is_explicit_and_retains_inputs():
    source = (ROOT / "package-for-pi.sh").read_text()
    helper = generated_script(source, "INSTALLEOF")
    assert "WITH_UI=0" in helper
    assert "--with-ui" in helper and "--appliance" in helper
    assert 'id -u' in helper
    assert 'dirname "${BASH_SOURCE[0]}"' in helper
    assert 'apt install -y --allow-downgrades "${PACKAGES[@]}"' in helper
    assert helper.count("apt install") == 1
    assert helper.index("apt install") < helper.index("sketchatone-configure --appliance")
    assert 'rm -rf "$WORK"' in helper
    assert 'rm -rf "$BUNDLE"' not in helper
    assert helper.index('mkdir "$WORK"') < helper.index("tar xzf")
    assert helper.index("apt install") < helper.index('rm -rf "$WORK"')
    assert "trap " in helper
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert scripts["package:pi-ui"] == scripts["package:pi"]


def test_core_always_builds_dashboard():
    source = (ROOT / "install-scripts/create-deb.sh").read_text()
    assert source.index("npm run build") < source.index('if [ -d "dist/public" ]')


@pytest.fixture
def package_project():
    # Keep all test output beneath the project, never the system temp directory.
    project = ROOT / f".pytest-pi-packaging-{uuid.uuid4().hex}"
    project.mkdir()
    try:
        (project / "install-scripts").mkdir()
        for filename in ("package-for-pi.sh", "install-scripts/create-deb.sh",
                         "install-scripts/create-deb-ui.sh"):
            shutil.copy2(ROOT / filename, project / filename)
        for name in ("setup-ui-autostart.sh", "setup-pi-boot-trim.sh",
                     "sketchatone-ui-configure", "sketchatone-setup",
                     "sketchatone-configure", "setup-usb-midi-gadget.sh"):
            (project / "install-scripts" / name).write_text("#!/bin/bash\nexit 0\n")
        python = project / "python"
        (python / "sketchatone/cli").mkdir(parents=True)
        (python / "sketchatone/cli/ui.py").write_text("# UI module included in core\n")
        (python / "pyproject.toml").write_text('version = "1.2.3"\n')
        (project / "public/configs").mkdir(parents=True)
        (project / "public/configs/sample-config.json").write_text("{}\n")
        tools = project / "tools"
        tools.mkdir()
        # Constrain PATH so the tree-only path is testable even on Linux.
        for name in ("bash", "dirname", "sed", "head", "mkdir", "rm", "cp",
                     "find", "chmod", "tar", "grep", "ls", "cat", "gzip"):
            (tools / name).symlink_to(shutil.which(name))
        npm = tools / "npm"
        npm.write_text('#!/bin/bash\nmkdir -p dist/public\necho fresh-dashboard > dist/public/index.html\n')
        npm.chmod(0o755)
        yield project, tools
    finally:
        shutil.rmtree(project)


@pytest.mark.parametrize("debs", [False, True])
def test_unified_bundle_shape(package_project, debs):
    project, tools = package_project
    if debs:
        builder = tools / "dpkg-deb"
        builder.write_text('#!/bin/bash\n[ "$1" = --build ] || exit 1\n'
                           'echo built-deb > "$3"\n')
        builder.chmod(0o755)
    (project / "dist").mkdir()
    sentinel = project / "dist/unrelated-release.txt"
    sentinel.write_text("preserved")
    env = {**os.environ, "PATH": str(tools)}
    result = subprocess.run(["bash", str(project / "package-for-pi.sh")],
                            cwd=ROOT, env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "scp dist/sketchatone-1.2.3-pi-bundle.tar.gz "
        "dist/install-sketchatone.sh sketchy@sketchatone.local:~/"
    ) in result.stdout
    assert sentinel.read_text() == "preserved"
    assert len(list((project / "dist").glob("*.tar.gz"))) == 1
    assert len(list((project / "dist").glob("install-*.sh"))) == 1
    helper = project / "dist/install-sketchatone.sh"
    syntax_check(helper.read_text())
    with tarfile.open(project / "dist/sketchatone-1.2.3-pi-bundle.tar.gz") as archive:
        members = {member.name.removeprefix("./") for member in archive.getmembers()}
        if debs:
            assert "sketchatone-1.2.3.deb" in members
            assert "sketchatone-ui-1.2.3.deb" in members
            assert not any("/DEBIAN/" in name for name in members)
        else:
            core = "sketchatone_1.2.3_all"
            addon = "sketchatone-ui_1.2.3_all"
            assert f"{core}/opt/sketchatone/python/sketchatone/cli/ui.py" in members
            assert f"{core}/opt/sketchatone/configs/sample-config.json" in members
            assert f"{core}/opt/sketchatone/dist/public/index.html" in members
            assert f"{core}/opt/sketchatone/sketchatone.service" in members
            assert f"{addon}/usr/bin/sketchatone-ui" in members
            assert not any(name.startswith(f"{addon}/opt/") for name in members)
            assert not any("/venv/" in name for name in members)
            control = archive.extractfile(f"./{addon}/DEBIAN/control").read().decode()
            assert "Depends: sketchatone (= 1.2.3)" in control


@pytest.mark.parametrize("server,extra,url", [
    ({"wsPort": 9191}, [], "ws://127.0.0.1:9191"),
    ({"ws_port": 9292}, [], "ws://127.0.0.1:9292"),
    ({}, [], "ws://127.0.0.1:8081"),
    ({"wsPort": 9191}, ["--connect", "ws://remote:8082"], "ws://remote:8082"),
    ({"wsPort": 9191}, ["--connect=ws://remote:8082"], "ws://remote:8082"),
])
def test_ui_launcher_shared_port_and_explicit_override(package_project, server, extra, url):
    project, _ = package_project
    config = project / "config.json"
    config.write_text(json.dumps({"server": server}))
    python = project / "capture-python"
    python.write_text(
        f"#!{sys.executable}\n"
        "import json, subprocess, sys\n"
        "if sys.argv[1] == '-c':\n"
        "    sys.exit(subprocess.call([sys.executable, *sys.argv[1:]]))\n"
        "print(json.dumps(sys.argv[1:]))\n"
    )
    python.chmod(0o755)
    source = (ROOT / "install-scripts/create-deb-ui.sh").read_text()
    launcher = generated_script(source, "BINEOF")
    launcher = launcher.replace("/opt/sketchatone/venv/bin/python", str(python))
    launcher = launcher.replace("/opt/sketchatone/configs/config.json", str(config))
    launcher = launcher.replace("/opt/sketchatone/python", str(ROOT / "python"))
    env = {key: value for key, value in os.environ.items() if key != "SKETCHATONE_UI_URL"}
    result = subprocess.run(["bash", "-c", launcher, "sketchatone-ui", *extra],
                            env=env, text=True, capture_output=True, check=True)
    arguments = json.loads(result.stdout)
    assert arguments[:2] == ["-m", "sketchatone.cli.ui"]
    assert arguments[2:] in (["--connect", url], [f"--connect={url}"])


@pytest.mark.parametrize("contents", [
    "{invalid",
    "[]",
    '{"server": {"wsPort": "invalid"}}',
    '{"server": {"wsPort": 0}}',
    '{"server": {"wsPort": 70000}}',
    '{"server": {"wsPort": true}}',
])
def test_ui_launcher_rejects_invalid_shared_config(package_project, contents):
    project, _ = package_project
    config = project / "config.json"
    config.write_text(contents)
    source = (ROOT / "install-scripts/create-deb-ui.sh").read_text()
    launcher = generated_script(source, "BINEOF")
    launcher = launcher.replace("/opt/sketchatone/venv/bin/python", sys.executable)
    launcher = launcher.replace("/opt/sketchatone/configs/config.json", str(config))
    launcher = launcher.replace("/opt/sketchatone/python", str(ROOT / "python"))
    env = {key: value for key, value in os.environ.items() if key != "SKETCHATONE_UI_URL"}
    result = subprocess.run(["bash", "-c", launcher], env=env, text=True, capture_output=True)
    assert result.returncode != 0
    assert "Sketchatone service config" in result.stderr
    assert not result.stdout
