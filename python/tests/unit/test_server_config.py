"""
Unit tests for ServerConfig model.

Tests the device field and path resolution functionality.
"""

import pytest
import json
import os
import tempfile
from sketchatone.models.server_config import ServerConfig


class TestServerConfigDefaults:
    """Test ServerConfig default values."""

    def test_default_device_is_none(self):
        """Test that device defaults to None."""
        config = ServerConfig()
        assert config.device is None

    def test_default_http_port_is_none(self):
        """Test that http_port defaults to None."""
        config = ServerConfig()
        assert config.http_port is None

    def test_default_ws_port_is_none(self):
        """Test that ws_port defaults to None."""
        config = ServerConfig()
        assert config.ws_port is None

    def test_default_ws_message_throttle(self):
        """Test that ws_message_throttle defaults to 150."""
        config = ServerConfig()
        assert config.ws_message_throttle == 150

    def test_default_device_finding_poll_interval_is_none(self):
        """Test that device_finding_poll_interval defaults to None."""
        config = ServerConfig()
        assert config.device_finding_poll_interval is None


class TestServerConfigFromDict:
    """Test ServerConfig.from_dict() method."""

    def test_from_dict_with_device_field(self):
        """Test creating config with device field."""
        data = {'device': 'devices'}
        config = ServerConfig.from_dict(data)
        assert config.device == 'devices'

    def test_from_dict_with_absolute_device_path(self):
        """Test creating config with absolute device path."""
        data = {'device': '/opt/sketchatone/configs/devices'}
        config = ServerConfig.from_dict(data)
        assert config.device == '/opt/sketchatone/configs/devices'

    def test_from_dict_with_device_file_path(self):
        """Test creating config with direct device file path."""
        data = {'device': '/opt/sketchatone/configs/devices/xp-pen.json'}
        config = ServerConfig.from_dict(data)
        assert config.device == '/opt/sketchatone/configs/devices/xp-pen.json'

    def test_from_dict_with_null_device(self):
        """Test creating config with null device."""
        data = {'device': None}
        config = ServerConfig.from_dict(data)
        assert config.device is None

    def test_from_dict_without_device_field(self):
        """Test creating config without device field defaults to None."""
        data = {'http_port': 3000}
        config = ServerConfig.from_dict(data)
        assert config.device is None

    def test_from_dict_snake_case_keys(self):
        """Test creating config with snake_case keys."""
        data = {
            'device': 'devices',
            'http_port': 3000,
            'ws_port': 8081,
            'ws_message_throttle': 200,
            'device_finding_poll_interval': 5000
        }
        config = ServerConfig.from_dict(data)
        assert config.device == 'devices'
        assert config.http_port == 3000
        assert config.ws_port == 8081
        assert config.ws_message_throttle == 200
        assert config.device_finding_poll_interval == 5000

    def test_from_dict_camel_case_keys(self):
        """Test creating config with camelCase keys."""
        data = {
            'device': 'devices',
            'httpPort': 4000,
            'wsPort': 9000,
            'wsMessageThrottle': 100,
            'deviceFindingPollInterval': 3000
        }
        config = ServerConfig.from_dict(data)
        assert config.device == 'devices'
        assert config.http_port == 4000
        assert config.ws_port == 9000
        assert config.ws_message_throttle == 100
        assert config.device_finding_poll_interval == 3000


class TestServerConfigToDict:
    """Test ServerConfig.to_dict() method."""

    def test_to_dict_includes_device(self):
        """Test that to_dict includes device field."""
        config = ServerConfig(device='devices')
        result = config.to_dict()
        assert 'device' in result
        assert result['device'] == 'devices'

    def test_to_dict_with_none_device(self):
        """Test that to_dict includes device as None."""
        config = ServerConfig()
        result = config.to_dict()
        assert 'device' in result
        assert result['device'] is None

    def test_to_dict_uses_camel_case(self):
        """Test that to_dict uses camelCase keys."""
        config = ServerConfig(
            device='devices',
            http_port=3000,
            ws_port=8081,
            ws_message_throttle=200,
            device_finding_poll_interval=5000
        )
        result = config.to_dict()
        assert 'httpPort' in result
        assert 'wsPort' in result
        assert 'wsMessageThrottle' in result
        assert 'deviceFindingPollInterval' in result
        # Verify values
        assert result['device'] == 'devices'
        assert result['httpPort'] == 3000
        assert result['wsPort'] == 8081
        assert result['wsMessageThrottle'] == 200
        assert result['deviceFindingPollInterval'] == 5000


class TestServerConfigRoundtrip:
    """Test roundtrip conversion."""

    def test_roundtrip_with_device(self):
        """Test dict -> config -> dict roundtrip with device."""
        original = {
            'device': '/opt/sketchatone/configs/devices',
            'http_port': 3000,
            'ws_port': 8081,
            'ws_message_throttle': 150,
            'device_finding_poll_interval': 2000
        }
        config = ServerConfig.from_dict(original)
        result = config.to_dict()
        # Note: to_dict uses camelCase
        assert result['device'] == original['device']
        assert result['httpPort'] == original['http_port']
        assert result['wsPort'] == original['ws_port']
        assert result['wsMessageThrottle'] == original['ws_message_throttle']
        assert result['deviceFindingPollInterval'] == original['device_finding_poll_interval']


class TestServerConfigFileIO:
    """Test file I/O operations."""

    def test_from_json_file_with_device(self):
        """Test loading config with device from JSON file."""
        data = {
            'device': 'devices',
            'http_port': 3000,
            'ws_port': 8081
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(data, f)
            temp_path = f.name

        try:
            config = ServerConfig.from_json_file(temp_path)
            assert config.device == 'devices'
            assert config.http_port == 3000
            assert config.ws_port == 8081
        finally:
            os.unlink(temp_path)

    def test_to_json_file_with_device(self):
        """Test saving config with device to JSON file."""
        config = ServerConfig(
            device='/opt/sketchatone/configs/devices',
            http_port=3000,
            ws_port=8081
        )
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name

        try:
            config.to_json_file(temp_path)
            with open(temp_path, 'r') as f:
                data = json.load(f)
            assert data['device'] == '/opt/sketchatone/configs/devices'
            assert data['httpPort'] == 3000
            assert data['wsPort'] == 8081
        finally:
            os.unlink(temp_path)
