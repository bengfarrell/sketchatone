"""
Unit tests for resolve_device_config_path function.

Tests the path resolution logic for device configs including:
- Absolute paths
- Relative paths
- Directory paths with auto-detection
- Direct file paths
"""

import pytest
import os
import sys
import tempfile
import json
from unittest.mock import patch, MagicMock


class TestResolveDeviceConfigPathAbsolutePaths:
    """Test absolute path handling."""

    def test_absolute_json_file_path_exists(self, tmp_path):
        """Test absolute path to existing JSON file."""
        # Create a temp JSON file
        config_file = tmp_path / "device.json"
        config_file.write_text('{"name": "test"}')

        # Import the function
        from sketchatone.cli.server import resolve_device_config_path

        result_path, result_dir = resolve_device_config_path(str(config_file))
        assert result_path == str(config_file)
        assert result_dir == str(tmp_path)

    def test_absolute_json_file_path_not_exists(self, tmp_path):
        """Test absolute path to non-existing JSON file exits."""
        from sketchatone.cli.server import resolve_device_config_path

        non_existent = str(tmp_path / "nonexistent.json")
        with pytest.raises(SystemExit):
            resolve_device_config_path(non_existent)

    def test_absolute_directory_path_with_matching_device(self, tmp_path):
        """Test absolute directory path with device auto-detection."""
        from sketchatone.cli.server import resolve_device_config_path

        # Create a device config file
        config_file = tmp_path / "test-device.json"
        config_file.write_text('{"name": "test"}')

        # Mock find_config_for_device to return our test file
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(config_file)
            result_path, result_dir = resolve_device_config_path(str(tmp_path))
            assert result_path == str(config_file)
            assert result_dir == str(tmp_path)
            mock_find.assert_called_once_with(str(tmp_path))

    def test_absolute_directory_path_no_device_with_poll(self, tmp_path):
        """Test absolute directory path with no device but poll enabled."""
        from sketchatone.cli.server import resolve_device_config_path

        # Mock find_config_for_device to return None (no device found)
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = None
            result_path, result_dir = resolve_device_config_path(str(tmp_path), poll_ms=1000)
            assert result_path is None
            assert result_dir == str(tmp_path)

    def test_absolute_directory_path_no_device_no_poll_exits(self, tmp_path):
        """Test absolute directory path with no device and no poll exits."""
        from sketchatone.cli.server import resolve_device_config_path

        # Mock find_config_for_device to return None (no device found)
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = None
            with pytest.raises(SystemExit):
                resolve_device_config_path(str(tmp_path))

    def test_absolute_directory_not_exists_exits(self, tmp_path):
        """Test absolute directory path that doesn't exist exits."""
        from sketchatone.cli.server import resolve_device_config_path

        non_existent_dir = str(tmp_path / "nonexistent_dir")
        with pytest.raises(SystemExit):
            resolve_device_config_path(non_existent_dir)


class TestResolveDeviceConfigPathRelativePaths:
    """Test relative path handling."""

    def test_relative_json_file_with_base_dir(self, tmp_path):
        """Test relative JSON file path resolved from base_dir."""
        from sketchatone.cli.server import resolve_device_config_path

        # Create directory structure
        devices_dir = tmp_path / "devices"
        devices_dir.mkdir()
        config_file = devices_dir / "xp-pen.json"
        config_file.write_text('{"name": "xp-pen"}')

        result_path, result_dir = resolve_device_config_path(
            "devices/xp-pen.json",
            base_dir=str(tmp_path)
        )
        assert result_path == str(config_file)
        assert result_dir == str(devices_dir)

    def test_relative_directory_with_base_dir(self, tmp_path):
        """Test relative directory path resolved from base_dir."""
        from sketchatone.cli.server import resolve_device_config_path

        # Create directory structure
        devices_dir = tmp_path / "devices"
        devices_dir.mkdir()
        config_file = devices_dir / "test-device.json"
        config_file.write_text('{"name": "test"}')

        # Mock find_config_for_device
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(config_file)
            result_path, result_dir = resolve_device_config_path(
                "devices",
                base_dir=str(tmp_path)
            )
            assert result_path == str(config_file)
            assert result_dir == str(devices_dir)

    def test_relative_path_without_base_dir(self, tmp_path, monkeypatch):
        """Test relative path without base_dir uses current directory."""
        from sketchatone.cli.server import resolve_device_config_path

        # Create directory structure in tmp_path
        devices_dir = tmp_path / "devices"
        devices_dir.mkdir()
        config_file = devices_dir / "test.json"
        config_file.write_text('{"name": "test"}')

        # Change to tmp_path
        monkeypatch.chdir(tmp_path)

        # Mock find_config_for_device
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(config_file)
            result_path, result_dir = resolve_device_config_path("devices")
            assert result_path == str(config_file)
            assert result_dir == str(devices_dir)


class TestResolveDeviceConfigPathNoneInput:
    """Test None device_path handling."""

    def test_none_device_path_uses_default_dir(self, tmp_path):
        """Test None device_path uses default directory."""
        from sketchatone.cli.server import resolve_device_config_path

        # Create a config file in the default dir
        config_file = tmp_path / "test.json"
        config_file.write_text('{"name": "test"}')

        # Mock find_config_for_device
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(config_file)
            result_path, result_dir = resolve_device_config_path(
                None,
                default_dir=str(tmp_path)
            )
            assert result_path == str(config_file)
            # The search_dir should be the absolute path of default_dir
            assert os.path.isabs(result_dir)

    def test_none_device_path_no_device_with_poll(self, tmp_path):
        """Test None device_path with no device but poll enabled."""
        from sketchatone.cli.server import resolve_device_config_path

        # Mock find_config_for_device to return None
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = None
            result_path, result_dir = resolve_device_config_path(
                None,
                default_dir=str(tmp_path),
                poll_ms=2000
            )
            assert result_path is None
            assert os.path.isabs(result_dir)


class TestResolveDeviceConfigPathInstalledScenario:
    """Test installed package scenario with absolute paths."""

    def test_installed_config_with_absolute_device_path(self, tmp_path):
        """Test installed scenario: config at /opt/sketchatone/configs/config.json
        with device = /opt/sketchatone/configs/devices"""
        from sketchatone.cli.server import resolve_device_config_path

        # Simulate installed directory structure
        configs_dir = tmp_path / "opt" / "sketchatone" / "configs"
        configs_dir.mkdir(parents=True)
        devices_dir = configs_dir / "devices"
        devices_dir.mkdir()
        device_config = devices_dir / "xp-pen.json"
        device_config.write_text('{"name": "xp-pen"}')

        # Mock find_config_for_device
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(device_config)
            result_path, result_dir = resolve_device_config_path(str(devices_dir))
            assert result_path == str(device_config)
            assert result_dir == str(devices_dir)

    def test_installed_config_with_relative_device_path(self, tmp_path):
        """Test installed scenario: config at /opt/sketchatone/configs/config.json
        with device = 'devices' (relative)"""
        from sketchatone.cli.server import resolve_device_config_path

        # Simulate installed directory structure
        configs_dir = tmp_path / "opt" / "sketchatone" / "configs"
        configs_dir.mkdir(parents=True)
        devices_dir = configs_dir / "devices"
        devices_dir.mkdir()
        device_config = devices_dir / "xp-pen.json"
        device_config.write_text('{"name": "xp-pen"}')

        # Mock find_config_for_device
        with patch('sketchatone.cli.server.find_config_for_device') as mock_find:
            mock_find.return_value = str(device_config)
            result_path, result_dir = resolve_device_config_path(
                "devices",
                base_dir=str(configs_dir)
            )
            assert result_path == str(device_config)
            assert result_dir == str(devices_dir)

    def test_installed_config_with_direct_device_file(self, tmp_path):
        """Test installed scenario with direct device file path."""
        from sketchatone.cli.server import resolve_device_config_path

        # Simulate installed directory structure
        configs_dir = tmp_path / "opt" / "sketchatone" / "configs"
        configs_dir.mkdir(parents=True)
        devices_dir = configs_dir / "devices"
        devices_dir.mkdir()
        device_config = devices_dir / "xp-pen.json"
        device_config.write_text('{"name": "xp-pen"}')

        # Test with absolute file path
        result_path, result_dir = resolve_device_config_path(str(device_config))
        assert result_path == str(device_config)
        assert result_dir == str(devices_dir)
